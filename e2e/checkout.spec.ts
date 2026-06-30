import { test, expect } from "@playwright/test";

// E2E for the public payment funnel UI. Like public.spec.ts this is
// intentionally backend-agnostic: CI drives the real SSR app with placeholder
// Supabase credentials, so we assert the funnel's *structure* — routes resolve,
// the checkout step is gated behind auth, and the success/cancel pages render —
// rather than data state. The money path's data side (paid order -> entitlement)
// is covered deterministically by the Vitest webhook + grant tests; a fully
// data-driven flow (seeded plan -> Stripe session -> webhook -> unlocked content)
// additionally needs a seeded test Supabase project and Stripe test keys.

function collectErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

test("pricing page boots and renders a well-formed document", async ({ page }) => {
  const errors = collectErrors(page);
  const resp = await page.goto("/pricing");
  expect(resp, "navigation response").toBeTruthy();
  await expect(page).toHaveTitle(/.+/);
  await expect(page.locator("body")).not.toBeEmpty();
  expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("checkout step is gated behind authentication when logged out", async ({ page }) => {
  const errors = collectErrors(page);
  // Any plan id — the route is public (AuthGate renders an inline sign-in CTA
  // instead of redirecting), so a logged-out visitor must be offered sign-in.
  await page.goto("/checkout/00000000-0000-0000-0000-000000000000");
  await expect(page).toHaveTitle(/Checkout/);
  // The AuthGate fallback links to /login (sign in / sign up).
  await expect(page.locator('a[href*="/login"]').first()).toBeVisible();
  expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("checkout success page renders the confirmation without a backend call", async ({ page }) => {
  const errors = collectErrors(page);
  // No `order`/`mock` search params -> the mock finaliser effect is skipped, so
  // this asserts the success UI renders standalone.
  await page.goto("/checkout/success");
  await expect(page).toHaveTitle(/.+/);
  // Confirmation offers a route back into the account area.
  await expect(page.locator('a[href*="/profile"]').first()).toBeVisible();
  expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("checkout cancel page resolves and is well-formed", async ({ page }) => {
  const errors = collectErrors(page);
  const resp = await page.goto("/checkout/cancel");
  expect(resp, "navigation response").toBeTruthy();
  await expect(page).toHaveTitle(/.+/);
  await expect(page.locator("body")).not.toBeEmpty();
  expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
});
