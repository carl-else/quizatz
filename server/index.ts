import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { createPasswordVerification, verifiesPassword } from "./access-policy.js";
import { authenticateToken, samePrincipal } from "./auth.js";
import {
  TableSessionRepository,
  type OrganizerPrincipal,
  type SessionRecord,
} from "./session-repository.js";
import {
  isSessionCode,
  normalizeSessionCode,
  SESSION_LEASE_MS,
  type CreateSessionOptions,
  type ConnectionRole,
  type LobbyMessage,
  type LobbySnapshot,
  type OpenEndedResult,
  type OpenEndedQuestion,
  type Question,
  type QuestionDefinition,
  type QuestionState,
  type SessionQuestion,
  type SessionCreated,
  type SingleChoiceResult,
  type SingleChoiceQuestion,
} from "../src/protocol.js";

interface ConnectedClient {
  socket: WebSocket;
  role: ConnectionRole;
  participantId: string;
}

const port = Number(process.env.PORT ?? 3000);
const MAX_QUESTION_TEXT_LENGTH = 120;
const MAX_OPTION_TEXT_LENGTH = 30;
const MAX_QUESTION_QUEUE_BYTES = 60 * 1024;
if (!process.env.E2E_AUTH_TOKEN) {
  for (const name of ["ENTRA_TENANT_ID", "ENTRA_API_CLIENT_ID", "ENTRA_API_SCOPE"]) {
    if (!process.env[name]) throw new Error(`${name} is required.`);
  }
}
const repository = TableSessionRepository.fromEnvironment();
await repository.initialize();
await repository.get("HEALTH");

const clientsBySession = new Map<string, Set<ConnectedClient>>();
const cachedSessions = new Map<string, SessionRecord>();
const expirationTimers = new Map<string, NodeJS.Timeout>();
const questionTimers = new Map<string, NodeJS.Timeout>();
const mutationQueues = new Map<string, Promise<void>>();
const webSockets = new WebSocketServer({ noServer: true });

function configuredOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:4174")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function originAllowed(request: IncomingMessage): boolean {
  return !request.headers.origin || configuredOrigins().includes(request.headers.origin);
}

function corsHeaders(request: IncomingMessage): Record<string, string> {
  return originAllowed(request) && request.headers.origin
    ? { "Access-Control-Allow-Origin": request.headers.origin, Vary: "Origin" }
    : { Vary: "Origin" };
}

function sendJson(response: ServerResponse, status: number, body: unknown, request: IncomingMessage): void {
  response.writeHead(status, {
    ...corsHeaders(request),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function sendEmpty(response: ServerResponse, status: number, request: IncomingMessage): void {
  response.writeHead(status, corsHeaders(request));
  response.end();
}

function bearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
}

function e2eAuthorized(request: IncomingMessage): boolean {
  return Boolean(
    process.env.E2E_AUTH_TOKEN && bearerToken(request) === process.env.E2E_AUTH_TOKEN,
  );
}

function sessionCodeFrom(pathname: string, suffix = ""): string | undefined {
  const match = pathname.match(new RegExp(`^/api/sessions/([A-Za-z0-9]{6})${suffix}$`));
  if (!match) return undefined;
  const code = normalizeSessionCode(match[1]);
  return isSessionCode(code) ? code : undefined;
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 2_048) throw new Error("Request body is too large");
  }
  return body ? JSON.parse(body) : {};
}

function createSessionOptions(body: unknown): CreateSessionOptions | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { accessPolicy, password } = body as Record<string, unknown>;
  if ((accessPolicy !== "anonymous" && accessPolicy !== "named")
    || (password !== undefined && (typeof password !== "string" || password.length > 128))) {
    return undefined;
  }
  return { accessPolicy, password: password || undefined };
}

async function activeSession(code: string): Promise<SessionRecord | undefined> {
  const session = cachedSessions.get(code) ?? await repository.get(code);
  if (!session) return undefined;
  if (session.expiresAt > Date.now()) {
    if (session.questionState === "active" && session.timerDeadline && session.timerDeadline <= Date.now()) {
      session.questionState = "closed";
      session.timerDeadline = undefined;
      updateActiveQuestionState(session, "closed");
      clearQuestionTimer(code);
      if (!(await repository.update(session))) {
        cachedSessions.delete(code);
        return activeSession(code);
      }
      broadcast(session);
    }
    cachedSessions.set(code, session);
    return session;
  }
  await repository.delete(session);
  cachedSessions.delete(code);
  expireConnections(code);
  return undefined;
}

