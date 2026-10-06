import { expect, test, type Page } from "@playwright/test";
import {
  fixtureImage,
  fixtureResponse,
  homeFixture,
  isFixtureBackend,
} from "../scripts/performance/homeFixture";

/**
 * MASKA AKTYWACJI (wzorzec `third-party-quiescence.spec.ts`, P1.1). Ewaluacje
 * Playwrighta idą przez CDP z `userGesture: true` i nadają dokumentowi lepką
 * aktywację bez żadnego wejścia; `firstInteraction.ts` (P0.3) czyta ją jako
 * kliknięcie sprzed subskrypcji i zwolniłby kolejkę - baner zgód montowałby się
 * „bez interakcji" wyłącznie w tym harnessie. Maska podmienia
 * `navigator.userActivation` na wartość, która staje się `true` dopiero po
 * pierwszym ZAUFANYM zdarzeniu aktywującym (jak w prawdziwej przeglądarce i w
 * Lighthouse).
 */
async function maskUserActivation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let activated = false;
    for (const type of ["keydown", "mousedown", "pointerdown", "pointerup", "touchend"]) {
      window.addEventListener(
        type,
        (event) => {
          if (event.isTrusted) activated = true;
        },
        { capture: true, passive: true },
      );
    }
    Object.defineProperty(Navigator.prototype, "userActivation", {
      configurable: true,
      get: () => ({ hasBeenActive: activated, isActive: activated }),
    });
  });
}

test("first-use overlays stay out of startup and respond to the first request", async ({
  page,
}) => {
  const scripts: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(new URL(request.url()).pathname);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  // Chunk banera zgód ma przyjść PO pierwszej interakcji - bez maski fałszywa
  // aktywacja z CDP zwolniłaby kolejkę wcześniej.
  await maskUserActivation(page);
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
  const html = (await response?.text()) ?? "";
  // P1.3: baner zgód jest w HTML-u jako statyczna powłoka (widoczna od FCP),
  // a interaktywny chunk `ConsentBanner` dociąga się dopiero po interakcji.
  expect(html).toContain("data-consent-shell");
  await page.waitForFunction(() => window.__nesAppReady === true);
  const shell = page.locator("[data-consent-shell]");
  await expect(shell).toBeVisible();
  const beforeFirstInteraction = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Tylko niezbędne", exact: true }).click();
  // Decyzja z powłoki: rekord zapisany od razu, powłoka ukryta.
  await expect(shell).toBeHidden();
  expect(
    JSON.parse((await page.evaluate(() => localStorage.getItem("consent:v2"))) ?? "null"),
  ).toMatchObject({ version: 2, categories: { marketing: false }, source: "local" });
  // Chunki widgetów tej fixture nad zgięciem, łącznie z zagnieżdżonym rendererem, który
  // dawniej czekał na wykonanie PostsSliderWidget. Od P2.1 (boot po LCP) jadą w zestawie bootu
  // `#nes-boot-set` - w tym samym burście co wejście - a NIE w nagłówku `Link`: hint modułu
  // w nagłówku pobrałby JS przed LCP.
  const bootSet = /<script type="application\/json" id="nes-boot-set">([^<]*)<\/script>/.exec(html);
  expect(bootSet, "dokument bez zestawu bootu").not.toBeNull();
  const burst = (JSON.parse(bootSet![1]) as { u: string[] }).u;
  expect(burst.some((url) => /PostsSliderWidget/.test(url))).toBe(true);
  expect(burst.some((url) => /sliderVariants/.test(url))).toBe(true);
  expect(response!.headers()["link"] ?? "").not.toMatch(/modulepreload/);
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

  // ── PIĘĆ NAKŁADEK KORZENIA POZA COMMITEM HYDRATACJI (F19) ───────────────
  //
  // `ConsentBanner`, `ConsentPreviewPanel`, `NewsletterPopup`, `PopupHost`
  // i `Toaster` były renderowane BEZWARUNKOWO, a `React.lazy` startuje
  // `import()` przy PIERWSZYM renderze - czyli pięć żądań chunków lądowało
  // w commicie hydratacji, w oknie LCP i pierwszej interakcji KAŻDEJ strony.
  // „Leniwy" znaczyło tu tylko „w osobnym pliku", nigdy „później".
  //
  // GRANICĄ JEST `__nesAppReadyAt`, NIE ZEGAR TESTU, i to jest cała
  // odporność tej asercji. Flaga jest stemplowana `performance.now()`
  // SYNCHRONICZNIE w efekcie montowania korzenia (`lib/watchdog/appReady.ts`),
  // czyli dokładnie w tym commicie; `PerformanceResourceTiming.startTime`
  // jest z tego samego zegara. Porównujemy więc dwa znaczniki z osi
  // przeglądarki, a nie „czy zdążyliśmy zajrzeć przed czymś" - bramka nie
  // zależy od szybkości maszyny ani od momentu, w którym Playwright odpytał
  // stronę. Chunk odroczony do bezczynności ma `startTime` PO tym stemplu,
  // bo `requestIdleCallback`/`setTimeout` nie potrafią wykonać się w środku
  // commitu Reacta.
  const overlayTimings = await page.evaluate(() => {
    const readyAt = window.__nesAppReadyAt ?? Number.POSITIVE_INFINITY;
    const wzorzec =
      /\/(?:ConsentBanner-|ConsentPreviewPanel-|NewsletterPopup-|PopupHost-|sonner-|vendor-sonner-)/;
    return {
      readyAt,
      nakladki: performance
        .getEntriesByType("resource")
        .map((entry) => ({ path: new URL(entry.name).pathname, startTime: entry.startTime }))
        .filter((entry) => wzorzec.test(entry.path)),
    };
  });
  expect(overlayTimings.readyAt).toBeLessThan(Number.POSITIVE_INFINITY);
  expect(
    overlayTimings.nakladki
      .filter((entry) => entry.startTime < overlayTimings.readyAt)
      .map((entry) => entry.path),
  ).toEqual([]);

  // KONTROLA POZYTYWNA dla banera zgód: „poza commitem hydratacji" ma znaczyć
  // PÓŹNIEJ, nie NIGDY. Baner MUSI się montować bezwarunkowo - jego efekty są
  // pisarzem stanu zgody w `overlayCoordinator`, więc bramka „tylko dopóki nie
  // zdecydowano" odblokowałaby popupy marketingowe u osób, które marketing
  // odrzuciły. Od P1.3 widoczna jest od FCP powłoka z SSR, a chunk banera
  // przychodzi PO PIERWSZEJ INTERAKCJI (kolejka P0.3, klasa `shell`) - nigdy
  // przed nią, ale zawsze po niej, także gdy decyzja padła już w powłoce.
  const consentChunks = overlayTimings.nakladki.filter((entry) =>
    /\/ConsentBanner-/.test(entry.path),
  );
  expect(consentChunks.length).toBeGreaterThan(0);
  expect(consentChunks.every((entry) => entry.startTime >= beforeFirstInteraction)).toBe(true);
  // Panel podglądu zgód jest jedyną z piątki bramkowaną ADRESEM, nie czasem:
  // bez `?consent-preview=1` renderuje `null` przez całe życie strony, więc
  // jego chunk nie ma prawa dojechać NIGDY.
  expect(
    overlayTimings.nakladki.filter((entry) => /\/ConsentPreviewPanel-/.test(entry.path)),
  ).toEqual([]);

  expect(errors).toEqual([]);
});
