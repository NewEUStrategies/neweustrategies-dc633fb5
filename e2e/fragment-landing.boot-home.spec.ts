// Wejście z fragmentem, którego cel React odsłania PÓŹNO - `src/lib/scroll/fragmentLandingScript.ts`.
//
// SCENARIUSZ Z CI (38982787871, desktop): cel kotwicy leży w segmencie granicy strumienia
// (`<div hidden id="S:…">`), a React 19.2 odsłania segmenty partiami (`$RC` -> `$RV`, kolejne
// partie co >=300 ms). Na szybkim urządzeniu odsłonięcie wypada po `load` (koniec kotwicy
// Chromium) i po hydratacji (jednorazowe przewinięcie routera) - strona zostawała na górze.
//
// ZAPADKA ZAMIAST OPÓŹNIENIA. Skrypt inicjujący przechwytuje `$RV` (funkcję odsłaniającą partię)
// i trzyma wywołania w kolejce, aż test zwolni je `__releaseReveals()`. Test sam ustala więc
// kolejność: dokument wczytany, aplikacja gotowa, cel nadal ukryty -> zwolnienie. Stałe
// opóźnienie ścigało się z odpytywaniem gotowości na wolniejszym runnerze (recenzja 1d0f11a).
// Kontrola ujemna (skrypt ustępuje od pierwszego bajtu) dowodzi, że główny test mierzy SKRYPT, a nie
// coś innego, co przewinęłoby stronę po hydratacji.
import { expect, test, type Page } from "@playwright/test";

import { holdReveals } from "./helpers/streamReveals";

const VIEWPORT = { width: 1350, height: 940 };

test.use({ viewport: VIEWPORT });

/** Element z `id` w segmencie strumienia HTML-u serwera `/`, najdalszy od góry (nagłówek). */
async function streamedTargetId(page: Page): Promise<string> {
  const response = await page.request.get("/", { headers: { "accept-language": "pl" } });
  const html = await response.text();
  const id = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "text/html");
    const ids = [...doc.querySelectorAll('div[hidden][id^="S:"] [id]')].filter(
      // `<template id="B:…">` znika przy odsłonięciu; identyfikatory pól formularza z `useId`
      // zależą od pozycji w drzewie - cel ma być stabilnym nagłówkiem treści.
      (el) => el.tagName !== "TEMPLATE" && !/^[BS]:/.test(el.id) && /^H[1-6]$/.test(el.tagName),
    );
    return ids.at(-1)?.id ?? null;
  }, html);
  expect(id, "HTML `/` fixture ma nagłówek z id w segmencie strumienia").not.toBeNull();
  return id!;
}

/**
 * Kontrola ujemna: skrypt zostaje w dokumencie, ale od pierwszego bajtu widzi flagę własności
 * fragmentu (`window.__nesAnchorOwned`, ta sama, którą ustawia `smoothScrollToAnchor`) i ustępuje.
 * Bez przepisywania HTML-u w locie - podmieniona odpowiedź dokumentu psuła hydratację.
 */
async function standDownLandingScript(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as Window & { __nesAnchorOwned?: boolean }).__nesAnchorOwned = true;
  });
}

const where = (id: string) => {
  const el = document.getElementById(id)!;
  return {
    top: el.getBoundingClientRect().top,
    headerBottom: Math.max(
      0,
      document.querySelector("[data-site-header]")?.getBoundingClientRect().bottom ?? 0,
    ),
    scrollY,
    hidden: !!el.closest("[hidden]"),
    queued: window.__revealQueued ?? 0,
  };
};

/** Ten sam warunek co `content-visibility.boot-home.spec.ts`: cel pod nagłówkiem, w górnej części. */
const onTarget = (top: number, headerBottom: number) =>
  top >= headerBottom - 1 && top < headerBottom + VIEWPORT.height / 3;

/** Wejście: dokument wczytany, aplikacja gotowa, cel nadal w ukrytym segmencie. */
async function enterHeld(page: Page, id: string): Promise<void> {
  await page.setExtraHTTPHeaders({ "accept-language": "pl" });
  await page.goto(`/#${encodeURIComponent(id)}`);
  await expect.poll(() => page.evaluate(() => window.__nesAppReady === true)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.readyState)).toBe("complete");
  const state = await page.evaluate(where, id);
  expect(state.queued, "runtime Fizz odsłania przez `$RV`").toBeGreaterThan(0);
  expect(state.hidden, "cel czeka w segmencie do zwolnienia").toBe(true);
  expect(state.scrollY, JSON.stringify(state)).toBe(0);
}