function lobbySnapshot(session: SessionRecord): LobbySnapshot {
  const participantCount = [...(clientsBySession.get(session.code) ?? [])]
    .filter((client) => client.role === "participant").length;
  return {
    type: "lobby",
    sessionCode: session.code,
    participantCount,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}

function singleChoiceResult(session: SessionRecord, question: Question): SingleChoiceResult {
  if (question.kind !== "single-choice") return { options: [], totalResponseCount: 0 };
  const responseCounts = new Map<string, number>();
  for (const optionId of Object.values(session.responses ?? {})) {
    responseCounts.set(optionId, (responseCounts.get(optionId) ?? 0) + 1);
  }
  const totalResponseCount = [...responseCounts.values()].reduce((total, count) => total + count, 0);
  return {
    options: question.options.map((option) => {
      const responseCount = responseCounts.get(option.id) ?? 0;
      return {
        ...option,
        responseCount,
        percentage: totalResponseCount ? Math.round((responseCount / totalResponseCount) * 100) : 0,
      };
    }),
    totalResponseCount,
  };
}

function openEndedResult(session: SessionRecord): OpenEndedResult {
  const responseCounts = new Map<string, number>();
  for (const text of Object.values(session.responses ?? {})) {
    responseCounts.set(text, (responseCounts.get(text) ?? 0) + 1);
  }
  const entries = [...responseCounts.entries()]
    .map(([text, responseCount]) => ({ text, responseCount }))
    .sort((first, second) => second.responseCount - first.responseCount || first.text.localeCompare(second.text));
  return {
    entries,
    totalResponseCount: entries.reduce((total, entry) => total + entry.responseCount, 0),
  };
}

function sessionMessage(session: SessionRecord, client: ConnectedClient): LobbyMessage {
  if (!session.activeQuestion || !session.questionState) return lobbySnapshot(session);
  switch (session.questionState) {
    case "upcoming":
      return lobbySnapshot(session);
    case "active":
      return {
        type: "active-question",
        question: session.activeQuestion,
        timerDeadline: session.timerDeadline ? new Date(session.timerDeadline).toISOString() : undefined,
        response: client.role === "participant" ? session.responses?.[client.participantId] : undefined,
      };
    case "closed":
      if (session.activeQuestion.kind === "open-ended" && client.role === "organizer") {
        return {
          type: "closed-open-ended-question",
          question: session.activeQuestion,
          result: openEndedResult(session),
        };
      }
      return { type: "closed-question", question: session.activeQuestion };
    case "revealed":
      if (session.activeQuestion.kind === "open-ended") {
        return {
          type: "revealed-question",
          question: session.activeQuestion,
          result: openEndedResult(session),
        };
      }
      return {
        type: "revealed-question",
        question: session.activeQuestion,
        result: singleChoiceResult(session, session.activeQuestion),
      };
  }
}

function broadcast(session: SessionRecord): void {
  for (const client of clientsBySession.get(session.code) ?? []) {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(sessionMessage(session, client)));
      if (client.role === "organizer" && session.questions) {
        client.socket.send(JSON.stringify({
          type: "organizer-question-queue",
          questions: session.questions,
          activeQuestionIndex: session.activeQuestionIndex,
        }));
      }
    }
  }
}

interface ParsedQuestion {
  question: QuestionDefinition;
  timerSeconds?: number;
}

