import { createRemoteJWKSet, jwtVerify } from "jose";
import type * as Party from "partykit/server";
import { SESSION_LEASE_MS, type LobbySnapshot, type SessionCreated } from "../src/protocol";

const SESSION_KEY = "session";
const jwksByTenant = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

interface RequestWithHeaders {
  headers: { get(name: string): string | null };
}

interface OrganizerPrincipal {
  oid: string;
  tid: string;
  name: string;
}

interface SessionRecord {
  code: string;
  organizer: OrganizerPrincipal;
  allowAnonymous: boolean;
  createdAt: number;
  expiresAt: number;
}

interface ConnectionState {
  role: "organizer" | "participant";
}

function envString(env: Record<string, unknown>, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function allowedOrigin(request: RequestWithHeaders, env: Record<string, unknown>): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;

  const configured = envString(env, "ALLOWED_ORIGINS");
  const origins = configured
    ? configured.split(",").map((entry) => entry.trim())
    : ["http://localhost:5173", "http://127.0.0.1:4173"];

  return origins.includes(origin) ? origin : null;
}

function corsHeaders(request: RequestWithHeaders, env: Record<string, unknown>): Record<string, string> {
  const origin = allowedOrigin(request, env);
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(
  body: unknown,
  status: number,
  request: RequestWithHeaders,
  env: Record<string, unknown>,
): Response {
  return Response.json(body, { status, headers: corsHeaders(request, env) });
}

async function authenticateToken(
  token: string,
  env: Record<string, unknown>,
): Promise<OrganizerPrincipal> {
  const e2eToken = envString(env, "E2E_AUTH_TOKEN");
  if (e2eToken && token === e2eToken) {
    return { oid: "playwright", tid: "e2e", name: "Test organizer" };
  }

  const tenantId = envString(env, "ENTRA_TENANT_ID");
  const audience = envString(env, "ENTRA_API_CLIENT_ID") ?? envString(env, "VITE_ENTRA_CLIENT_ID");
  const requiredScope = envString(env, "ENTRA_API_SCOPE");
  if (!tenantId || !audience || !requiredScope) {
    throw new Error("Organizer authentication is not configured");
  }

  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  let jwks = jwksByTenant.get(tenantId);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
    );
    jwksByTenant.set(tenantId, jwks);
  }

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience,
    algorithms: ["RS256"],
  });
  const scopes = typeof payload.scp === "string" ? payload.scp.split(" ") : [];
  if (!scopes.includes(requiredScope)) throw new Error("Required API scope is missing");
  if (typeof payload.oid !== "string" || payload.tid !== tenantId) {
    throw new Error("Tenant-scoped identity is missing");
  }

  return {
    oid: payload.oid,
    tid: payload.tid,
    name: typeof payload.name === "string" ? payload.name : "Organizer",
  };
}

function bearerToken(request: RequestWithHeaders): string | null {
  const authorization = request.headers.get("Authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
}

function samePrincipal(left: OrganizerPrincipal, right: OrganizerPrincipal): boolean {
  return left.oid === right.oid && left.tid === right.tid;
}

export default class LobbyServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  static async onBeforeConnect(request: Party.Request, lobby: Party.Lobby): Promise<Party.Request | Response> {
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigin(request, lobby.env)) {
      return new Response("Origin is not allowed", { status: 403 });
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    if (token) {
      try {
        await authenticateToken(token, lobby.env);
      } catch {
        return new Response("Organizer authentication failed", { status: 401 });
      }
    }

    return request;
  }

  async onRequest(request: Party.Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      if (request.headers.get("Origin") && !allowedOrigin(request, this.room.env)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(request, this.room.env) });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, request, this.room.env);
    }
    if (request.headers.get("Origin") && !allowedOrigin(request, this.room.env)) {
      return json({ error: "Origin is not allowed" }, 403, request, this.room.env);
    }

    const token = bearerToken(request);
    if (!token) return json({ error: "Organizer authentication required" }, 401, request, this.room.env);

    let organizer: OrganizerPrincipal;
    try {
      organizer = await authenticateToken(token, this.room.env);
    } catch {
      return json({ error: "Organizer authentication failed" }, 401, request, this.room.env);
    }

    const existing = await this.room.storage.get<SessionRecord>(SESSION_KEY);
    if (existing && existing.expiresAt > Date.now()) {
      return json({ error: "Session code is already in use" }, 409, request, this.room.env);
    }
    if (existing) await this.room.storage.deleteAll();

    const now = Date.now();
    const session: SessionRecord = {
      code: this.room.id.toUpperCase(),
      organizer,
      allowAnonymous: true,
      createdAt: now,
      expiresAt: now + SESSION_LEASE_MS,
    };
    await this.room.storage.put(SESSION_KEY, session);
    await this.room.storage.setAlarm(session.expiresAt);

    const result: SessionCreated = {
      code: session.code,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
    return json(result, 201, request, this.room.env);
  }

  async onConnect(connection: Party.Connection<ConnectionState>, context: Party.ConnectionContext) {
    const session = await this.room.storage.get<SessionRecord>(SESSION_KEY);
    if (!session || session.expiresAt <= Date.now()) {
      connection.close(4404, "Live session not found or expired");
      return;
    }

    const token = new URL(context.request.url).searchParams.get("token");
    if (token) {
      let principal: OrganizerPrincipal;
      try {
        principal = await authenticateToken(token, this.room.env);
      } catch {
        connection.close(4401, "Organizer authentication failed");
        return;
      }
      if (!samePrincipal(principal, session.organizer)) {
        connection.close(4403, "Organizer access denied");
        return;
      }
      connection.setState({ role: "organizer" });
    } else {
      if (!session.allowAnonymous) {
        connection.close(4403, "Anonymous participation is disabled");
        return;
      }
      connection.setState({ role: "participant" });
    }

    this.broadcastLobby(session);
  }

  onClose() {
    void this.room.storage.get<SessionRecord>(SESSION_KEY).then((session) => {
      if (session) this.broadcastLobby(session);
    });
  }

  async onAlarm() {
    this.room.broadcast(JSON.stringify({ type: "expired" }));
    for (const connection of this.room.getConnections()) {
      connection.close(4408, "Live session expired");
    }
    await this.room.storage.deleteAll();
  }

  private broadcastLobby(session: SessionRecord) {
    const participantCount = [...this.room.getConnections<ConnectionState>()].filter(
      (connection) => connection.state?.role === "participant",
    ).length;
    const snapshot: LobbySnapshot = {
      type: "lobby",
      sessionCode: session.code,
      participantCount,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
    this.room.broadcast(JSON.stringify(snapshot));
  }
}

LobbyServer satisfies Party.Worker;