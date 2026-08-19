import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { authenticateToken, samePrincipal } from "./auth.js";
import { TableSessionRepository, type SessionRecord } from "./session-repository.js";
import {
  isSessionCode,
  normalizeSessionCode,
  SESSION_LEASE_MS,
  type LobbySnapshot,
  type SessionCreated,
} from "../src/protocol.js";

interface ConnectedClient {
  socket: WebSocket;
  role: "organizer" | "participant";
}

const port = Number(process.env.PORT ?? 3000);
if (!process.env.E2E_AUTH_TOKEN) {
  for (const name of ["ENTRA_TENANT_ID", "ENTRA_API_CLIENT_ID", "ENTRA_API_SCOPE"]) {
    if (!process.env[name]) throw new Error(`${name} is required.`);
  }
}
const repository = TableSessionRepository.fromEnvironment();
await repository.initialize();
await repository.get("HEALTH");

const clientsBySession = new Map<string, Set<ConnectedClient>>();
const expirationTimers = new Map<string, NodeJS.Timeout>();
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

async function activeSession(code: string): Promise<SessionRecord | undefined> {
  const session = await repository.get(code);
  if (!session || session.expiresAt > Date.now()) return session;
  await repository.delete(session);
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

function broadcast(session: SessionRecord): void {
  const message = JSON.stringify(lobbySnapshot(session));
  for (const client of clientsBySession.get(session.code) ?? []) {
    if (client.socket.readyState === WebSocket.OPEN) client.socket.send(message);
  }
}

function expireConnections(code: string): void {
  const timer = expirationTimers.get(code);
  if (timer) clearTimeout(timer);
  expirationTimers.delete(code);
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

function resetConnectionHub(): void {
  const clients = [...clientsBySession.values()].flatMap((sessionClients) => [...sessionClients]);
  clientsBySession.clear();
  for (const timer of expirationTimers.values()) clearTimeout(timer);
  expirationTimers.clear();
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

  const now = Date.now();
  const session: SessionRecord = {
    code,
    organizer,
    allowAnonymous: true,
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
    resetConnectionHub();
    sendJson(response, 204, undefined, request);
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

  let role: ConnectedClient["role"] = "participant";
  const token = url.searchParams.get("token");
  if (token) {
    try {
      const principal = await authenticateToken(token);
      if (!samePrincipal(principal, session.organizer)) {
        socket.close(4403, "Organizer access denied");
        return;
      }
      role = "organizer";
    } catch {
      socket.close(4401, "Organizer authentication failed");
      return;
    }
  } else if (!session.allowAnonymous) {
    socket.close(4403, "Anonymous participation is disabled");
    return;
  }

  const client: ConnectedClient = { socket, role };
  const clients = clientsBySession.get(code) ?? new Set<ConnectedClient>();
  clients.add(client);
  clientsBySession.set(code, clients);
  scheduleExpiration(session);
  broadcast(session);

  socket.on("close", () => {
    clients.delete(client);
    if (clients.size === 0) clientsBySession.delete(code);
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