function parseQuestion(message: unknown, commandType: string): ParsedQuestion | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const { type, question, timerSeconds } = message as Record<string, unknown>;
  if (type !== commandType || typeof question !== "object" || question === null
    || (timerSeconds !== undefined && (typeof timerSeconds !== "number"
      || !Number.isInteger(timerSeconds) || timerSeconds < 1 || timerSeconds > 3_600))) {
    return undefined;
  }
  const { kind, text, options } = question as Record<string, unknown>;
  if (typeof text !== "string") {
    return undefined;
  }
  const normalizedText = text.trim();
  if (!normalizedText || normalizedText.length > MAX_QUESTION_TEXT_LENGTH) return undefined;
  if (kind === "open-ended") return { question: { kind, text: normalizedText }, timerSeconds: timerSeconds as number | undefined };
  if (kind !== "single-choice" || !Array.isArray(options)
    || options.length < 2 || options.length > 8 || options.some((option) => typeof option !== "string")) {
    return undefined;
  }
  const normalizedOptions = options.map((option) => (option as string).trim());
  return normalizedOptions.every((option) => option.length > 0 && option.length <= MAX_OPTION_TEXT_LENGTH)
    ? { question: { kind, text: normalizedText, options: normalizedOptions }, timerSeconds: timerSeconds as number | undefined }
    : undefined;
}

function newSessionQuestion(parsed: ParsedQuestion): SessionQuestion {
  const question = parsed.question.kind === "single-choice"
    ? {
        kind: "single-choice",
        id: crypto.randomUUID(),
        text: parsed.question.text,
        options: parsed.question.options.map((text) => ({ id: crypto.randomUUID(), text })),
      } satisfies SingleChoiceQuestion
    : {
        kind: "open-ended",
        id: crypto.randomUUID(),
        text: parsed.question.text,
      } satisfies OpenEndedQuestion;
  return { question, state: "upcoming", timerSeconds: parsed.timerSeconds };
}

function questionQueueFitsStorage(questions: SessionQuestion[]): boolean {
  return Buffer.byteLength(JSON.stringify(questions), "utf16le") <= MAX_QUESTION_QUEUE_BYTES;
}

function activateQuestion(session: SessionRecord, index: number): void {
  const sessionQuestion = session.questions?.[index];
  if (!sessionQuestion) throw new Error("Question is not available.");
  clearQuestionTimer(session.code);
  session.activeQuestionIndex = index;
  session.activeQuestion = sessionQuestion.question;
  session.questionState = "active";
  sessionQuestion.state = "active";
  session.responses = {};
  session.timerDeadline = sessionQuestion.timerSeconds
    ? Date.now() + sessionQuestion.timerSeconds * 1_000
    : undefined;
}

function updateActiveQuestionState(session: SessionRecord, state: QuestionState): void {
  const index = session.activeQuestionIndex;
  if (index !== undefined && session.questions?.[index]) session.questions[index].state = state;
}

function clearQuestionTimer(code: string): void {
  const timer = questionTimers.get(code);
  if (timer) clearTimeout(timer);
  questionTimers.delete(code);
}

function scheduleQuestionTimer(session: SessionRecord): void {
  clearQuestionTimer(session.code);
  if (!session.timerDeadline || session.questionState !== "active") return;
  const deadline = session.timerDeadline;
  questionTimers.set(session.code, setTimeout(() => {
    void closeQuestionAtDeadline(session.code, deadline).catch((error: unknown) => {
      console.error("Question timer failed", error);
    });
  }, Math.max(0, deadline - Date.now())));
}

function queueSessionMutation(session: SessionRecord, mutation: () => Promise<void>): Promise<void> {
  const previous = mutationQueues.get(session.code) ?? Promise.resolve();
  const queued = previous.catch(() => undefined).then(mutation);
  mutationQueues.set(session.code, queued);
  void queued.finally(() => {
    if (mutationQueues.get(session.code) === queued) mutationQueues.delete(session.code);
  }).catch(() => undefined);
  return queued;
}

async function closeQuestionAtDeadline(code: string, deadline: number): Promise<void> {
  const session = await activeSession(code);
  if (!session) return;
  await queueSessionMutation(session, async () => {
    if (session.questionState !== "active" || session.timerDeadline !== deadline) return;
    session.questionState = "closed";
    session.timerDeadline = undefined;
    updateActiveQuestionState(session, "closed");
    clearQuestionTimer(session.code);
    if (await repository.update(session)) broadcast(session);
  });
}

function handleClientMessage(session: SessionRecord, client: ConnectedClient, payload: unknown): Promise<void> {
  return queueSessionMutation(session, () => applyClientMessage(session, client, payload));
}

