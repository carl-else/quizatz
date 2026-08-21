import { expect, test } from "@playwright/test";

async function createSession(page: import("@playwright/test").Page): Promise<string> {
  await page.getByRole("button", { name: "Sign in and create" }).click();
  const code = await page.getByTestId("session-code").textContent();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  return code as string;
}

test("the public display status reveals only a waiting status", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();

  try {
    await organizer.goto("/");
    const code = await createSession(organizer);
    const waiting = await organizer.evaluate(async (sessionCode) => {
      const response = await fetch(`http://127.0.0.1:3000/api/sessions/${sessionCode}/display-status`);
      return { body: await response.json(), status: response.status };
    }, code);
    expect(waiting).toEqual({ body: { status: "waiting" }, status: 200 });

    const malformed = await organizer.evaluate(async () => {
      const response = await fetch("http://127.0.0.1:3000/api/sessions/invalid/display-status");
      return { body: await response.json(), status: response.status };
    });
    expect(malformed).toEqual({ body: { status: "unavailable" }, status: 200 });

    const missing = await organizer.evaluate(async () => {
      const response = await fetch("http://127.0.0.1:3000/api/sessions/ABC234/display-status");
      return { body: await response.json(), status: response.status };
    });
    expect(missing).toEqual({ body: { status: "unavailable" }, status: 200 });
  } finally {
    await organizerContext.close();
  }
});

test("the public display status follows live-session lifecycle without exposing session data", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();

  try {
    await organizer.goto("/");
    const code = await createSession(organizer);
    const getStatus = () => organizer.evaluate(async (sessionCode) => {
      const response = await fetch(`http://127.0.0.1:3000/api/sessions/${sessionCode}/display-status`);
      return response.json();
    }, code);

    await organizer.getByRole("textbox", { name: "Question" }).fill("Which display state is active?");
    await organizer.getByLabel("Option 1").fill("In progress");
    await organizer.getByLabel("Option 2").fill("Waiting");
    await organizer.getByRole("button", { name: "Start question" }).click();
    await expect(organizer.getByRole("heading", { name: "Which display state is active?" })).toBeVisible();
    expect(await getStatus()).toEqual({ status: "in-progress" });

    await organizer.getByRole("button", { name: "Close question" }).click();
    await organizer.getByRole("button", { name: "Reveal result" }).click();
    await organizer.getByRole("button", { name: "End live session" }).click();
    expect(await getStatus()).toEqual({ status: "ended" });

    await organizer.evaluate(async (sessionCode) => {
      await fetch(`http://127.0.0.1:3000/api/e2e/clock?session=${sessionCode}&advanceMs=86400000`, {
        method: "POST",
        headers: { Authorization: "Bearer playwright-only" },
      });
    }, code);
    expect(await getStatus()).toEqual({ status: "unavailable" });
  } finally {
    await organizerContext.close();
  }
});

test("an organizer opens the QR join display and its text link joins the live session", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();

  try {
    await organizer.goto("/");
    const code = await createSession(organizer);
    const displayLink = organizer.getByRole("link", { name: "Open QR join display" });
    await expect(displayLink).toHaveAttribute("target", "_blank");
    await expect(displayLink).toHaveAttribute("rel", "noopener");
    const displayPromise = organizerContext.waitForEvent("page");
    await displayLink.click();
    const display = await displayPromise;
    await expect(display.getByRole("status")).toHaveText("Ready to join");

    await display.getByRole("link", { name: new RegExp(`session=${code}`) }).click();
    await expect(display.getByRole("heading", { name: "You’re in." })).toBeVisible();
  } finally {
    await organizerContext.close();
  }
});

test("the QR join display maps status responses and preserves joining on status failure", async ({ browser }) => {
  const organizerContext = await browser.newContext();
  await organizerContext.addInitScript(() => {
    window.sessionStorage.setItem("quizatz:e2e-access-token", "playwright-only");
  });
  const organizer = await organizerContext.newPage();

  try {
    await organizer.goto("/");
    const code = await createSession(organizer);
    const waitingDisplay = await organizerContext.newPage();
    let statusRequestCount = 0;
    waitingDisplay.on("request", (request) => {
      if (request.url().endsWith(`/api/sessions/${code}/display-status`)) statusRequestCount += 1;
    });
    await waitingDisplay.goto(`/join-display.html?session=${code}`);
    await expect(waitingDisplay.getByRole("status")).toHaveText("Ready to join");
    await expect(waitingDisplay.locator(".qr-code svg")).toBeVisible();
    await expect(waitingDisplay.getByRole("link", { name: new RegExp(`session=${code}`) })).toBeVisible();
    expect(statusRequestCount).toBe(1);

    await organizer.getByRole("textbox", { name: "Question" }).fill("Which display state is active?");
    await organizer.getByLabel("Option 1").fill("In progress");
    await organizer.getByLabel("Option 2").fill("Waiting");
    await organizer.getByRole("button", { name: "Start question" }).click();
    await expect(organizer.getByRole("heading", { name: "Which display state is active?" })).toBeVisible();
    const inProgressDisplay = await organizerContext.newPage();
    await inProgressDisplay.goto(`/join-display.html?session=${code}`);
    await expect(inProgressDisplay.getByRole("status")).toHaveText("Live session in progress");
    await expect(inProgressDisplay.locator(".qr-code svg")).toBeVisible();

    await organizer.getByRole("button", { name: "Close question" }).click();
    await organizer.getByRole("button", { name: "Reveal result" }).click();
    await organizer.getByRole("button", { name: "End live session" }).click();
    const endedDisplay = await organizerContext.newPage();
    await endedDisplay.goto(`/join-display.html?session=${code}`);
    await expect(endedDisplay.getByRole("status")).toHaveText("This live session has ended");
    await expect(endedDisplay.locator(".qr-code")).toBeHidden();
    await expect(endedDisplay.getByRole("link", { name: new RegExp(`session=${code}`) })).toBeHidden();

    const unavailableDisplay = await organizerContext.newPage();
    await unavailableDisplay.goto("/join-display.html?session=not-a-code");
    await expect(unavailableDisplay.getByRole("status")).toHaveText("This live session is no longer available");
    await expect(unavailableDisplay.locator(".qr-code")).toBeHidden();

    const failedDisplay = await organizerContext.newPage();
    await failedDisplay.route(/\/api\/sessions\/[^/]+\/display-status$/, (route) => route.abort());
    await failedDisplay.goto(`/join-display.html?session=${code}`);
    await expect(failedDisplay.getByRole("status")).toHaveText("Could not verify live-session status.");
    await expect(failedDisplay.locator(".qr-code svg")).toBeVisible();
    await expect(failedDisplay.getByRole("link", { name: new RegExp(`session=${code}`) })).toBeVisible();
  } finally {
    await organizerContext.close();
  }
});