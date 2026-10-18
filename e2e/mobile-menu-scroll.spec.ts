import { expect, test } from "@playwright/test";

test("hamburger menu scrolls independently after builder search mounts", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 706 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
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
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
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