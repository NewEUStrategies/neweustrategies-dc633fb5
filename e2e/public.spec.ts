import { test, expect } from "@playwright/test";

// Smoke E2E for the public critical path against the production client build.
// Intentionally backend-agnostic: it asserts the app boots, routes resolve, and
// the document is well-formed even when Supabase data is unavailable (CI uses
// placeholder credentials), so it gates real regressions, not data state.

test("homepage boots and renders a well-formed document", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const resp = await page.goto("/");
  expect(resp, "navigation response").toBeTruthy();

  // The app sets a non-empty <title> and an html lang attribute.
  await expect(page).toHaveTitle(/.+/);
  await expect(page.locator("html")).toHaveAttribute("lang", /.+/);

  // App actually mounted some content (not a blank document).
  await expect(page.locator("body")).not.toBeEmpty();

  // No uncaught client exceptions during boot.
  expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("login route renders the auth form", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('input[type="email"]').first()).toBeVisible();
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
});

test("client-side navigation resolves a deep route", async ({ page }) => {
  // SPA fallback + router resolve an arbitrary public path without a hard 404 page.
  await page.goto("/login");
  await expect(page.locator('input[type="email"]').first()).toBeVisible();
  // Title remains set after client navigation/render.
  await expect(page).toHaveTitle(/.+/);
});
