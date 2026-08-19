import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npx partykit dev --port 1999 --no-hotkeys --var E2E_AUTH_TOKEN=playwright-only ALLOWED_ORIGINS=http://127.0.0.1:4173",
      port: 1999,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev:web -- --host 127.0.0.1 --port 4173",
      port: 4173,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
