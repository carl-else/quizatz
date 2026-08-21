import { TableClient, type TableEntityResult } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import type {
  Question,
  QuestionState,
  RevealedQuestionResult,
  SessionAccessPolicy,
  SessionQuestion,
  SingleChoiceQuestion,
} from "../src/protocol.js";

const PARTITION_KEY = "live-session";
const DEFAULT_TABLE_NAME = "LiveSessions";

export interface OrganizerPrincipal {
  oid: string;
  tid: string;
  name: string;
}

export interface SessionRecord {
  code: string;
  organizer: OrganizerPrincipal;
  accessPolicy: SessionAccessPolicy;
  passwordVerification?: string;
  activeQuestion?: Question;
  questionState?: QuestionState;
  questions?: SessionQuestion[];
  activeQuestionIndex?: number;
  timerDeadline?: number;
  responses?: Record<string, string>;
  createdAt: number;
  expiresAt: number;
  endedAt?: number;
  finalSummary?: RevealedQuestionResult[];
  expiredAt?: number;
  cleanupDeadline?: number;
  cleanupAttempts?: number;
  cleanupAlertedAt?: number;
  etag?: string;
}

interface SessionEntity {
  organizerOid: string;
  organizerTid: string;
  organizerName: string;
  accessPolicy: SessionAccessPolicy;
  passwordVerification?: string;
  activeQuestion?: string;
  questionState?: QuestionState;
  questions?: string;
  activeQuestionIndex?: number;
  timerDeadline?: number;
  responses?: string;
  createdAt: number;
  expiresAt: number;
  endedAt?: number;
  finalSummary?: string;
  expiredAt?: number;
  cleanupDeadline?: number;
  cleanupAttempts?: number;
  cleanupAlertedAt?: number;
}

interface StoredSingleChoiceQuestion {
  kind?: "single-choice";
  id?: string;
  text: string;
  options: Array<{ id?: string; text: string }>;
}

interface StoredOpenEndedQuestion {
  kind: "open-ended";
  id?: string;
  text: string;
}

type StoredQuestion = StoredSingleChoiceQuestion | StoredOpenEndedQuestion;

function parseQuestion(value: string): Question {
  const question = JSON.parse(value) as StoredQuestion;
  if (question.kind === "open-ended") {
    return { kind: "open-ended", id: question.id ?? crypto.randomUUID(), text: question.text };
  }
  return {
    kind: "single-choice",
    id: question.id ?? crypto.randomUUID(),
    text: question.text,
    options: question.options.map((option) => ({ id: option.id ?? crypto.randomUUID(), text: option.text })),
  };
}

function parseSessionQuestions(value: string): SessionQuestion[] {
  const questions = JSON.parse(value) as Array<Omit<SessionQuestion, "question"> & { question: StoredQuestion }>;
  return questions.map((sessionQuestion) => ({
    ...sessionQuestion,
    question: parseQuestion(JSON.stringify(sessionQuestion.question)),
  }));
}

function compactQuestion(question: Question): StoredQuestion {
  if (question.kind === "open-ended") return { kind: "open-ended", text: question.text };
  return {
    kind: "single-choice",
    text: question.text,
    options: question.options.map((option) => ({ text: option.text })),
  };
}

function storedQuestions(session: SessionRecord): string | undefined {
  if (!session.questions) return undefined;
  return JSON.stringify(session.questions.map((sessionQuestion, index) => ({
    ...sessionQuestion,
    question: index === session.activeQuestionIndex
      ? sessionQuestion.question
      : compactQuestion(sessionQuestion.question),
  })));
}

export interface SessionRepository {
  create(session: SessionRecord): Promise<boolean>;
  get(code: string): Promise<SessionRecord | undefined>;
  list(): Promise<SessionRecord[]>;
  update(session: SessionRecord): Promise<boolean>;
  delete(session: SessionRecord): Promise<boolean>;
}

function toRecord(entity: TableEntityResult<SessionEntity>, code: string): SessionRecord {
  return {
    code,
    organizer: {
      oid: entity.organizerOid,
      tid: entity.organizerTid,
      name: entity.organizerName,
    },
    accessPolicy: entity.accessPolicy,
    passwordVerification: entity.passwordVerification,
    activeQuestion: entity.activeQuestion ? parseQuestion(entity.activeQuestion) : undefined,
    questionState: entity.questionState,
    questions: entity.questions ? parseSessionQuestions(entity.questions) : undefined,
    activeQuestionIndex: entity.activeQuestionIndex,
    timerDeadline: entity.timerDeadline,
    responses: entity.responses ? JSON.parse(entity.responses) as Record<string, string> : undefined,
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt,
    endedAt: entity.endedAt,
    finalSummary: entity.finalSummary ? JSON.parse(entity.finalSummary) as RevealedQuestionResult[] : undefined,
    expiredAt: entity.expiredAt,
    cleanupDeadline: entity.cleanupDeadline,
    cleanupAttempts: entity.cleanupAttempts,
    cleanupAlertedAt: entity.cleanupAlertedAt,
    etag: entity.etag,
  };
}