async function applyClientMessage(session: SessionRecord, client: ConnectedClient, payload: unknown): Promise<void> {
  let message: unknown;
  try {
    message = JSON.parse(String(payload));
  } catch {
    client.socket.close(4400, "Invalid session command");
    return;
  }

  if (typeof message !== "object" || message === null || !("type" in message)) {
    client.socket.close(4400, "Invalid session command");
    return;
  }
  const { type } = message as { type: unknown };
  let acceptedAnswer: { type: "answer-accepted"; optionId?: string; text?: string } | undefined;
  let shouldScheduleQuestionTimer = false;

  if (type === "author-question") {
    const parsedQuestion = parseQuestion(message, "author-question");
    if (client.role !== "organizer" || session.activeQuestion || session.activeQuestionIndex !== undefined
      || !parsedQuestion || (session.questions?.length ?? 0) >= 50) {
      client.socket.close(4400, "Invalid question");
      return;
    }
    const questions = [...(session.questions ?? []), newSessionQuestion(parsedQuestion)];
    if (!questionQueueFitsStorage(questions)) {
      client.socket.close(4400, "Question limit reached");
      return;
    }
    session.questions = questions;
  } else if (type === "start-live-session") {
    if (client.role !== "organizer" || session.activeQuestion || session.activeQuestionIndex !== undefined
      || !session.questions?.length) {
      client.socket.close(4400, "Live session cannot be started");
      return;
    }
    activateQuestion(session, 0);
    shouldScheduleQuestionTimer = true;
  } else if (type === "edit-next-question") {
    const parsedQuestion = parseQuestion(message, "edit-next-question");
    const nextQuestionIndex = (session.activeQuestionIndex ?? -1) + 1;
    if (client.role !== "organizer" || !parsedQuestion || session.activeQuestionIndex === undefined
      || session.questions?.[nextQuestionIndex]?.state !== "upcoming") {
      client.socket.close(4400, "Next question cannot be edited");
      return;
    }
    const nextQuestion = newSessionQuestion(parsedQuestion);
    const questions = [...session.questions];
    questions[nextQuestionIndex] = nextQuestion;
    if (!questionQueueFitsStorage(questions)) {
      client.socket.close(4400, "Question limit reached");
      return;
    }
    session.questions = questions;
  } else if (type === "start-next-question") {
    const nextQuestionIndex = (session.activeQuestionIndex ?? -1) + 1;
    if (client.role !== "organizer" || session.questionState !== "revealed" || session.activeQuestionIndex === undefined
      || session.questions?.[nextQuestionIndex]?.state !== "upcoming") {
      client.socket.close(4400, "Next question cannot be started");
      return;
    }
    activateQuestion(session, nextQuestionIndex);
    shouldScheduleQuestionTimer = true;
  } else if (type === "answer-question") {
    if (client.role !== "participant" || session.questionState !== "active" || !session.activeQuestion) {
      client.socket.close(4400, "Invalid answer");
      return;
    }
    if (session.activeQuestion.kind === "single-choice") {
      const optionId = "optionId" in message ? (message as { optionId?: unknown }).optionId : undefined;
      if (typeof optionId !== "string" || !session.activeQuestion.options.some((option) => option.id === optionId)) {
        client.socket.close(4400, "Invalid answer");
        return;
      }
      session.responses = { ...session.responses, [client.participantId]: optionId };
      acceptedAnswer = { type: "answer-accepted", optionId };
    } else {
      const text = "text" in message ? (message as { text?: unknown }).text : undefined;
      const normalizedText = typeof text === "string" ? text.trim() : "";
      if (!normalizedText || normalizedText.length > 500) {
        client.socket.close(4400, "Invalid answer");
        return;
      }
      session.responses = { ...session.responses, [client.participantId]: normalizedText };
      acceptedAnswer = { type: "answer-accepted", text: normalizedText };
    }
  } else if (type === "merge-open-ended-result") {
    const { sourceText, targetText } = message as { sourceText?: unknown; targetText?: unknown };
    const responses = Object.values(session.responses ?? {});
    if (client.role !== "organizer" || session.questionState !== "closed"
      || session.activeQuestion?.kind !== "open-ended" || typeof sourceText !== "string"
      || typeof targetText !== "string" || sourceText === targetText
      || !responses.includes(sourceText) || !responses.includes(targetText)) {
      client.socket.close(4400, "Invalid result merge");
      return;
    }
    session.responses = Object.fromEntries(Object.entries(session.responses ?? {}).map(([participantId, text]) => [
      participantId,
      text === sourceText ? targetText : text,
    ]));
  } else if (type === "close-question") {
    if (client.role !== "organizer" || session.questionState !== "active") {
      client.socket.close(4400, "Question cannot be closed");
      return;
    }
    session.questionState = "closed";
    session.timerDeadline = undefined;
    updateActiveQuestionState(session, "closed");
    clearQuestionTimer(session.code);
  } else if (type === "reveal-question") {
    if (client.role !== "organizer" || session.questionState !== "closed") {
      client.socket.close(4400, "Question cannot be revealed");
      return;
    }
    session.questionState = "revealed";
    updateActiveQuestionState(session, "revealed");
  } else {
    client.socket.close(4400, "Invalid session command");
    return;
  }

  if (!(await repository.update(session))) {
    client.socket.close(1011, "Live session state changed");
    return;
  }
  if (shouldScheduleQuestionTimer) scheduleQuestionTimer(session);
  broadcast(session);
  if (acceptedAnswer) {
    client.socket.send(JSON.stringify(acceptedAnswer));
  }
}

