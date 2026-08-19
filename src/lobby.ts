import {
  isSessionCode,
  normalizeSessionCode,
  type ApiError,
  type LobbySnapshot,
  type SessionCreated,
} from "./protocol";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000];

export interface LobbyConnection {
  close(code?: number, reason?: string): void;
}

function backendUrl(): URL {
  const configured = import.meta.env.VITE_BACKEND_URL ?? (import.meta.env.DEV ? "http://localhost:3000" : "");
  if (!configured) throw new Error("The live-session backend has not been configured for this deployment.");
  return new URL(configured.endsWith("/") ? configured : `${configured}/`);
}

function newSessionCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return body?.error ?? `The live-session service returned ${response.status}.`;
}

export async function createLiveSession(accessToken: string): Promise<SessionCreated> {
  const baseUrl = backendUrl();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newSessionCode();
    const response = await fetch(new URL(`api/sessions/${code}`, baseUrl), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) return (await response.json()) as SessionCreated;
    if (response.status !== 409) throw new Error(await responseError(response));
  }
  throw new Error("Could not reserve a unique session code. Try again.");
}

function socketUrl(code: string, accessToken: string | undefined): URL {
  const url = new URL(`api/sessions/${code}/ws`, backendUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (accessToken) url.searchParams.set("token", accessToken);
  return url;
}

export function connectToLobby(
  rawCode: string,
  accessToken: string | undefined,
  onSnapshot: (snapshot: LobbySnapshot) => void,
  onFailure: (message: string) => void,
): LobbyConnection {
  const code = normalizeSessionCode(rawCode);
  if (!isSessionCode(code)) throw new Error("Enter a six-character session code.");
  let socket: WebSocket | undefined;
  let reconnectTimer: number | undefined;
  let reconnectAttempt = 0;
  let stopped = false;
  let receivedSnapshot = false;

  const connect = () => {
    socket = new WebSocket(socketUrl(code, accessToken));
    socket.addEventListener("open", () => {
      reconnectAttempt = 0;
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as LobbySnapshot | { type: "expired" };
      if (message.type === "expired") {
        stopped = true;
        onFailure("This live session has expired.");
        return;
      }
      receivedSnapshot = true;
      onSnapshot(message);
    });
    socket.addEventListener("close", (event) => {
      if (stopped || event.code === 1000) return;
      const messages: Record<number, string> = {
        4401: "Organizer authentication failed.",
        4403: "This live session does not allow anonymous participants.",
        4404: "That live session was not found or has expired.",
        4408: "This live session has expired.",
      };
      const terminalMessage = messages[event.code];
      if (terminalMessage) {
        stopped = true;
        onFailure(terminalMessage);
        return;
      }

      onFailure(receivedSnapshot
        ? "Connection lost. Reconnecting..."
        : "Could not connect to the live session. Retrying...");
      const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    });
  };

  connect();
  return {
    close(closeCode = 1000, reason) {
      stopped = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close(closeCode, reason);
    },
  };
}