function statusCode(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error
    ? Number(error.statusCode)
    : undefined;
}

export class TableSessionRepository implements SessionRepository {
  constructor(private readonly client: TableClient) {}

  static fromEnvironment(): TableSessionRepository {
    const tableName = process.env.TABLE_NAME ?? DEFAULT_TABLE_NAME;
    const connectionString = process.env.TABLE_STORAGE_CONNECTION_STRING;
    if (connectionString) {
      return new TableSessionRepository(TableClient.fromConnectionString(connectionString, tableName));
    }

    const accountName = process.env.STORAGE_ACCOUNT_NAME;
    if (!accountName) {
      throw new Error("Set TABLE_STORAGE_CONNECTION_STRING or STORAGE_ACCOUNT_NAME.");
    }
    return new TableSessionRepository(
      new TableClient(
        `https://${accountName}.table.core.windows.net`,
        tableName,
        new DefaultAzureCredential(),
      ),
    );
  }

  async initialize(): Promise<void> {
    if (process.env.CREATE_TABLE_IF_MISSING === "true") {
      await this.client.createTable().catch((error: unknown) => {
        if (statusCode(error) !== 409) throw error;
      });
    }
  }

  async create(session: SessionRecord): Promise<boolean> {
    try {
      await this.client.createEntity<SessionEntity>({
        partitionKey: PARTITION_KEY,
        rowKey: session.code,
        organizerOid: session.organizer.oid,
        organizerTid: session.organizer.tid,
        organizerName: session.organizer.name,
        accessPolicy: session.accessPolicy,
        passwordVerification: session.passwordVerification,
        activeQuestion: session.activeQuestion ? JSON.stringify(session.activeQuestion) : undefined,
        questionState: session.questionState,
        questions: storedQuestions(session),
        activeQuestionIndex: session.activeQuestionIndex,
        timerDeadline: session.timerDeadline,
        responses: session.responses ? JSON.stringify(session.responses) : undefined,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        endedAt: session.endedAt,
        finalSummary: session.finalSummary ? JSON.stringify(session.finalSummary) : undefined,
        expiredAt: session.expiredAt,
        cleanupDeadline: session.cleanupDeadline,
        cleanupAttempts: session.cleanupAttempts,
        cleanupAlertedAt: session.cleanupAlertedAt,
      });
      return true;
    } catch (error) {
      if (statusCode(error) === 409) return false;
      throw error;
    }
  }

  async get(code: string): Promise<SessionRecord | undefined> {
    try {
      return toRecord(await this.client.getEntity<SessionEntity>(PARTITION_KEY, code), code);
    } catch (error) {
      if (statusCode(error) === 404) return undefined;
      throw error;
    }
  }

  async list(): Promise<SessionRecord[]> {
    const sessions: SessionRecord[] = [];
    for await (const entity of this.client.listEntities<SessionEntity>({
      queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` },
    })) {
      if (entity.rowKey) sessions.push(toRecord(entity, entity.rowKey));
    }
    return sessions;
  }

  async update(session: SessionRecord): Promise<boolean> {
    try {
      await this.client.updateEntity<SessionEntity>({
        partitionKey: PARTITION_KEY,
        rowKey: session.code,
        organizerOid: session.organizer.oid,
        organizerTid: session.organizer.tid,
        organizerName: session.organizer.name,
        accessPolicy: session.accessPolicy,
        passwordVerification: session.passwordVerification,
        activeQuestion: session.activeQuestion ? JSON.stringify(session.activeQuestion) : undefined,
        questionState: session.questionState,
        questions: storedQuestions(session),
        activeQuestionIndex: session.activeQuestionIndex,
        timerDeadline: session.timerDeadline,
        responses: session.responses ? JSON.stringify(session.responses) : undefined,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        endedAt: session.endedAt,
        finalSummary: session.finalSummary ? JSON.stringify(session.finalSummary) : undefined,
        expiredAt: session.expiredAt,
        cleanupDeadline: session.cleanupDeadline,
        cleanupAttempts: session.cleanupAttempts,
        cleanupAlertedAt: session.cleanupAlertedAt,
      }, "Replace", { etag: session.etag });
      const updated = await this.get(session.code);
      if (!updated) return false;
      Object.assign(session, updated);
      return true;
    } catch (error) {
      if (statusCode(error) === 404 || statusCode(error) === 412) return false;
      throw error;
    }
  }

  async delete(session: SessionRecord): Promise<boolean> {
    try {
      await this.client.deleteEntity(PARTITION_KEY, session.code, { etag: session.etag });
      return true;
    } catch (error) {
      if (statusCode(error) === 404 || statusCode(error) === 412) return false;
      throw error;
    }
  }
}