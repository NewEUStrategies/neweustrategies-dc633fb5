// Skrypt lądowania na kotwicy przy wejściu (`fragmentLandingScript.ts`) - kontrakt wykonania.
//
// Skrypt biegnie inline w `<head>`, zanim wystartuje jakikolwiek moduł, więc testujemy GO
// SAMEGO: ten sam napis, który wysyła serwer, wykonany w happy-dom z podrobionym czasem
// (`setTimeout`, `requestAnimationFrame`), stanem dokumentu (`readyState`, `hidden`)
// i położeniem okna (`scrollY`). Dowód na prawdziwej przeglądarce, z odsłonięciem React 19.2
// wstrzymanym do chwili wybranej przez test: `e2e/fragment-landing.boot-home.spec.ts`.
import { storageKey as tanstackScrollStorageKey } from "@tanstack/router-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRAGMENT_LANDING_MAX_POLLS,
  FRAGMENT_LANDING_MAX_TICKS,
  FRAGMENT_LANDING_POLL_MS,
  FRAGMENT_LANDING_SCRIPT,
  FRAGMENT_OWNED_FLAG,
  TSR_SCROLL_STORAGE_KEY,
} from "../fragmentLandingScript";

let readyState: DocumentReadyState = "loading";
let hidden = false;
let scrollY = 0;
const ownedWindow = window as unknown as Record<string, unknown>;

function run(): void {
  new Function(FRAGMENT_LANDING_SCRIPT)();
}

/** Cel w ukrytym segmencie strumienia (`<div hidden id="S:1">`), jak w HTML-u serwera. */
function hiddenTarget(id: string): { el: HTMLElement; reveal: () => void } {
  const segment = document.createElement("div");
  segment.hidden = true;
  segment.id = "S:1";
  const el = document.createElement("h2");
  el.id = id;
  segment.append(el);
  document.body.append(segment);
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

/** `times` prób odpytywania i klatka, w której pada skok. */
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
  scrollY = 0;
  Object.defineProperty(document, "readyState", { configurable: true, get: () => readyState });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  delete ownedWindow[FRAGMENT_OWNED_FLAG];
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  delete ownedWindow[FRAGMENT_OWNED_FLAG];
});

