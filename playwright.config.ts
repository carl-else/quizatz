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
      command: "npm run storage -- --tableHost 127.0.0.1",
      port: 10002,
      reuseExistingServer: false,
    },
    {
      command: "npx tsx server/index.ts",
      port: 3000,
      reuseExistingServer: false,
      env: {
        PORT: "3000",
        TABLE_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
        CREATE_TABLE_IF_MISSING: "true",
        E2E_AUTH_TOKEN: "playwright-only",
        ALLOWED_ORIGINS: "http://127.0.0.1:4174",
      },
    },
    {
      command: "npm run dev:web -- --host 127.0.0.1 --port 4174",
      port: 4174,
      reuseExistingServer: false,
      env: {
        VITE_BASE_PATH: "/",
        VITE_BACKEND_URL: "http://127.0.0.1:3000",
      },
    },
  ],
});
