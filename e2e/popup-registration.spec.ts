// Real account + captured confirmation email. Run only against disposable local Supabase.
import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { decodeHTML } from "entities";

const SEEDED = process.env.E2E_SEEDED === "1";
const api = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const inbox = process.env.E2E_MAIL_URL ?? "http://127.0.0.1:54324";
const local = (url: string) => ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
const adminHeaders = () => ({
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
});

async function adminGet(request: APIRequestContext, path: string) {
  const response = await request.get(`${api}${path}`, { headers: adminHeaders() });
  expect(response.ok(), `local Data API ${path}: ${response.status()}`).toBe(true);
  return response;
}

async function confirmationLink(request: APIRequestContext, email: string) {
  let id = "";
  await expect(async () => {
    const response = await request.get(`${inbox}/api/v1/search`, {
      params: { query: `to:${email}` },
    });
    expect(response.ok()).toBe(true);
    const result: { messages: { ID: string }[] } = await response.json();
    id = result.messages[0]?.ID ?? "";
    expect(id).not.toBe("");
  }).toPass({ timeout: 30_000 });
  const response = await request.get(`${inbox}/api/v1/message/${id}`);
  expect(response.ok()).toBe(true);
  const message: { HTML: string; To: { Address: string }[] } = await response.json();
  expect(message.To.map((to) => to.Address)).toContain(email);
  const links = [...message.HTML.matchAll(/href=["']([^"']+)["']/g)].map((match) =>
    decodeHTML(match[1]),
  );
  const link = links.find((value) => new URL(value).pathname === "/auth/v1/verify");
  expect(link, "captured email contains a confirmation link").toBeTruthy();
  const url = new URL(link!);
  // Never follow an external mail link from this test, even after a config mistake.
  expect(local(url.href)).toBe(true);
  expect(url.origin).toBe(new URL(api).origin);
  return url.href;
}