function expireConnections(code: string): void {
  const timer = expirationTimers.get(code);
  if (timer) clearTimeout(timer);
  expirationTimers.delete(code);
  clearQuestionTimer(code);
  for (const client of clientsBySession.get(code) ?? []) {
    client.socket.send(JSON.stringify({ type: "expired" }));
    client.socket.close(4408, "Live session expired");
  }
  clientsBySession.delete(code);
}

function scheduleExpiration(session: SessionRecord): void {
  if (expirationTimers.has(session.code)) return;
  const delay = Math.max(0, session.expiresAt - Date.now());
  expirationTimers.set(session.code, setTimeout(() => {
    void activeSession(session.code).catch((error: unknown) => console.error("Session expiration failed", error));
  }, delay));
}

async function resetSessionConnections(code: string): Promise<void> {
  cachedSessions.delete(code);
  clearQuestionTimer(code);
  await activeSession(code);
  const clients = [...(clientsBySession.get(code) ?? [])];
  clientsBySession.delete(code);
  for (const client of clients) client.socket.close(1012, "Backend restarting");
}

async function createSession(
  code: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const token = bearerToken(request);
  if (!token) {
    sendJson(response, 401, { error: "Organizer authentication required" }, request);
    return;
  }

  let organizer;
  try {
    organizer = await authenticateToken(token);
  } catch {
    sendJson(response, 401, { error: "Organizer authentication failed" }, request);
    return;
  }

  let options: CreateSessionOptions | undefined;
  try {
    options = createSessionOptions(await requestBody(request));
  } catch {
    options = undefined;
  }
  if (!options) {
    sendJson(response, 400, { error: "Choose named or anonymous participation and use a password of 128 characters or fewer." }, request);
    return;
  }

  const now = Date.now();
  const session: SessionRecord = {
    code,
    organizer,
    accessPolicy: options.accessPolicy,
    passwordVerification: options.password
      ? await createPasswordVerification(options.password)
      : undefined,
    createdAt: now,
    expiresAt: now + SESSION_LEASE_MS,
  };
  if (!(await repository.create(session))) {
    sendJson(response, 409, { error: "Session code is already in use" }, request);
    return;
  }

  scheduleExpiration(session);
  const created: SessionCreated = { code, expiresAt: new Date(session.expiresAt).toISOString() };
  sendJson(response, 201, created, request);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" }, request);
    return;
  }
  if (request.method === "OPTIONS") {
    if (!originAllowed(request)) {
      sendJson(response, 403, { error: "Origin is not allowed" }, request);
      return;
    }
    response.writeHead(204, {
      ...corsHeaders(request),
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    });
    response.end();
    return;
  }
  if (!originAllowed(request)) {
    sendJson(response, 403, { error: "Origin is not allowed" }, request);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/e2e/reset-connections" && process.env.E2E_AUTH_TOKEN) {
    if (!e2eAuthorized(request)) {
      sendJson(response, 401, { error: "E2E authentication required" }, request);
      return;
    }
    const code = normalizeSessionCode(url.searchParams.get("session") ?? "");
    if (!isSessionCode(code)) {
      sendJson(response, 400, { error: "A live session code is required." }, request);
      return;
    }
    await resetSessionConnections(code);
    sendEmpty(response, 204, request);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/e2e/connection-count" && process.env.E2E_AUTH_TOKEN) {
    if (!e2eAuthorized(request)) {
      sendJson(response, 401, { error: "E2E authentication required" }, request);
      return;
    }
    const code = normalizeSessionCode(url.searchParams.get("session") ?? "");
    const connectionCount = isSessionCode(code) ? (clientsBySession.get(code)?.size ?? 0) : 0;
    sendJson(response, 200, { connectionCount }, request);
    return;
  }

  const code = sessionCodeFrom(url.pathname);
  if (request.method === "POST" && code) {
    await createSession(code, request, response);
    return;
  }
  sendJson(response, 404, { error: "Not found" }, request);
}

