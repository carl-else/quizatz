import { expect, test } from "@playwright/test";

async function createSession(page: import("@playwright/test").Page, accessPolicy: "anonymous" | "named", password?: string) {
  if (accessPolicy === "named") await page.getByRole("button", { name: "Named" }).click();
  if (password) await page.getByLabel(/Password \(optional\)/).fill(password);
  await page.getByRole("button", { name: "Sign in and create" }).click();
  const code = await page.getByTestId("session-code").textContent();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  return code as string;
}

test("an organizer creates a live session and an anonymous participant joins", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();
  await organizer.goto("/");
  const code = await createSession(organizer, "anonymous");
  await expect(organizer.getByTestId("participant-count")).toHaveText("0");

  const participantContext = await browser.newContext();
  const participant = await participantContext.newPage();
  await participant.goto(`/?session=${code}`);
  await expect(participant.getByRole("heading", { name: "You’re in." })).toBeVisible();
  await expect(organizer.getByTestId("participant-count")).toHaveText("1");

  const unauthorizedResetStatus = await participant.evaluate(async () => {
    const response = await fetch("http://127.0.0.1:3000/api/e2e/reset-connections", {
      method: "POST",
    });
    return response.status;
  });
  expect(unauthorizedResetStatus).toBe(401);

  await participant.evaluate(async () => {
    await fetch("http://127.0.0.1:3000/api/e2e/reset-connections", {
      method: "POST",
      headers: { Authorization: "Bearer playwright-only" },
    });
  });
  await expect.poll(async () => participant.evaluate(async (sessionCode) => {
    const response = await fetch(
      `http://127.0.0.1:3000/api/e2e/connection-count?session=${sessionCode}`,
      { headers: { Authorization: "Bearer playwright-only" } },
    );
    return ((await response.json()) as { connectionCount: number }).connectionCount;
  }, code)).toBe(2);
  await expect(organizer.getByTestId("participant-count")).toHaveText("1");

  await participantContext.close();
  await expect(organizer.getByTestId("participant-count")).toHaveText("0");
  await organizerContext.close();
});

test("a named live session accepts a named participant and rejects anonymous entry", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();
  await organizer.goto("/");
  const code = await createSession(organizer, "named");

  const anonymousContext = await browser.newContext();
  const anonymousParticipant = await anonymousContext.newPage();
  await anonymousParticipant.goto(`/?session=${code}`);
  await expect(anonymousParticipant.getByRole("alert")).toHaveText("This live session requires named participation.");

  const namedContext = await browser.newContext();
  await namedContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-named-participant");
  });
  const namedParticipant = await namedContext.newPage();
  await namedParticipant.goto("/");
  await namedParticipant.getByLabel("Session code").fill(code);
  await namedParticipant.getByRole("button", { name: "Sign in to join" }).click();
  await expect(namedParticipant.getByRole("heading", { name: "You’re in." })).toBeVisible();
  await expect(organizer.getByTestId("participant-count")).toHaveText("1");

  await namedContext.close();
  await anonymousContext.close();
  await organizerContext.close();
});

test("an anonymous live session protects password entry and rejects named participation", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();
  await organizer.goto("/");
  const code = await createSession(organizer, "anonymous", "correct horse battery staple");

  const wrongPasswordContext = await browser.newContext();
  const wrongPasswordParticipant = await wrongPasswordContext.newPage();
  await wrongPasswordParticipant.goto("/");
  await wrongPasswordParticipant.getByLabel("Session code").fill(code);
  await wrongPasswordParticipant.getByLabel(/Password \(if required\)/).fill("wrong password");
  await wrongPasswordParticipant.getByTitle("Join session").click();
  await expect(wrongPasswordParticipant.getByRole("alert")).toHaveText("The password is incorrect.");

  const namedContext = await browser.newContext();
  await namedContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-named-participant");
  });
  const namedParticipant = await namedContext.newPage();
  await namedParticipant.goto("/");
  await namedParticipant.getByLabel("Session code").fill(code);
  await namedParticipant.getByRole("button", { name: "Sign in to join" }).click();
  await expect(namedParticipant.getByRole("alert")).toHaveText("This live session only allows anonymous participation.");

  const participantContext = await browser.newContext();
  const participant = await participantContext.newPage();
  await participant.goto("/");
  await participant.getByLabel("Session code").fill(code);
  await participant.getByLabel(/Password \(if required\)/).fill("correct horse battery staple");
  await participant.getByTitle("Join session").click();
  await expect(participant.getByRole("heading", { name: "You’re in." })).toBeVisible();
  await expect(organizer.getByTestId("participant-count")).toHaveText("1");

  await participantContext.close();
  await namedContext.close();
  await wrongPasswordContext.close();
  await organizerContext.close();
});

test("a nonexistent session code has a clear error state", async ({ page }) => {
  await page.goto("/?session=000000");
  await expect(page.getByRole("alert")).toHaveText("That live session was not found or has expired.");
});
