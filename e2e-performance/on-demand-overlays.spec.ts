import { expect, test } from "@playwright/test";
import {
  fixtureImage,
  fixtureResponse,
  homeFixture,
  isFixtureBackend,
} from "../scripts/performance/homeFixture";

test("first-use overlays stay out of startup and respond to the first request", async ({
  page,
}) => {
  const scripts: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(new URL(request.url()).pathname);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => url.hostname !== "127.0.0.1" || isFixtureBackend(url.href),
    async (route) => {
      const request = route.request();
      if (isFixtureBackend(request.url())) {
        const response = await fixtureResponse(
          new Request(request.url(), {
            method: request.method(),
            headers: request.headers(),
            body: request.method() === "POST" ? request.postData() : undefined,
          }),
          { delayMs: 40 },
        );
        return route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: await response.text(),
        });
      }
      if (request.resourceType() === "image") {
        return route.fulfill({ body: fixtureImage, contentType: homeFixture.fixture_image_type });
      }
      return route.continue();
    },
  );
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await page.waitForFunction(() => window.__nesAppReady === true);
  await page.getByRole("button", { name: "Tylko niezbędne", exact: true }).click();
  // These are HTTP hints for the widgets present in this fixture, including
  // the nested renderer that previously waited for PostsSliderWidget to run.
  const hints = response!.headers()["link"] ?? "";
  expect(hints).toMatch(/PostsSliderWidget[^>]*>; rel="modulepreload"/);
  expect(hints).toMatch(/sliderVariants[^>]*>; rel="modulepreload"/);
  expect(
    scripts.filter((url) =>
      /\/(?:LoginPopup-|CommandPalette-|ExpertRequestDialog-|SearchOverlay-|MobileDrawerBody-)/.test(
        url,
      ),
    ),
  ).toEqual([]);

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The same bus used by bookmark/follow actions: the first request carries
  // context that must survive the asynchronous form import.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("nes:open-login", {
        detail: { mode: "signin", title: "First request preserved" },
      }),
    ),
  );
  await expect(page.getByRole("dialog")).toContainText("First request preserved");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.dispatchEvent(new Event("neus:open-mobile-search")));
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("combobox")).toBeVisible();
  expect(errors).toEqual([]);
});
