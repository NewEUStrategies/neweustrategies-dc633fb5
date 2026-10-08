import { expect, test, type Page } from "@playwright/test";

// BRAMKA RUCHU NA ARTEFAKCIE (P3.5): `/` na fixture `first-visit` (ten sam serwer
// i backend co `boot-home`, `playwright.artifact.config.ts`).
//
// CO JEST PRZYPINANE (prawdziwa przeglądarka, prawdziwy CSS i prawdziwe zegary):
//  1. Bez interakcji i bez ciszy hero (slider postów w sekcji 0, autoplay 4,5 s z
//     `carousel_defaults`) i pasek „Na czasie" (porcje co 4 s) STOJĄ przez 12 s,
//     `<html>` nie ma `data-motion`, a żadna nieskończona animacja w dokumencie nie
//     biegnie: element z `data-motion-loop` ma wyliczony `animation-play-state:
//     paused` z reguły `styles.css` (także przy stylu inline, jak tor marquee).
//  2. Bez interakcji bramkę otwiera punkt ciszy (≥ 5 s po `load`): pierwszy
//     przeskok hero przychodzi PEŁNY interwał po otwarciu, a nie wcześniej.
//  3. Kółko myszy (`page.mouse.wheel`) otwiera bramkę od razu, a hero przeskakuje
//     interwał później; sonda z `data-motion-loop` rusza (`running`).
// To dowód strukturalny dla Speed Index: harness Lighthouse'a nie odtwarza kary za
// autoplay (`faza3/PLAN-FALI-3.md` §1).
//
// NAZWA PLIKU. Konfiguracja artefaktu bierze wyłącznie `boot-(artifact|timing|home)`
// (`testMatch`), a konfiguracja dev-servera ten sam wzorzec ignoruje - spec jedzie
// więc razem z `boot-home` na tym samym zbudowanym serwerze i nie trafia do e2e
// na dev-serverze, gdzie artefaktu nie ma.
//
// MASKA AKTYWACJI UŻYTKOWNIKA (jak `e2e-performance/third-party-quiescence.spec.ts`):
// ewaluacje CDP Playwrighta nadają dokumentowi lepką aktywację, a `firstInteraction`
// czyta ją jako interakcję sprzed subskrypcji - bramka otwierałaby się sama.
// Maska zwraca `true` dopiero po zaufanym zdarzeniu aktywującym; kółko nie aktywuje,
// więc scenariusz 3 sprawdza ścieżkę `wheel`, a nie lepką aktywację.
//
// UTRZYMANIE RUCHU SIECI (scenariusz 1): strona co sekundę pobiera `/favicon.ico?…`
// (liczony zasób przesuwa okno ciszy), więc punkt ciszy nie zapada w oknie 12 s i
// bramka zostaje zamknięta. Scenariusz 2 ćwiczy ciszę naturalną.

/** Interwał autoplay hero z `carousel_defaults` / konfiguracji sekcji 0 fixture. */
const HERO_INTERVAL_MS = 4_500;
/** Tolerancja zegara przeglądarki i sondy (próbkowanie co 100 ms). */
const SLACK_MS = 250;

interface MotionProbe {
  openedAt: number | null;
  hero: Array<{ t: number; index: number }>;
  ticker: Array<{ t: number; text: string }>;
}

declare global {
  interface Window {
    __nesAppReady?: boolean;
    __motionProbe?: MotionProbe;
  }
}

async function prepare(page: Page, keepNetworkBusy: boolean): Promise<void> {
  await page.addInitScript((busy: boolean) => {
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

    const probe: MotionProbe = { openedAt: null, hero: [], ticker: [] };
    window.__motionProbe = probe;
    // `documentElement` jeszcze nie istnieje (skrypt startowy biegnie przed parsowaniem),
    // więc obserwujemy cały dokument; `data-motion` i tak pojawia się dopiero po hydratacji.
    new MutationObserver(() => {
      if (probe.openedAt === null && document.documentElement?.dataset.motion === "on") {
        probe.openedAt = performance.now();
      }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-motion"] });

    // Hero = slider z kandydatem LCP (sekcja 0); na stronie są też inne slidery.
    const heroIndex = (): number => {
      const slider =
        document.querySelector("img[data-lcp-candidate]")?.closest(".eh-slider") ??
        document.querySelector('.eh-slider[data-variant="editorial-hero"]');
      if (!slider) return -1;
      const images = Array.from(slider.querySelectorAll<HTMLImageElement>("img[data-fill-image]"));
      return images.findIndex((image) => image.style.opacity !== "0");
    };
    const tickerText = (): string =>
      document.querySelector<HTMLElement>('[data-testid="trending-ticker"]')?.innerText ?? "";
    const sample = () => {
      const t = performance.now();
      const index = heroIndex();
      if (probe.hero.at(-1)?.index !== index) probe.hero.push({ t, index });
      const text = tickerText();
      if (probe.ticker.at(-1)?.text !== text) probe.ticker.push({ t, text });
    };
    document.addEventListener("DOMContentLoaded", () => {
      sample();
      window.setInterval(sample, 100);
      if (busy) {
        let n = 0;
        window.setInterval(() => {
          n += 1;
          void fetch(`/favicon.ico?motion-gate-keepalive=${n}`, { cache: "no-store" }).catch(
            () => undefined,
          );
        }, 1_000);
      }
    });
  }, keepNetworkBusy);
  await page.setExtraHTTPHeaders({ "accept-language": "pl" });
}

async function openHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => window.__nesAppReady === true)).toBe(true);
  // Hero z fixture jest w sekcji 0 (zawsze uwodniony) i ma ≥ 2 slajdy.
  await expect
    .poll(() => page.evaluate(() => window.__motionProbe?.hero.at(-1)?.index ?? -1))
    .toBe(0);
}

