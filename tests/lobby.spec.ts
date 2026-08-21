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

  const unauthorizedResetStatus = await participant.evaluate(async (sessionCode) => {
    const response = await fetch(`http://127.0.0.1:3000/api/e2e/reset-connections?session=${sessionCode}`, {
      method: "POST",
    });
    return response.status;
  }, code);
  expect(unauthorizedResetStatus).toBe(401);

  await participant.evaluate(async (sessionCode) => {
    await fetch(`http://127.0.0.1:3000/api/e2e/reset-connections?session=${sessionCode}`, {
      method: "POST",
      headers: { Authorization: "Bearer playwright-only" },
    });
  }, code);
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

test("a named live-session invite prompts for sign-in and admits a named participant", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();
  await organizer.goto("/");
  const code = await createSession(organizer, "named");

  const inviteeContext = await browser.newContext();
  await inviteeContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-named-participant");
  });
  const invitee = await inviteeContext.newPage();
  await invitee.goto(`/?session=${code}`);
  await expect(invitee.getByRole("alert")).toHaveText("Sign in to join this live session.");
  await expect(invitee.getByLabel("Session code")).toHaveValue(code);
  await invitee.getByRole("button", { name: "Sign in to join" }).click();
  await expect(invitee.getByRole("heading", { name: "You’re in." })).toBeVisible();
  await expect(organizer.getByTestId("participant-count")).toHaveText("1");

  const namedContext = await browser.newContext();
  await namedContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-named-participant");
  });
  const namedParticipant = await namedContext.newPage();
  await namedParticipant.goto("/");
  await namedParticipant.getByLabel("Session code").fill(code);
  await namedParticipant.getByRole("button", { name: "Sign in to join" }).click();
  await expect(namedParticipant.getByRole("heading", { name: "You’re in." })).toBeVisible();
  await expect(organizer.getByTestId("participant-count")).toHaveText("2");

  await namedContext.close();
  await inviteeContext.close();
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

test("a password-protected invite link prompts for its password", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();
  await organizer.goto("/");
  const code = await createSession(organizer, "anonymous", "correct horse battery staple");

  const participantContext = await browser.newContext();
  const participant = await participantContext.newPage();
  await participant.goto(`/?session=${code}`);
  await expect(participant.getByRole("alert")).toHaveText("Enter the password to join this live session.");
  await expect(participant.getByLabel("Session code")).toHaveValue(code);
  await participant.getByLabel(/Password \(if required\)/).fill("correct horse battery staple");
  await participant.getByTitle("Join session").click();
  await expect(participant.getByRole("heading", { name: "You’re in." })).toBeVisible();

  await participantContext.close();
  await organizerContext.close();
});

test("an organizer starts a single-choice question for a participant", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();
  await organizer.goto("/");
  const code = await createSession(organizer, "anonymous");

  const participantContext = await browser.newContext();
  const participant = await participantContext.newPage();
  await participant.goto(`/?session=${code}`);
  await expect(participant.getByRole("heading", { name: "You’re in." })).toBeVisible();

  await organizer.getByRole("textbox", { name: "Question" }).fill("Which tool will we use?");
  await organizer.getByLabel("Option 1").fill("Quizatz");
  await organizer.getByLabel("Option 2").fill("A whiteboard");
  await organizer.getByRole("button", { name: "Start question" }).click();

  await expect(organizer.getByRole("heading", { name: "Which tool will we use?" })).toBeVisible();
  await expect(participant.getByRole("heading", { name: "Which tool will we use?" })).toBeVisible();
  await expect(participant.getByRole("radio", { name: "Quizatz" })).toBeVisible();
  await expect(participant.getByRole("radio", { name: "A whiteboard" })).toBeVisible();

  await participantContext.close();
  await organizerContext.close();
});

test("an organizer can start a single-choice question with eight options", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();
  await organizer.goto("/");
  const code = await createSession(organizer, "anonymous");

  const participantContext = await browser.newContext();
  const participant = await participantContext.newPage();
  await participant.goto(`/?session=${code}`);

  await organizer.getByRole("textbox", { name: "Question" }).fill("Choose a number");
  for (let index = 1; index <= 8; index += 1) {
    if (index > 2) await organizer.getByRole("button", { name: "Add option" }).click();
    await organizer.getByLabel(`Option ${index}`).fill(String(index));
  }
  await expect(organizer.getByRole("button", { name: "Add option" })).toBeDisabled();
  await organizer.getByRole("button", { name: "Start question" }).click();

  await expect(participant.getByRole("radio", { name: "8" })).toBeVisible();

  await participantContext.close();
  await organizerContext.close();
});