test.describe("popup registration (local account and mailbox)", () => {
  test.skip(!SEEDED, "requires disposable local Supabase with E2E_SEEDED=1");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  let tenantId = "";
  let original: Record<string, unknown> | undefined;
  test.beforeAll(async ({ request }) => {
    expect(local(api) && local(inbox), "registration E2E must never target production").toBe(true);
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
    const tenants: { id: string }[] = await (
      await adminGet(request, "/rest/v1/tenants?slug=eq.nes&select=id")
    ).json();
    tenantId = tenants[0].id;
    const settings: Record<string, unknown>[] = await (
      await adminGet(request, `/rest/v1/newsletter_settings?tenant_id=eq.${tenantId}`)
    ).json();
    original = settings[0];
  });

  test.afterAll(async ({ request }) => {
    if (!tenantId || !local(api)) return;
    if (original) {
      const response = await request.post(
        `${api}/rest/v1/newsletter_settings?on_conflict=tenant_id`,
        {
          headers: { ...adminHeaders(), Prefer: "resolution=merge-duplicates" },
          data: original,
        },
      );
      expect(response.ok()).toBe(true);
    } else {
      const response = await request.delete(
        `${api}/rest/v1/newsletter_settings?tenant_id=eq.${tenantId}`,
        { headers: adminHeaders() },
      );
      expect(response.ok()).toBe(true);
    }
  });

  for (const scenario of [
    { layout: "stacked", newsletter: false, viewport: { width: 1280, height: 900 } },
    { layout: "showcase", newsletter: true, viewport: { width: 390, height: 844 } },
  ]) {
    test(`${scenario.layout}: account, confirmation email, newsletter=${scenario.newsletter}`, async ({
      page,
      request,
    }, testInfo) => {
      const response = await request.post(
        `${api}/rest/v1/newsletter_settings?on_conflict=tenant_id`,
        {
          headers: { ...adminHeaders(), Prefer: "resolution=merge-duplicates" },
          data: {
            tenant_id: tenantId,
            enabled: true,
            double_opt_in: false,
            popup_enabled: true,
            popup_trigger: "delay",
            popup_delay_seconds: 1,
            popup_layout: scenario.layout,
            popup_extended_fields: false,
            popup_require_terms: false,
            popup_require_privacy: true,
            popup_privacy_html_pl: "Akceptuję politykę prywatności.",
            popup_fields: [],
            popup_mailing_lists: [],
            popup_doc: null,
            popup_title_pl: "Załóż konto",
            popup_cta_pl: "Załóż konto",
          },
        },
      );
      expect(response.ok(), await response.text()).toBe(true);
      const email = `popup-${randomUUID()}@example.test`;
      await page.setViewportSize(scenario.viewport);
      await page.goto("/");
      await page
        .getByRole("button", { name: /Akceptuj wszystkie|Accept all/i })
        .click({ timeout: 60_000 });
      const dialog = page.getByRole("dialog").filter({ has: page.locator("#nl-popup-title") });
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      const field = dialog.locator('input[type="email"]');
      await field.fill(email);
      const passwords = dialog.locator('input[type="password"]');
      await passwords.nth(0).fill("Popup-test-1234!");
      await passwords.nth(1).fill("Popup-test-1234!");
      await dialog.getByRole("checkbox").nth(0).setChecked(scenario.newsletter);
      await dialog.getByRole("checkbox").nth(1).check();

      if (scenario.viewport.width < 500) {
        await page.screenshot({ path: testInfo.outputPath("mobile-popup.png") });
        // Models reduced available height, not an actual OS keyboard.
        await page.setViewportSize({ width: 390, height: 420 });
        await field.focus();
        await expect(field).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await dialog
          .getByRole("button", { name: "Załóż konto", exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath("mobile-reduced-height.png") });
      }
      // The real form has a 1200ms anti-automation guard; exercise human submission.
      await page.waitForTimeout(1300);
      const signup = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/auth/v1/signup" && r.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Załóż konto", exact: true }).click();
      const signupResponse = await signup;
      expect(signupResponse.ok()).toBe(true);
      const user: { id: string; access_token?: string } = await signupResponse.json();
      expect(user.id).toBeTruthy();
      expect(user.access_token).toBeUndefined();
      await expect(dialog.getByRole("status")).toContainText(email, { timeout: 30_000 });
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      const before: {
        email_confirmed_at?: string | null;
        user_metadata: { signup_consents: unknown[] };
      } = await (await adminGet(request, `/auth/v1/admin/users/${user.id}`)).json();
      expect(before.email_confirmed_at ?? null).toBeNull();
      expect(before.user_metadata.signup_consents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "privacy",
            given: true,
            version: expect.stringMatching(/^sha256:/),
            timestamp: expect.any(String),
          }),
        ]),
      );
      const rows: { status: string; consents: { received_at: string }[] }[] = await (
        await adminGet(
          request,
          `/rest/v1/newsletter_subscribers?email=eq.${encodeURIComponent(email)}&tenant_id=eq.${tenantId}&select=status,consents`,
        )
      ).json();
      expect(rows).toHaveLength(scenario.newsletter ? 1 : 0);
      if (scenario.newsletter) {
        expect(rows[0].status).toBe("subscribed");
        expect(
          rows[0].consents.every((consent) => Number.isFinite(Date.parse(consent.received_at))),
        ).toBe(true);
      }
      const link = await confirmationLink(request, email);
      const confirmation = await request.get(link, { maxRedirects: 0 });
      expect(confirmation.status()).toBe(303);
      const after: { email_confirmed_at: string } = await (
        await adminGet(request, `/auth/v1/admin/users/${user.id}`)
      ).json();
      expect(Number.isFinite(Date.parse(after.email_confirmed_at))).toBe(true);
      await testInfo.attach("account-confirmation", {
        body: JSON.stringify({
          layout: scenario.layout,
          newsletter: scenario.newsletter,
          confirmed: true,
        }),
        contentType: "application/json",
      });
    });
  }
});
