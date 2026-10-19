import { test, expect, type Page } from "@playwright/test";

// LEJEK CZYTELNIKA ZA PAYWALLEM (hub S3) - bez bazy danych.
//
// Sama ściana artykułu wymaga treści z bazy (loader SSR), więc jej macierz
// person (gość, zarejestrowany bez planu, ranga za niska, z planem, limit,
// hasło, organizacja, plan na zapytanie) jest w `src/components/__tests__/
// Paywall.reader.test.tsx`. Tu - to, co z paywalla wychodzi do przeglądarki
// i da się sprawdzić na serwerze dev z zaślepkowymi poświadczeniami:
//   * rejestracja z paywalla (`intent=paywall`) otwiera formularz rejestracji
//     i NIE gubi ścieżki powrotu,
//   * link aktywacyjny z e-maila (`/auth/callback?next=`) wraca na treść,
//     a wrogi `next` - na stronę powitalną,
//   * strona sukcesu kasy wraca na artykuł/klub zapamiętany przez ścianę,
//     ale nigdy pod adres spoza serwisu (także zakodowany).

test.describe.configure({ mode: "serial", timeout: 120_000 });

async function signIn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const session = JSON.stringify({
      access_token: "e2e-access-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "e2e-refresh-token",
      user: {
        id: "00000000-0000-4000-8000-0000000000e3",
        aud: "authenticated",
        role: "authenticated",
        email: "nowe-konto@example.org",
        app_metadata: {},
        user_metadata: {},
        created_at: "2026-01-01T00:00:00.000Z",
      },
    });
    const nativeGetItem = window.Storage.prototype.getItem;
    window.Storage.prototype.getItem = function patched(key: string): string | null {
      if (/^sb-.+-auth-token$/.test(key)) return session;
      return nativeGetItem.call(this, key);
    };
  });
}

test("rejestracja z paywalla otwiera formularz rejestracji i zachowuje powrót", async ({
  page,
}) => {
  await page.goto(`/login?mode=signup&intent=paywall&next=${encodeURIComponent("/analizy")}`);
  await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 90_000 });
  // Formularz rejestracji ma potwierdzenie hasła albo pola profilu - logowanie
  // ma wyłącznie e-mail i jedno hasło. Adres nie traci `next`.
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("next")).toBe("/analizy");
  expect(url.searchParams.get("intent")).toBe("paywall");
});

test("link aktywacyjny z next wraca na treść, przez którą powstało konto", async ({ page }) => {
  await signIn(page);
  await page.goto(`/auth/callback?next=${encodeURIComponent("/pricing?from=signup")}`);
  await page.waitForURL((url) => url.pathname === "/pricing", { timeout: 90_000 });
  expect(new URL(page.url()).searchParams.get("from")).toBe("signup");
});

test("link aktywacyjny z wrogim next kończy na stronie powitalnej", async ({ page }) => {
  await signIn(page);
  await page.goto(`/auth/callback?next=${encodeURIComponent("//evil.example/x")}`);
  await page.waitForURL((url) => url.pathname === "/welcome", { timeout: 90_000 });
  expect(page.url()).not.toContain("evil.example");
});

async function successWithReturn(page: Page, returnTo: string): Promise<void> {
  await page.addInitScript((value: string) => {
    window.sessionStorage.setItem("checkout:returnTo", value);
  }, returnTo);
  await page.goto("/checkout/success?order=e2e-order");
}

test("sukces kasy wraca do klubu zapamiętanego przez bramkę", async ({ page }) => {
  await successWithReturn(page, "/club/klub-e2e");
  const back = page.getByRole("link", { name: /Wróć do artykułu|Back to the article/ });
  await expect(back).toBeVisible({ timeout: 90_000 });
  await expect(back).toHaveAttribute("href", "/club/klub-e2e");
});

test("sukces kasy odrzuca zakodowany adres spoza serwisu", async ({ page }) => {
  await successWithReturn(page, "/%2F%2Fevil.example");
  await expect(
    page.getByRole("link", { name: /Wróć na stronę główną|Back to homepage/ }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(
    page.getByRole("link", { name: /Wróć do artykułu|Back to the article/ }),
  ).toHaveCount(0);
  expect(await page.content()).not.toContain("evil.example");
});
