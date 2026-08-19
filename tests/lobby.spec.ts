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

  await participantContext.close();
  await expect(organizer.getByTestId("participant-count")).toHaveText("0");
  await organizerContext.close();
});
