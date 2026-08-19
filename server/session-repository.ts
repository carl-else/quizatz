import { TableClient, type TableEntityResult } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";

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
  allowAnonymous: boolean;
  createdAt: number;
  expiresAt: number;
  etag?: string;
}

interface SessionEntity {
  organizerOid: string;
  organizerTid: string;
  organizerName: string;
  allowAnonymous: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface SessionRepository {
  create(session: SessionRecord): Promise<boolean>;
  get(code: string): Promise<SessionRecord | undefined>;
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
    allowAnonymous: entity.allowAnonymous,
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt,
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
        allowAnonymous: session.allowAnonymous,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
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