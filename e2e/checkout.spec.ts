import { test, expect } from "@playwright/test";

// E2E for the public payment funnel UI. Like public.spec.ts this is
// intentionally backend-agnostic: CI drives the real SSR app with placeholder
// Supabase credentials, so we assert the funnel's *structure* - routes resolve,
// the checkout step is gated behind auth, and the success/cancel pages render -
// rather than data state. The money path's data side (paid order -> entitlement)
// is covered deterministically by the Vitest webhook + grant tests; a fully
// data-driven flow (seeded plan -> Stripe session -> webhook -> unlocked content)
// additionally needs a seeded test Supabase project and Stripe test keys.

// SERWER DEWELOPERSKI KOMPILUJE TRASĘ PRZY PIERWSZYM WEJŚCIU (a `predev`
// czyści cache Vite przed każdym przebiegiem), więc pierwsze wejście bywa
// wielokrotnie wolniejsze od kolejnych - ten sam powód i ten sam zabieg, co
// w `e2e/event-paid-registration.spec.ts`. ZMIERZONE na tym HEAD
// (`/checkout/<uuid>`, poświadczenia zastępcze, serwer dev): dokument wraca po
// 1,2-3,0 s, ale gotowość hydratacji (`__nesAppReady`, 244 zasoby skryptowe)
// wypada po 4,5-11 s przy zimnym starcie i przy równoległych workerach.
// Domyślne 30 s na przypadek wystarczało dopóty, dopóki trasa nie była
// „chrome-only"; dziś trafia w nie regularnie na pierwszym przebiegu.
test.describe.configure({ timeout: 120_000 });

function collectErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/**
 * Czeka na gotowość hydratacji - flagę ustawianą synchronicznie w efekcie
 * montowania korzenia (`lib/watchdog/appReady`). Dokładnie ten sam sygnał,
 * na którym stoi `e2e/boot-artifact.spec.ts`.
 *
 * PO CO ODDZIELNIE, skoro `page.goto` czeka na `load`: `load` mówi tylko, że
 * dokument i jego zasoby DOJECHAŁY - a na powierzchni bez serwerowego renderu
 * treści cała treść powstaje DOPIERO po hydratacji. Bez tej bramy budżet
 * asercji niżej mierzyłby kompilację modułów przez serwer dev, a nie to, co
 * ten test ma mierzyć: rozstrzygnięcie tożsamości.
 */
async function waitForHydration(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () => (window as unknown as { __nesAppReady?: boolean }).__nesAppReady === true,
    undefined,
    { timeout: 90_000 },
  );
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
  // Any plan id - the route is public (GuestCheckoutGate renders an inline
  // sign-in / guest CTA instead of redirecting), so a logged-out visitor must
  // be offered sign-in.
  await page.goto("/checkout/00000000-0000-0000-0000-000000000000");
  await expect(page).toHaveTitle(/Checkout/);
  // `/checkout` jest od 2026-09-20 powierzchnią „chrome-only"
  // (`lib/routing/clientOnlyDocument.ts`): serwer maluje nagłówek i stopkę,
  // a o treści decyduje sesja z `localStorage` PO HYDRATACJI. Najpierw brama
  // hydratacji, potem - w domyślnym budżecie 10 s - asercja o tym, co ten test
  // naprawdę sprawdza. Rozstrzygnięcie „to gość" jest po hydratacji
  // natychmiastowe i bezsieciowe (pusty magazyn sesji = pewna odpowiedź, patrz
  // `hasStoredAuthSession` w `src/hooks/useAuth.tsx`), więc 10 s zostaje realną
  // asercją, a nie zakamuflowanym czekaniem na kompilację modułów.
  await waitForHydration(page);
  // The guest checkout gate links to /login (sign in / sign up).
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