function acceptClient(request: IncomingMessage, socket: Duplex, head: Buffer): void {
  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    void connectClient(request, webSocket).catch((error: unknown) => {
      console.error("WebSocket connection failed", error);
      webSocket.close(1011, "Live session service failed");
    });
  });
}

async function connectClient(request: IncomingMessage, socket: WebSocket): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const code = sessionCodeFrom(url.pathname, "/ws");
  if (!code) {
    socket.close(4404, "Live session not found");
    return;
  }
  const session = await activeSession(code);
  if (!session) {
    socket.close(4404, "Live session not found or expired");
    return;
  }

  let role: ConnectionRole = "participant";
  let principal: OrganizerPrincipal | undefined;
  const token = url.searchParams.get("token");
  if (token) {
    try {
      principal = await authenticateToken(token);
      role = samePrincipal(principal, session.organizer) ? "organizer" : "participant";
    } catch {
      socket.close(4401, "Named participant authentication failed");
      return;
    }
  } else if (session.accessPolicy !== "anonymous") {
    socket.close(4403, "This live session requires named participation");
    return;
  }

  if (role === "participant" && token && session.accessPolicy !== "named") {
    socket.close(4406, "This live session only allows anonymous participation");
    return;
  }

  if (role === "participant" && session.passwordVerification) {
    socket.once("message", async (message) => {
      let password: string | undefined;
      try {
        const join = JSON.parse(String(message)) as { type?: unknown; password?: unknown };
        password = join.type === "join" && typeof join.password === "string" ? join.password : undefined;
      } catch {
        password = undefined;
      }
      if (!password || !(await verifiesPassword(password, session.passwordVerification ?? ""))) {
        socket.close(4405, "Password was not accepted");
        return;
      }
      admitClient(session, socket, role, principal, url.searchParams.get("participant"));
    });
    socket.send(JSON.stringify({ type: "join-required" }));
    return;
  }

  admitClient(session, socket, role, principal, url.searchParams.get("participant"));
}

function admitClient(
  session: SessionRecord,
  socket: WebSocket,
  role: ConnectedClient["role"],
  principal: OrganizerPrincipal | undefined,
  anonymousParticipantId: string | null,
): void {
  const participantId = principal
    ? `${principal.tid}:${principal.oid}`
    : anonymousParticipantId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(anonymousParticipantId)
      ? anonymousParticipantId
      : crypto.randomUUID();
  const client: ConnectedClient = { socket, role, participantId };
  const clients = clientsBySession.get(session.code) ?? new Set<ConnectedClient>();
  clients.add(client);
  clientsBySession.set(session.code, clients);
  scheduleExpiration(session);
  scheduleQuestionTimer(session);
  socket.send(JSON.stringify({ type: "connected", role }));
  broadcast(session);

  socket.on("message", (message) => {
    void handleClientMessage(session, client, message).catch((error: unknown) => {
      console.error("Client message failed", error);
      socket.close(1011, "Live session service failed");
    });
  });

  socket.on("close", () => {
    clients.delete(client);
    if (clients.size === 0) clientsBySession.delete(session.code);
    else broadcast(session);
  });
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    console.error("Request failed", error);
    if (!response.headersSent) sendJson(response, 500, { error: "Internal server error" }, request);
    else response.end();
  });
});
server.on("upgrade", (request, socket, head) => {
  if (!originAllowed(request)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  acceptClient(request, socket, head);
});
server.listen(port, "0.0.0.0", () => console.log(`Quizatz backend listening on ${port}`));