/** Wstawia (po hydratacji, poza drzewem Reacta) element z nieskończoną animacją inline. */
async function addLoopProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "@keyframes motion-gate-probe{to{transform:translateX(1px)}}";
    const probe = document.createElement("div");
    probe.id = "motion-gate-probe";
    probe.setAttribute("data-motion-loop", "");
    probe.style.cssText =
      "position:fixed;left:-9999px;top:0;width:1px;height:1px;animation:motion-gate-probe 1s linear infinite";
    document.body.append(style, probe);
  });
}

async function probePlayState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.getElementById("motion-gate-probe");
    return probe ? getComputedStyle(probe).animationPlayState : "brak sondy";
  });
}

/** Nieskończone animacje, które BIEGNĄ: nazwa i opis elementu (pusta lista = cisza). */
async function runningInfiniteAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === "running" &&
          animation.effect?.getComputedTiming().iterations === Infinity,
      )
      .map((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        const name = "animationName" in animation ? String(animation.animationName) : "?";
        const where =
          target instanceof Element ? `${target.tagName.toLowerCase()}.${target.className}` : "?";
        return `${name} @ ${where}`;
      }),
  );
}

test.describe("bramka ruchu na stronie głównej (P3.5)", () => {
  test("bez interakcji i bez ciszy: hero i pasek stoją 12 s, pętle w pauzie", async ({ page }) => {
    await prepare(page, true);
    await openHome(page);
    await addLoopProbe(page);
    const before = await page.evaluate(() => structuredClone(window.__motionProbe));

    await page.waitForTimeout(12_000);

    const after = await page.evaluate(() => structuredClone(window.__motionProbe));
    expect(after?.openedAt).toBeNull();
    expect(await page.locator("html").getAttribute("data-motion")).toBeNull();
    expect(after?.hero.map((entry) => entry.index)).toEqual(before?.hero.map((e) => e.index));
    expect(after?.hero.at(-1)?.index).toBe(0);
    expect(after?.ticker.length).toBe(before?.ticker.length);
    expect(await probePlayState(page)).toBe("paused");
    expect(await runningInfiniteAnimations(page)).toEqual([]);
  });

  test("bez interakcji: punkt ciszy otwiera bramkę, hero przeskakuje pełny interwał później", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await prepare(page, false);
    await openHome(page);
    await expect(page.locator("html")).toHaveAttribute("data-motion", "on", { timeout: 40_000 });
    await expect
      .poll(() => page.evaluate(() => window.__motionProbe?.hero.length ?? 0), {
        timeout: HERO_INTERVAL_MS + 5_000,
      })
      .toBeGreaterThan(1);

    const probe = await page.evaluate(() => structuredClone(window.__motionProbe));
    const openedAt = probe?.openedAt ?? Number.NaN;
    expect(Number.isFinite(openedAt)).toBe(true);
    const firstChange = probe?.hero[1];
    expect(firstChange?.index).toBe(1);
    // Żadnej zmiany przed otwarciem i pierwsza dopiero pełny interwał po nim.
    expect(firstChange?.t ?? 0).toBeGreaterThanOrEqual(openedAt + HERO_INTERVAL_MS - SLACK_MS);
    for (const entry of probe?.ticker.slice(1) ?? []) {
      expect(entry.t).toBeGreaterThan(openedAt);
    }
  });

  test("kółko myszy otwiera bramkę od razu, hero przeskakuje po interwale", async ({ page }) => {
    await prepare(page, true);
    await openHome(page);
    await addLoopProbe(page);
    expect(await probePlayState(page)).toBe("paused");

    // Kursor nad nagłówkiem, nie nad hero (`pauseOnHover` z `carousel_defaults`).
    await page.mouse.move(8, 8);
    await page.mouse.wheel(0, 1);
    await expect(page.locator("html")).toHaveAttribute("data-motion", "on", { timeout: 2_000 });
    expect(await probePlayState(page)).toBe("running");

    await expect
      .poll(() => page.evaluate(() => window.__motionProbe?.hero.length ?? 0), {
        timeout: HERO_INTERVAL_MS + 3_000,
      })
      .toBeGreaterThan(1);
    const probe = await page.evaluate(() => structuredClone(window.__motionProbe));
    const openedAt = probe?.openedAt ?? Number.NaN;
    expect(probe?.hero[1]?.index).toBe(1);
    expect(probe?.hero[1]?.t ?? 0).toBeGreaterThanOrEqual(openedAt + HERO_INTERVAL_MS - SLACK_MS);
  });
});
