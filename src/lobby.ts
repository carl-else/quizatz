import PartySocket from "partysocket";
import {
  isSessionCode,
  normalizeSessionCode,
  type ApiError,
  type LobbySnapshot,
  type SessionCreated,
} from "./protocol";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function partyConfig() {
  const host = import.meta.env.VITE_PARTYKIT_HOST ?? (import.meta.env.DEV ? "localhost:1999" : "");
  if (!host) throw new Error("The PartyKit host has not been configured for this deployment.");
  const protocol = import.meta.env.VITE_PARTYKIT_PROTOCOL ??
    (window.location.protocol === "https:" ? "wss" : "ws");
  return { host, protocol };
}

function newSessionCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return body?.error ?? `PartyKit returned ${response.status}.`;
}

export async function createLiveSession(accessToken: string): Promise<SessionCreated> {
  const { host, protocol } = partyConfig();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newSessionCode();
    const response = await PartySocket.fetch(
      {
        host,
        protocol: protocol === "wss" ? "https" : "http",
        party: "main",
        room: code.toLowerCase(),
      },
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (response.ok) return (await response.json()) as SessionCreated;
    if (response.status !== 409) throw new Error(await responseError(response));
  }
  throw new Error("Could not reserve a unique session code. Try again.");
}

export function connectToLobby(
  rawCode: string,
  accessToken: string | undefined,
  onSnapshot: (snapshot: LobbySnapshot) => void,
  onFailure: (message: string) => void,
): PartySocket {
  const code = normalizeSessionCode(rawCode);
  if (!isSessionCode(code)) throw new Error("Enter a six-character session code.");
  const { host, protocol } = partyConfig();
  const socket = new PartySocket({
    host,
    protocol,
    party: "main",
    room: code.toLowerCase(),
    query: accessToken ? { token: accessToken } : undefined,
  });

  let receivedSnapshot = false;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as LobbySnapshot | { type: "expired" };
    if (message.type === "expired") {
      onFailure("This live session has expired.");
      return;
    }
    receivedSnapshot = true;
    onSnapshot(message);
  });
  socket.addEventListener("close", (event) => {
    if (receivedSnapshot || event.code === 1000) return;
    const messages: Record<number, string> = {
      4403: "This live session does not allow anonymous participants.",
      4404: "That live session was not found or has expired.",
      4408: "This live session has expired.",
    };
    onFailure(messages[event.code] ?? "Could not connect to the live session.");
  });
  socket.addEventListener("error", () => {
    if (!receivedSnapshot) onFailure("Could not reach the live session service.");
  });
  return socket;
}
