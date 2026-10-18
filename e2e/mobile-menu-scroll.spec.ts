// Mobile hamburger menu: the drawer's scroll root keeps native scrolling after
// the lazy builder search widget mounts inside it.
//
// The menu button exists only when the tenant has a builder header
// (`site_settings.header.builder_data`); without one `Header` renders
// `HeaderSkeleton`, which has no button at all. Neither the placeholder backend
// of the `e2e` job nor the bare seed has that row, so this spec runs only
// against the disposable local Supabase of the `e2e-seeded` job: beforeAll
// installs the repo's default header document (the one the header editor
// seeds), afterAll restores the previous row.
import { expect, test, type APIRequestContext } from "@playwright/test";
import { defaultDocFor } from "../src/lib/builder/chromeDefaults";
import { isBuilderDoc } from "../src/lib/builder/schema";
import type { BuilderDocument } from "../src/lib/builder/types";

const SEEDED = process.env.E2E_SEEDED === "1";
const api = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const local = (url: string) => ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
const adminHeaders = () => ({
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
});

// The webServer readiness probe renders `/` before beforeAll runs, so the
// in-process document cache holds a header-less `/` (s-maxage=900). An
// unkeyed query parameter makes `planDocumentCache` bypass that cache.
const HOME = "/?e2e=mobile-menu-scroll";

type SettingRow = { tenant_id: string; key: string; value: unknown };

async function adminJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`${api}${path}`, { headers: adminHeaders() });
  expect(response.ok(), `local Data API ${path}: ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

async function upsertSetting(request: APIRequestContext, row: SettingRow) {
  const response = await request.post(`${api}/rest/v1/site_settings?on_conflict=tenant_id,key`, {
    headers: { ...adminHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    data: row,
  });
  expect(response.ok(), await response.text()).toBe(true);
}

function widgetTypes(doc: BuilderDocument): string[] {
  return doc.sections.flatMap((section) =>
    section.children.flatMap((child) =>
      (child.kind === "inner-section" ? child.columns : [child]).flatMap((column) =>
        column.children.map((widget) => widget.type),
      ),
    ),
  );
}

test.describe("mobile menu scroll (seeded header)", () => {
  test.skip(!SEEDED, "requires disposable local Supabase with E2E_SEEDED=1");
  // The spec runs alone on a fresh dev server: its first browser visit pays
  // for compiling the whole client graph (about 20 s before app-ready).
  test.setTimeout(120_000);

  let tenantId = "";
  let original: SettingRow | undefined;
  let installed = false;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    expect(local(api), "settings E2E must never target production").toBe(true);
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
    const tenants = await adminJson<{ id: string }[]>(
      request,
      "/rest/v1/tenants?slug=eq.nes&select=id",
    );
    tenantId = tenants[0].id;
    const rows = await adminJson<SettingRow[]>(
      request,
      `/rest/v1/site_settings?tenant_id=eq.${tenantId}&key=eq.header&select=tenant_id,key,value`,
    );
    original = rows[0];

    // The drawer renders this document through `BuilderRenderer` (its default
    // section order includes `builder`); the nav row carries `search-button`.
    const builderData = defaultDocFor("header");
    expect(isBuilderDoc(builderData)).toBe(true);
    expect(widgetTypes(builderData)).toContain("search-button");
    await upsertSetting(request, {
      tenant_id: tenantId,
      key: "header",
      value: { builder_data: builderData },
    });
    installed = true;

    // SSR reads site settings through `edgeTtlCache` (60 s TTL, then
    // serve-stale with a background refresh), already warmed by the readiness
    // probe. No public API purges it, so wait until SSR serves the new header:
    // at most one TTL plus one refresh request.
    await expect
      .poll(
        async () => {
          const response = await request.get(HOME);
          return (await response.text()).includes('aria-controls="mobile-header-drawer"');
        },
        { message: "SSR serves the installed header", timeout: 150_000, intervals: [2_000] },
      )
      .toBe(true);
  });

  test.afterAll(async ({ request }) => {
    if (!installed || !local(api)) return;
    if (original) {
      await upsertSetting(request, original);
    } else {
      const response = await request.delete(
        `${api}/rest/v1/site_settings?tenant_id=eq.${tenantId}&key=eq.header`,
        { headers: adminHeaders() },
      );
      expect(response.ok()).toBe(true);
    }
  });

  test("hamburger menu scrolls independently after builder search mounts", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 706 });
    await page.goto(HOME, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__nesAppReady === true);
    const consent = page.getByRole("button", { name: /^(Tylko niezbędne|Necessary only)$/ });
    if (await consent.isVisible()) await consent.click();
    await page.getByRole("button", { name: /^(Otwórz menu|Open menu)$/ }).click();
    const drawer = page.locator("#mobile-header-drawer");
    const scroller = drawer.locator("[data-mobile-drawer-scroller]");
    await expect(scroller).toBeVisible();
    // Wait for the lazy builder to mount the search widget which used to
    // remove overflow from the scroll root after the menu's first render.
    await expect(drawer.locator(".builder-search-widget").first()).toBeAttached();
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeGreaterThan(0);
    const pageTop = await page.evaluate(() => window.scrollY);
    await scroller.hover();
    await page.mouse.wheel(0, 450);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageTop);
    await page.getByRole("button", { name: /^(Zamknij menu|Close menu)$/ }).click();
    await expect(drawer).toHaveCount(0);
    await page.mouse.move(190, 500);
    await page.mouse.wheel(0, 450);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(pageTop);
  });
});
