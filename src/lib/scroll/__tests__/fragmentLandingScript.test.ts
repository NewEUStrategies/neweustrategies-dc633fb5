// Skrypt lądowania na kotwicy przy wejściu (`fragmentLandingScript.ts`) - kontrakt wykonania.
//
// Skrypt biegnie inline w `<head>`, zanim wystartuje jakikolwiek moduł, więc testujemy GO
// SAMEGO: ten sam napis, który wysyła serwer, wykonany w happy-dom z podrobionym czasem
// (`setTimeout`, `requestAnimationFrame`) i stanem dokumentu (`readyState`). Położenie celu
// podaje atrapa `getBoundingClientRect` (happy-dom nie liczy układu). Dowód na prawdziwej
// przeglądarce, z odsłonięciem React 19.2 opóźnionym jak na szybkim urządzeniu:
// `e2e/fragment-landing.boot-home.spec.ts`.
import { storageKey as tanstackScrollStorageKey } from "@tanstack/router-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRAGMENT_LANDING_MAX_POLLS,
  FRAGMENT_LANDING_MAX_TICKS,
  FRAGMENT_LANDING_POLL_MS,
  FRAGMENT_LANDING_SCRIPT,
  TSR_SCROLL_STORAGE_KEY,
} from "../fragmentLandingScript";

let readyState: DocumentReadyState = "loading";
let hidden = false;

function run(): void {
  new Function(FRAGMENT_LANDING_SCRIPT)();
}

/** Cel w ukrytym segmencie strumienia (`<div hidden id="S:1">`), jak w HTML-u serwera. */
function hiddenTarget(id: string, top = 2400): { el: HTMLElement; reveal: () => void } {
  const segment = document.createElement("div");
  segment.hidden = true;
  segment.id = "S:1";
  const el = document.createElement("h2");
  el.id = id;
  segment.append(el);
  document.body.append(segment);
  el.getBoundingClientRect = () => ({ top }) as DOMRect;
  el.scrollIntoView = vi.fn();
  return {
    el,
    // `$RV` Reacta przenosi dzieci segmentu w miejsce granicy i usuwa segment.
    reveal: () => {
      document.body.append(el);
      segment.remove();
    },
  };
}

function scrolls(el: HTMLElement): number {
  return vi.mocked(el.scrollIntoView).mock.calls.length;
}

