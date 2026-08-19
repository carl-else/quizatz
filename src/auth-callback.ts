import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

void broadcastResponseToMainFrame().catch(() => {
  document.body.textContent = "Authentication response unavailable.";
});
