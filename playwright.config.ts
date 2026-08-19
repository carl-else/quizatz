import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npx partykit dev --port 2999 --no-hotkeys --var E2E_AUTH_TOKEN=playwright-only ALLOWED_ORIGINS=http://127.0.0.1:4174",
      port: 2999,
      reuseExistingServer: false,
    },
    {
      command: "npm run dev:web -- --host 127.0.0.1 --port 4174",
      port: 4174,
      reuseExistingServer: false,
      env: {
        VITE_BASE_PATH: "/",
        VITE_PARTYKIT_HOST: "localhost:2999",
        VITE_PARTYKIT_PROTOCOL: "ws",
      },
    },
  ],
});