/** Jedna próba odpytywania i klatka, w której pada odczyt położenia. */
function step(times = 1): void {
  for (let i = 0; i < times; i += 1) vi.advanceTimersByTime(FRAGMENT_LANDING_POLL_MS);
  vi.advanceTimersByTime(20);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
  });
  readyState = "loading";
  hidden = false;
  Object.defineProperty(document, "readyState", { configurable: true, get: () => readyState });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("FRAGMENT_LANDING_SCRIPT", () => {
  it("bez fragmentu w adresie nic nie planuje (zwykłe wejście)", () => {
    run();
    expect(vi.getTimerCount()).toBe(0);

    history.replaceState(null, "", "/#");
    run();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cel odsłonięty PO `load`: jedno przewinięcie, potem koniec", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    run();

    step(3);
    expect(scrolls(el)).toBe(0); // dokument się wczytuje - próba należy do przeglądarki
    readyState = "complete";
    step(3);
    expect(scrolls(el)).toBe(0); // wczytany, ale cel wciąż w ukrytym segmencie

    reveal();
    step();
    expect(scrolls(el)).toBe(1);
    step(20);
    expect(scrolls(el)).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cel widoczny, ale dokument jeszcze się wczytuje: czeka na `complete` (próba przeglądarki)", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    reveal();
    run();
    step(5);
    expect(scrolls(el)).toBe(0);
    readyState = "complete";
    step();
    expect(scrolls(el)).toBe(1);
  });

  it("cel nad widokiem (ujemne `top`) też przewija", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel", -600);
    readyState = "complete";
    reveal();
    run();
    step();
    expect(scrolls(el)).toBe(1);
  });

  it("cel już w widoku (przewinęła przeglądarka albo router) - bez drugiego skoku", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel", 120);
    run();
    readyState = "complete";
    reveal();
    step();
    expect(scrolls(el)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cel dosyłany strumieniem: nie ma go jeszcze w DOM, pojawia się później", () => {
    history.replaceState(null, "", "/#pozniej");
    run();
    readyState = "complete";
    step(5);
    const { el, reveal } = hiddenTarget("pozniej");
    reveal();
    step();
    expect(scrolls(el)).toBe(1);
  });

  it.each(["wheel", "touchstart", "keydown", "pointerdown"])(
    "`%s` przed odsłonięciem: skrypt ustępuje użytkownikowi",
    (type) => {
      history.replaceState(null, "", "/#cel");
      const { el, reveal } = hiddenTarget("cel");
      run();
      window.dispatchEvent(new Event(type));
      readyState = "complete";
      reveal();
      step(5);
      expect(scrolls(el)).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("interakcja między odsłonięciem a klatką odczytu też wygrywa", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    readyState = "complete";
    reveal();
    run(); // warunek spełniony od razu - odczyt czeka na klatkę
    window.dispatchEvent(new Event("wheel"));
    step();
    expect(scrolls(el)).toBe(0);
  });

  it("wpis przywracania okna TanStacka: router przywraca pozycję, skrypt nie wchodzi mu w drogę", () => {
    history.replaceState({ __TSR_key: "k1" }, "", "/#cel");
    sessionStorage.setItem(
      TSR_SCROLL_STORAGE_KEY,
      JSON.stringify({ k1: { window: { scrollX: 0, scrollY: 900 } } }),
    );
    const { el, reveal } = hiddenTarget("cel");
    run();
    expect(vi.getTimerCount()).toBe(0);
    readyState = "complete";
    reveal();
    step(5);
    expect(scrolls(el)).toBe(0);
  });

  it("wpis przywracania INNEGO wpisu historii nie blokuje lądowania", () => {
    history.replaceState({ __TSR_key: "k2" }, "", "/#cel");
    sessionStorage.setItem(
      TSR_SCROLL_STORAGE_KEY,
      JSON.stringify({ k1: { window: { scrollX: 0, scrollY: 900 } } }),
    );
    const { el, reveal } = hiddenTarget("cel");
    readyState = "complete";
    reveal();
    run();
    step();
    expect(scrolls(el)).toBe(1);
  });

  it("zepsuty JSON w magazynie nie wyłącza lądowania i nie rzuca", () => {
    history.replaceState({ __TSR_key: "k1" }, "", "/#cel");
    sessionStorage.setItem(TSR_SCROLL_STORAGE_KEY, "{nie-json");
    const { el, reveal } = hiddenTarget("cel");
    readyState = "complete";
    reveal();
    expect(run).not.toThrow();
    step();
    expect(scrolls(el)).toBe(1);
  });

  it("zmiana fragmentu w trakcie czekania kończy pętlę", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    run();
    history.replaceState(null, "", "/#inny");
    readyState = "complete";
    reveal();
    step(3);
    expect(scrolls(el)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("identyfikator zakodowany procentowo (polskie litery w kotwicy)", () => {
    history.replaceState(null, "", `/#${encodeURIComponent("zażółć")}`);
    const { el, reveal } = hiddenTarget("zażółć");
    readyState = "complete";
    reveal();
    run();
    step();
    expect(scrolls(el)).toBe(1);
  });

  it("zepsute kodowanie procentowe i cel, którego nie ma: bez wyjątku, koniec po suficie prób", () => {
    history.replaceState(null, "", "/#%E0%A4%A");
    readyState = "complete";
    expect(run).not.toThrow();
    vi.advanceTimersByTime(FRAGMENT_LANDING_POLL_MS * (FRAGMENT_LANDING_MAX_POLLS + 5));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("karta otwarta w tle: czekanie nie przepada przed pokazaniem karty (React odsłania w rAF)", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    hidden = true;
    readyState = "complete";
    run();
    // Dłużej niż sufit prób czynnych - w ukrytej karcie się nie liczą.
    step(FRAGMENT_LANDING_MAX_POLLS * 2);
    expect(scrolls(el)).toBe(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    hidden = false;
    reveal();
    step();
    expect(scrolls(el)).toBe(1);
  });

  it("cel odsłonięty, ale karta ukryta: skok dopiero po pokazaniu karty", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    hidden = true;
    readyState = "complete";
    reveal();
    run();
    step(5);
    expect(scrolls(el)).toBe(0);
    hidden = false;
    step();
    expect(scrolls(el)).toBe(1);
  });

  it("wolne łącze: wczytywanie dłuższe niż 8 s nie wyczerpuje prób", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    run();
    step(FRAGMENT_LANDING_MAX_POLLS + 40);
    readyState = "complete";
    reveal();
    step();
    expect(scrolls(el)).toBe(1);
  });

  it("sufit wszystkich prób kończy pętlę, gdy karta nigdy się nie pokaże", () => {
    history.replaceState(null, "", "/#cel");
    hiddenTarget("cel");
    hidden = true;
    run();
    vi.advanceTimersByTime(FRAGMENT_LANDING_POLL_MS * (FRAGMENT_LANDING_MAX_TICKS + 5));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fragment przejęty przez aplikację (`smoothScrollToAnchor`) - skrypt ustępuje", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    run();
    // `disableRouterHashScrollForCurrentEntry()` przed pierwszą klatką płynnego przewinięcia.
    history.replaceState({ __hashScrollIntoViewOptions: false }, "", "/#cel");
    readyState = "complete";
    reveal();
    step(3);
    expect(scrolls(el)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("przejęcie między odsłonięciem a klatką odczytu też wygrywa", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    readyState = "complete";
    reveal();
    run();
    history.replaceState({ __hashScrollIntoViewOptions: false }, "", "/#cel");
    step();
    expect(scrolls(el)).toBe(0);
  });

  it("wpis z wyłączonym przewijaniem fragmentu już przy wejściu: nic nie planuje", () => {
    history.replaceState({ __hashScrollIntoViewOptions: false }, "", "/#cel");
    hiddenTarget("cel");
    run();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("klucz magazynu to `storageKey` z `@tanstack/router-core` (podbicie routera go nie rozjedzie)", () => {
    expect(TSR_SCROLL_STORAGE_KEY).toBe(tanstackScrollStorageKey);
    expect(FRAGMENT_LANDING_SCRIPT).toContain(`"${tanstackScrollStorageKey}"`);
  });

  it("literał bez znaków, które zamknęłyby `<script>` albo wymagały ucieczki w HTML-u", () => {
    expect(FRAGMENT_LANDING_SCRIPT).not.toMatch(/<\/|<!--|\\/);
  });
});
