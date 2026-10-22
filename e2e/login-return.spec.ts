import { test, expect, type Page } from "@playwright/test";

// POWRÓT PO ZALOGOWANIU (hub S3, P15) - bez bazy danych.
//
// `/login` przyjmuje `next` (ścieżka powrotu), `intent` i `plan`; portal po
// ustaleniu sesji wraca na `next` - WYŁĄCZNIE ścieżkę względną w obrębie
// serwisu. Ten plik prowadzi prawdziwy portal na serwerze dev z zaślepkowymi
// poświadczeniami Supabase, więc „zalogowanego" udaje sesja w magazynie
// (ten sam zabieg co `e2e/event-paid-registration.spec.ts`: przechwycony
// ODCZYT klucza `sb-<ref>-auth-token`, bo `<ref>` zależy od projektu).
//
// Asercje mierzą ADRES po nawigacji portalu: bezpieczny `next` -> ta ścieżka
// (z zapytaniem), wrogi (`//evil`, `https://…`, `/\evil`, `%2F%2F`) -> strona
// główna TEGO serwisu, `plan` bez `next` -> kasa planu.

test.describe.configure({ mode: "serial", timeout: 120_000 });

const PLAN = "11111111-1111-4111-8111-111111111111";

async function signIn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const session = JSON.stringify({
      access_token: "e2e-access-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "e2e-refresh-token",
      user: {
        id: "00000000-0000-4000-8000-0000000000e2",
        aud: "authenticated",
        role: "authenticated",
        email: "czytelnik@example.org",
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

function sameOrigin(page: Page): string {
  return new URL(page.url()).origin;
}

test("zalogowany wraca na artykuł z next (z zapytaniem)", async ({ page, baseURL }) => {
  await signIn(page);
  await page.goto(`/login?next=${encodeURIComponent("/pricing?ref=paywall")}&intent=paywall`);
  await page.waitForURL((url) => url.pathname === "/pricing", { timeout: 90_000 });
  const url = new URL(page.url());
  expect(url.origin).toBe(new URL(baseURL ?? page.url()).origin);
  expect(url.searchParams.get("ref")).toBe("paywall");
});

for (const evil of [
  "//evil.example/x",
  "https://evil.example/x",
  "/\\evil.example",
  "%2F%2Fevil.example",
  "/%2F%2Fevil.example",
]) {
  test(`wrogi next ${JSON.stringify(evil)} kończy się na stronie głównej serwisu`, async ({
    page,
    baseURL,
  }) => {
    await signIn(page);
    await page.goto(`/login?next=${encodeURIComponent(evil)}`);
    await page.waitForURL((url) => url.pathname === "/", { timeout: 90_000 });
    expect(sameOrigin(page)).toBe(new URL(baseURL ?? page.url()).origin);
    expect(page.url()).not.toContain("evil.example");
  });
}

test("plan bez next prowadzi do kasy tego planu", async ({ page }) => {
  await signIn(page);
  await page.goto(`/login?mode=signin&intent=pricing&plan=${PLAN}`);
  await page.waitForURL((url) => url.pathname === `/checkout/${PLAN}`, { timeout: 90_000 });
});

test("gość zostaje na logowaniu - next czeka na zalogowanie", async ({ page }) => {
  await page.goto(`/login?mode=signin&next=${encodeURIComponent("/pricing")}`);
  await expect(page.locator("form").first()).toBeVisible({ timeout: 90_000 });
  expect(new URL(page.url()).pathname).toBe("/login");
});
