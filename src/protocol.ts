export const SESSION_CODE_LENGTH = 6;
export const SESSION_LEASE_MS = 24 * 60 * 60 * 1000;

export interface LobbySnapshot {
  type: "lobby";
  sessionCode: string;
  participantCount: number;
  expiresAt: string;
}

export interface SessionCreated {
  code: string;
  expiresAt: string;
}

export interface ApiError {
  error: string;
}

export function normalizeSessionCode(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, SESSION_CODE_LENGTH);
}

export function isSessionCode(value: string): boolean {
  return /^[A-Z0-9]{6}$/.test(value);
}