describe("FRAGMENT_LANDING_SCRIPT - kiedy ląduje", () => {
  it("bez fragmentu w adresie nic nie planuje (zwykłe wejście)", () => {
    run();
    expect(vi.getTimerCount()).toBe(0);

    history.replaceState(null, "", "/#");
    run();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cel odsłonięty PO `load`, strona na górze: jeden `scrollIntoView()` bez opcji, potem koniec", () => {
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
    // Bez opcji: wyrównanie jak router (`?? true`), `scroll-margin` arkusza ustawia cel
    // pod nagłówkiem. Opcja `block: "end"`/`"nearest"` zostawiłaby cel u dołu ekranu.
    expect(el.scrollIntoView).toHaveBeenCalledWith();
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

  it("późna partia odsłonięć (React 19.2: do ~2,3 s i dalej) mieści się w suficie prób", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    readyState = "complete";
    run();
    step(40); // 4 s po wczytaniu - poza oknem 2,0-2,3 s i jeszcze kolejna partia
    reveal();
    step();
    expect(scrolls(el)).toBe(1);
  });

  it("granica sufitu: odsłonięcie w ostatniej próbie ląduje, po sufcie już nie", () => {
    // Próba nr 1 biegnie synchronicznie przy starcie, każda kolejna po FRAGMENT_LANDING_POLL_MS.
    const land = (pollsBeforeReveal: number): number => {
      document.body.innerHTML = "";
      history.replaceState(null, "", `/#cel-${pollsBeforeReveal}`);
      const { el, reveal } = hiddenTarget(`cel-${pollsBeforeReveal}`);
      readyState = "complete";
      run();
      vi.advanceTimersByTime(FRAGMENT_LANDING_POLL_MS * (pollsBeforeReveal - 1));
      reveal();
      step();
      const count = scrolls(el);
      vi.clearAllTimers();
      return count;
    };
    expect(land(FRAGMENT_LANDING_MAX_POLLS)).toBe(1);
    expect(land(FRAGMENT_LANDING_MAX_POLLS + 2)).toBe(0);
    // Sufit czynny musi przykryć okno odsłonięć React 19.2 (2,3 s) z zapasem.
    expect(FRAGMENT_LANDING_POLL_MS * FRAGMENT_LANDING_MAX_POLLS).toBeGreaterThanOrEqual(6_000);
  });

  it("cel tuż przy górze (np. „przejdź do treści”): `scrollIntoView` i tak - zacisk w 0", () => {
    history.replaceState(null, "", "/#main-content");
    const { el, reveal } = hiddenTarget("main-content");
    readyState = "complete";
    reveal();
    run();
    step();
    expect(scrolls(el)).toBe(1);
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

  it("zepsute kodowanie procentowe: pętla żyje do sufitu, potem kończy (bez wyjątku)", () => {
    history.replaceState(null, "", "/#%E0%A4%A");
    readyState = "complete";
    run();
    step(5);
    // `decodeURIComponent` rzuca przy każdej próbie - bez lokalnego `try` pętla padłaby od razu.
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    vi.advanceTimersByTime(FRAGMENT_LANDING_POLL_MS * (FRAGMENT_LANDING_MAX_POLLS + 5));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("FRAGMENT_LANDING_SCRIPT - komu ustępuje", () => {
  it("strona przewinięta, zanim cel się odsłonił (przeglądarka, router, użytkownik): nic", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    run();
    scrollY = 730; // np. przywrócenie pozycji przy przeładowaniu albo pasek przewijania
    readyState = "complete";
    step();
    // Pierwsza próba po wczytaniu widzi cudze położenie i kończy pętlę od razu - nie odpytuje
    // dalej do sufitu tylko po to, żeby w klatce skoku i tak ustąpić.
    expect(vi.getTimerCount()).toBe(0);
    reveal();
    step(3);
    expect(scrolls(el)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("przewinięcie między odsłonięciem a klatką skoku też wygrywa", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    readyState = "complete";
    reveal();
    run(); // warunek spełniony od razu - skok czeka na klatkę
    scrollY = 3; // pierwsza klatka czyjegoś płynnego przewinięcia
    step();
    expect(scrolls(el)).toBe(0);
  });

  it.each(["wheel", "touchmove"])("`%s` przed odsłonięciem: koniec czekania", (type) => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    run();
    window.dispatchEvent(new Event(type));
    readyState = "complete";
    reveal();
    step(5);
    expect(scrolls(el)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["pointerdown", "touchstart", "keydown", "click"])(
    "`%s` bez przewinięcia (zgoda na cookies, menu) NIE odbiera lądowania",
    (type) => {
      history.replaceState(null, "", "/#cel");
      const { el, reveal } = hiddenTarget("cel");
      run();
      window.dispatchEvent(new Event(type));
      readyState = "complete";
      reveal();
      step();
      expect(scrolls(el)).toBe(1);
    },
  );

  it("fragment przejęty przez aplikację (`smoothScrollToAnchor` ustawia flagę): nic", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    run();
    ownedWindow[FRAGMENT_OWNED_FLAG] = true;
    readyState = "complete";
    reveal();
    step(3);
    expect(scrolls(el)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("przejęcie między odsłonięciem a klatką skoku też wygrywa", () => {
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    readyState = "complete";
    reveal();
    run();
    ownedWindow[FRAGMENT_OWNED_FLAG] = true;
    step();
    expect(scrolls(el)).toBe(0);
  });

  it("zapis routera `__hashScrollIntoViewOptions: false` (np. kanonizujący replace) NIE blokuje", () => {
    // `defaultHashScrollIntoView: false` (src/router.tsx) zapisuje tę flagę przy KAŻDYM
    // zatwierdzeniu nawigacji - nie znaczy, że ktoś przejął fragment.
    history.replaceState(null, "", "/#cel");
    const { el, reveal } = hiddenTarget("cel");
    run();
    history.replaceState({ __hashScrollIntoViewOptions: false, __TSR_key: "k9" }, "", "/#cel");
    readyState = "complete";
    reveal();
    step();
    expect(scrolls(el)).toBe(1);
  });

  it("wpis przywracania OKNA TanStacka: router przywraca pozycję, skrypt nie wchodzi w drogę", () => {
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

  it("wpis samych ELEMENTÓW (karuzela) nie odwodzi routera od fragmentu - skryptu też nie", () => {
    history.replaceState({ __TSR_key: "k1" }, "", "/#cel");
    sessionStorage.setItem(
      TSR_SCROLL_STORAGE_KEY,
      JSON.stringify({ k1: { "div:nth-child(2)": { scrollX: 40, scrollY: 0 } } }),
    );
    const { el, reveal } = hiddenTarget("cel");
    readyState = "complete";
    reveal();
    run();
    step();
    expect(scrolls(el)).toBe(1);
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

  it("zepsuty JSON w magazynie nie wyłącza lądowania", () => {
    history.replaceState({ __TSR_key: "k1" }, "", "/#cel");
    sessionStorage.setItem(TSR_SCROLL_STORAGE_KEY, "{nie-json");
    const { el, reveal } = hiddenTarget("cel");
    readyState = "complete";
    reveal();
    run();
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
});

describe("FRAGMENT_LANDING_SCRIPT - ukryta karta i wolne łącze", () => {
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
});

describe("FRAGMENT_LANDING_SCRIPT - literał", () => {
  it("klucz magazynu to `storageKey` z `@tanstack/router-core` (podbicie routera go nie rozjedzie)", () => {
    expect(TSR_SCROLL_STORAGE_KEY).toBe(tanstackScrollStorageKey);
    expect(FRAGMENT_LANDING_SCRIPT).toContain(`"${tanstackScrollStorageKey}"`);
  });

  it("czyta flagę własności pod tą samą nazwą, którą ustawia `smoothScrollToAnchor`", () => {
    expect(FRAGMENT_LANDING_SCRIPT).toContain(`w.${FRAGMENT_OWNED_FLAG}`);
  });

  it("bez znaków, które zamknęłyby `<script>` albo wymagały ucieczki w HTML-u", () => {
    expect(FRAGMENT_LANDING_SCRIPT).not.toMatch(/<\/|<!--|\\/);
  });
});