test("participants revise answers before the organizer closes and reveals a single-choice result", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();
  await organizer.goto("/");
  const code = await createSession(organizer, "anonymous");

  const firstParticipantContext = await browser.newContext();
  const firstParticipant = await firstParticipantContext.newPage();
  await firstParticipant.goto(`/?session=${code}`);
  const secondParticipantContext = await browser.newContext();
  const secondParticipant = await secondParticipantContext.newPage();
  await secondParticipant.goto(`/?session=${code}`);

  await organizer.getByRole("textbox", { name: "Question" }).fill("Which tool will we use?");
  await organizer.getByLabel("Option 1").fill("Quizatz");
  await organizer.getByLabel("Option 2").fill("A whiteboard");
  await organizer.getByRole("button", { name: "Start question" }).click();

  await firstParticipant.getByRole("radio", { name: "Quizatz" }).focus();
  await firstParticipant.keyboard.press("Space");
  await expect(firstParticipant.getByText("Answer saved: Quizatz.")).toBeVisible();
  await firstParticipant.keyboard.press("ArrowDown");
  await expect(firstParticipant.getByText("Answer saved: A whiteboard.")).toBeVisible();
  await secondParticipant.getByRole("radio", { name: "Quizatz" }).check();
  await expect(secondParticipant.getByText("Answer saved: Quizatz.")).toBeVisible();

  await organizer.getByRole("button", { name: "Close question" }).click();
  await expect(firstParticipant.getByText("Responses are closed.")).toBeVisible();
  await expect(firstParticipant.getByRole("radio", { name: "Quizatz" })).toHaveCount(0);

  await organizer.getByRole("button", { name: "Reveal result" }).click();
  await expect(firstParticipant.getByRole("progressbar", { name: "Quizatz: 1 response (50%)" })).toBeVisible();
  await expect(firstParticipant.getByRole("progressbar", { name: "A whiteboard: 1 response (50%)" })).toBeVisible();
  await expect(firstParticipant.getByText("2 responses total")).toBeVisible();

  await secondParticipantContext.close();
  await firstParticipantContext.close();
  await organizerContext.close();
});

test("an organizer consolidates and reveals an open-ended result", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();
  await organizer.goto("/");
  const code = await createSession(organizer, "anonymous");

  const firstParticipantContext = await browser.newContext();
  const firstParticipant = await firstParticipantContext.newPage();
  await firstParticipant.goto(`/?session=${code}`);
  const secondParticipantContext = await browser.newContext();
  const secondParticipant = await secondParticipantContext.newPage();
  await secondParticipant.goto(`/?session=${code}`);

  await organizer.getByRole("button", { name: "Open-ended" }).click();
  await organizer.getByRole("textbox", { name: "Question" }).fill("Which city should host the offsite?");
  await organizer.getByRole("button", { name: "Start question" }).click();

  await firstParticipant.getByRole("textbox", { name: "Your answer" }).fill("Gothenburg");
  await firstParticipant.getByRole("button", { name: "Submit answer" }).click();
  await firstParticipant.getByRole("textbox", { name: "Your answer" }).fill("Goteborg");
  await firstParticipant.getByRole("button", { name: "Update answer" }).click();
  await secondParticipant.getByRole("textbox", { name: "Your answer" }).fill("Göteborg");
  await secondParticipant.getByRole("button", { name: "Submit answer" }).click();

  await organizer.getByRole("button", { name: "Close question" }).click();
  await expect(organizer.getByRole("list", { name: "Open-ended results to consolidate" })).toContainText("Goteborg");
  await expect(organizer.getByRole("list", { name: "Open-ended results to consolidate" })).toContainText("Göteborg");
  await expect(firstParticipant.getByText("Responses are closed.")).toBeVisible();
  await expect(firstParticipant.getByRole("list", { name: "Open-ended result" })).toHaveCount(0);

  await organizer.getByRole("button", { name: "Merge Goteborg into Göteborg" }).click();
  await expect(organizer.getByRole("list", { name: "Open-ended results to consolidate" })).toHaveText(/Göteborg.*2 responses/);
  await organizer.getByRole("button", { name: "Reveal result" }).click();
  await expect(firstParticipant.getByRole("list", { name: "Open-ended result" })).toHaveText(/Göteborg.*2 responses/);

  await secondParticipantContext.close();
  await firstParticipantContext.close();
  await organizerContext.close();
});

test("a reconnecting participant revises their active answer without adding another response", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();
  await organizer.goto("/");
  const code = await createSession(organizer, "anonymous");

  const participantContext = await browser.newContext();
  const participant = await participantContext.newPage();
  await participant.goto(`/?session=${code}`);
  await organizer.getByRole("textbox", { name: "Question" }).fill("Which tool will we use?");
  await organizer.getByLabel("Option 1").fill("Quizatz");
  await organizer.getByLabel("Option 2").fill("A whiteboard");
  await organizer.getByRole("button", { name: "Start question" }).click();
  await participant.getByRole("radio", { name: "Quizatz" }).check();

  await participant.evaluate(async (sessionCode) => {
    await fetch(`http://127.0.0.1:3000/api/e2e/reset-connections?session=${sessionCode}`, {
      method: "POST",
      headers: { Authorization: "Bearer playwright-only" },
    });
  }, code);
  await expect.poll(async () => participant.evaluate(async (sessionCode) => {
    const response = await fetch(
      `http://127.0.0.1:3000/api/e2e/connection-count?session=${sessionCode}`,
      { headers: { Authorization: "Bearer playwright-only" } },
    );
    return ((await response.json()) as { connectionCount: number }).connectionCount;
  }, code)).toBe(2);

  await participant.getByRole("radio", { name: "A whiteboard" }).check();
  await expect(participant.getByText("Answer saved: A whiteboard.")).toBeVisible();
  await organizer.getByRole("button", { name: "Close question" }).click();
  await organizer.getByRole("button", { name: "Reveal result" }).click();
  await expect(participant.getByRole("progressbar", { name: "Quizatz: 0 responses (0%)" })).toBeVisible();
  await expect(participant.getByRole("progressbar", { name: "A whiteboard: 1 response (100%)" })).toBeVisible();
  await expect(participant.getByText("1 response total")).toBeVisible();

  await participantContext.close();
  await organizerContext.close();
});

test("a nonexistent session code has a clear error state", async ({ page }) => {
  await page.goto("/?session=000000");
  await expect(page.getByRole("alert")).toHaveText("That live session was not found or has expired.");
});
