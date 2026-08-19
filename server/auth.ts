import { createRemoteJWKSet, jwtVerify } from "jose";
import type { OrganizerPrincipal } from "./session-repository.js";

const jwksByTenant = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function authenticateToken(token: string): Promise<OrganizerPrincipal> {
  if (process.env.E2E_AUTH_TOKEN && token === process.env.E2E_AUTH_TOKEN) {
    return { oid: "playwright", tid: "e2e", name: "Test organizer" };
  }

  const tenantId = process.env.ENTRA_TENANT_ID;
  const audience = process.env.ENTRA_API_CLIENT_ID;
  const requiredScope = process.env.ENTRA_API_SCOPE;
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

export function samePrincipal(left: OrganizerPrincipal, right: OrganizerPrincipal): boolean {
  return left.oid === right.oid && left.tid === right.tid;
}