test("cel odsłonięty po `load` i po hydratacji: strona ląduje na celu, pod nagłówkiem", async ({
  page,
}) => {
  const id = await streamedTargetId(page);
  await holdReveals(page);
  await enterHeld(page, id);

  await page.evaluate(() => window.__releaseReveals!());
  await expect
    .poll(async () => {
      const s = await page.evaluate(where, id);
      return !s.hidden && s.scrollY > VIEWPORT.height && onTarget(s.top, s.headerBottom);
    })
    .toBe(true);
});

test("kliknięcie bez przewinięcia przed odsłonięciem (zgoda na cookies) nie odbiera lądowania", async ({
  page,
}) => {
  const id = await streamedTargetId(page);
  await holdReveals(page);
  await enterHeld(page, id);

  // Pierwsza wizyta: baner zgód z SSR jest widoczny od pierwszego malowania. Bez banera -
  // klik w tekst, który nie jest niczym interaktywnym (żadnej nawigacji ani przewinięcia).
  const accept = page.getByRole("button", { name: "Akceptuj wszystkie" });
  if (await accept.isVisible()) {
    await accept.click();
  } else {
    const point = await page.evaluate(() => {
      for (const el of document.querySelectorAll("main p, main span, main h1, main h2")) {
        if (el.closest("a, button, input, label, select, textarea, [role], [tabindex]")) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 4 && r.height > 4 && r.top > 0 && r.bottom < innerHeight) {
          return { x: r.left + 2, y: r.top + r.height / 2 };
        }
      }
      return null;
    });
    expect(point, "nieinteraktywny tekst w pierwszym ekranie").not.toBeNull();
    await page.mouse.click(point!.x, point!.y);
  }
  const afterClick = await page.evaluate(where, id);
  expect(afterClick.scrollY, JSON.stringify(afterClick)).toBe(0);
  expect(afterClick.hidden).toBe(true);

  await page.evaluate(() => window.__releaseReveals!());
  await expect
    .poll(async () => {
      const s = await page.evaluate(where, id);
      return !s.hidden && onTarget(s.top, s.headerBottom);
    })
    .toBe(true);
});

test("użytkownik przewinął przed odsłonięciem: skrypt nie zabiera mu pozycji", async ({ page }) => {
  const id = await streamedTargetId(page);
  await holdReveals(page);
  await enterHeld(page, id);

  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  const reading = await page.evaluate(where, id);
  // Warunek scenariusza: przewinięcie użytkownika, nie lądowanie (cel wciąż ukryty).
  expect(reading.hidden, JSON.stringify(reading)).toBe(true);
  expect(reading.scrollY).toBeLessThan(VIEWPORT.height);

  await page.evaluate(() => window.__releaseReveals!());
  await expect.poll(async () => (await page.evaluate(where, id)).hidden).toBe(false);
  // Kilka próbek po odsłonięciu: żadna nie pokazuje skoku do celu (~2,2 tys. px niżej).
  for (let sample = 0; sample < 6; sample += 1) {
    await page.waitForTimeout(150);
    const now = await page.evaluate(where, id);
    expect(now.scrollY, JSON.stringify({ reading, now })).toBeLessThan(VIEWPORT.height);
    expect(onTarget(now.top, now.headerBottom), JSON.stringify(now)).toBe(false);
  }
});

test("kontrola ujemna: gdy skrypt ustępuje, strona zostaje na górze (objaw z CI)", async ({
  page,
}) => {
  const id = await streamedTargetId(page);
  await standDownLandingScript(page);
  await holdReveals(page);
  await enterHeld(page, id);
  expect(
    await page.evaluate(
      () => document.querySelector("script[data-nes-fragment-landing]")?.textContent?.length ?? 0,
    ),
  ).toBeGreaterThan(0);

  await page.evaluate(() => window.__releaseReveals!());
  await expect.poll(async () => (await page.evaluate(where, id)).hidden).toBe(false);
  await page.waitForTimeout(600);
  const after = await page.evaluate(where, id);
  // Nic poza skryptem nie przewija do celu odsłoniętego po `load` i po hydratacji - główny test
  // mierzy więc skrypt, a nie przypadkowe przewinięcie routera czy przeglądarki.
  expect(after.scrollY, JSON.stringify(after)).toBe(0);
  expect(after.top, JSON.stringify(after)).toBeGreaterThan(VIEWPORT.height);
});
