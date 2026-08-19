import { expect, test } from "@playwright/test";

test("the Microsoft callback does not mount the Quizatz application", async ({ page }) => {
  await page.goto("/auth-callback.html");

  await expect(page.locator("#app")).toHaveCount(0);
  await expect(page).toHaveTitle("Microsoft Authentication");
});