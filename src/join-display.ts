import QRCodeStyling from "qr-code-styling";
import "@fontsource-variable/manrope";
import "@fontsource/newsreader/600.css";
import { normalizeSessionCode } from "./protocol";
import "./style.css";

type DisplayStatus = "waiting" | "in-progress" | "ended" | "unavailable";

function backendUrl(): URL {
  const configured = import.meta.env.VITE_BACKEND_URL ?? (import.meta.env.DEV ? "http://localhost:3000" : "");
  if (!configured) throw new Error("The live-session backend has not been configured for this deployment.");
  return new URL(configured.endsWith("/") ? configured : `${configured}/`);
}

function joinUrl(code: string): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin);
  url.searchParams.set("session", code);
  return url.toString();
}

function statusMessage(status: DisplayStatus): string {
  switch (status) {
    case "waiting": return "Ready to join";
    case "in-progress": return "Live session in progress";
    case "ended": return "This live session has ended";
    case "unavailable": return "This live session is no longer available";
  }
}

const sessionCode = normalizeSessionCode(new URL(window.location.href).searchParams.get("session") ?? "");
const publicJoinUrl = joinUrl(sessionCode);
const root = document.querySelector<HTMLElement>("#join-display");
if (!root) throw new Error("The QR join display root is unavailable.");

root.className = "join-display";
root.innerHTML = `
  <header>
    <a class="wordmark" href="${import.meta.env.BASE_URL}" aria-label="Quizatz home">
      <span class="wordmark-mark">Q</span><span>Quizatz</span>
    </a>
  </header>
  <main>
    <section class="join-display-content" aria-labelledby="join-display-title">
      <p class="eyebrow">Join this live session</p>
      <h1 id="join-display-title">Open your camera and scan to join.</h1>
      <p class="join-display-status" role="status" aria-live="polite">Checking live-session status</p>
      <div class="qr-code" aria-hidden="true"></div>
      <a class="join-display-link" href="${publicJoinUrl}">${publicJoinUrl}</a>
    </section>
  </main>
  <footer>Quizatz live questioning</footer>
`;

const statusElement = root.querySelector<HTMLElement>(".join-display-status");
const qrCodeElement = root.querySelector<HTMLElement>(".qr-code");
const joinLink = root.querySelector<HTMLAnchorElement>(".join-display-link");
if (!statusElement || !qrCodeElement || !joinLink) throw new Error("The QR join display is incomplete.");
const displayStatusElement = statusElement;
const qrCodeContainer = qrCodeElement;
const joinDisplayLink = joinLink;

let qrRendered = false;
function showJoinOptions(): void {
  qrCodeContainer.hidden = false;
  joinDisplayLink.hidden = false;
  if (qrRendered) return;
  qrRendered = true;
  new QRCodeStyling({
    data: publicJoinUrl,
    width: 720,
    height: 720,
    type: "svg",
    margin: 32,
    qrOptions: { errorCorrectionLevel: "Q" },
    dotsOptions: { color: "#000000", type: "square" },
    cornersSquareOptions: { color: "#000000", type: "square" },
    cornersDotOptions: { color: "#000000", type: "square" },
    backgroundOptions: { color: "#ffffff" },
  }).append(qrCodeContainer);
}

function hideJoinOptions(): void {
  qrCodeContainer.hidden = true;
  joinDisplayLink.hidden = true;
}

async function loadDisplayStatus(): Promise<void> {
  try {
    const response = await fetch(new URL(`api/sessions/${encodeURIComponent(sessionCode)}/display-status`, backendUrl()));
    if (!response.ok) throw new Error("Display-status request failed.");
    const body = await response.json() as { status?: unknown };
    if (body.status !== "waiting" && body.status !== "in-progress" && body.status !== "ended" && body.status !== "unavailable") {
      throw new Error("Display-status response is invalid.");
    }
    displayStatusElement.textContent = statusMessage(body.status);
    if (body.status === "waiting" || body.status === "in-progress") showJoinOptions();
    else hideJoinOptions();
  } catch {
    displayStatusElement.textContent = "Could not verify live-session status.";
    showJoinOptions();
  }
}

void loadDisplayStatus();