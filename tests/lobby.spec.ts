import { expect, test } from "@playwright/test";

test("an organizer creates a live session and an anonymous participant joins", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();
  await organizer.goto("/");
  await organizer.getByRole("button", { name: "Sign in and create" }).click();

  const code = await organizer.getByTestId("session-code").textContent();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
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
