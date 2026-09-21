// Testy „żywej" typografii buildera (src/lib/builder/liveTypography.ts).
//
// Sedno: `clearAllLiveWidgetTypography` jest JEDYNĄ rzeczą, która po undo/redo
// zdejmuje nakładkę podglądu z kanwy. Jej jedyna ścieżka wywołania w produkcji
// (Builder.tsx:108 i :115) jest w `builderShell.test.tsx:69` zastąpiona atrapą
// całego modułu, więc funkcja nigdy nie była wykonana w pomiarze pokrycia.
// Ten plik wywołuje ją WPROST w happy-dom - bez atrapy podmiotu testu.
// Atrapowane jest wyłącznie to, czego nie da się wywołać inaczej: globalny
// `BroadcastChannel` i `window.sessionStorage` w wariancie „wyłączony".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WidgetTypography } from "@/lib/builder/types";
import {
  broadcastWidgetTypography,
  clearAllLiveWidgetTypography,
  subscribeWidgetTypography,
} from "@/lib/builder/liveTypography";

const STORAGE_PREFIX = "builder:widget-typography:";
const STYLE_ID_PREFIX = "builder-live-typography-style-";
const EVENT_NAME = "builder:widget-typography";

const TYPO_A: WidgetTypography = { fontSize: { desktop: "24px" }, fontWeight: "700" };
const TYPO_B: WidgetTypography = { letterSpacing: "0.05em", textTransform: "uppercase" };

function storageKey(widgetId: string): string {
  return `${STORAGE_PREFIX}${widgetId}`;
}

function styleId(widgetId: string): string {
  return `${STYLE_ID_PREFIX}${widgetId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function seedSnapshot(widgetId: string, typography: WidgetTypography): void {
  window.sessionStorage.setItem(
    storageKey(widgetId),
    JSON.stringify({ widgetId, typography, updatedAt: 1 }),
  );
}

function seedStyleNode(widgetId: string): void {
  const style = document.createElement("style");
  style.id = styleId(widgetId);
  style.textContent = `[data-w-id="${widgetId}"]{color:red}`;
  document.head.appendChild(style);
}

function liveStyleIds(): string[] {
  return Array.from(document.querySelectorAll(`style[id^="${STYLE_ID_PREFIX}"]`)).map(
    (el) => el.id,
  );
}

/** Symuluje przeglądarkę z zablokowanym magazynem sesji (tryb prywatny, polityka firmowa). */
function withDisabledSessionStorage(run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get: () => {
      throw new Error("sessionStorage jest wylaczony");
    },
  });
  try {
    run();
  } finally {
    if (descriptor) Object.defineProperty(window, "sessionStorage", descriptor);
  }
}

/**
 * Deterministyczny zamiennik globalnego `BroadcastChannel`. happy-dom nie
 * doręcza wiadomości między kanałami w tym samym kontekście, więc bez tej
 * atrapy gałąź „zmiana przyszła z INNEJ karty" jest nieosiągalna. Atrapowana
 * jest ZALEŻNOŚĆ modułu, nie podmiot testu.
 */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  closed = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    for (const other of FakeBroadcastChannel.instances) {
      if (other !== this && !other.closed && other.name === this.name) {
        other.onmessage?.(new MessageEvent("message", { data }));
      }
    }
  }

  close(): void {
    this.closed = true;
  }
}

const disposers: Array<() => void> = [];

/** Subskrybuje i rejestruje sprzątanie, żeby kanały nie przeciekały między testami. */
function subscribe(widgetId: string): {
  onChange: ReturnType<typeof vi.fn>;
  unsubscribe: () => void;
} {
  const onChange = vi.fn();
  const unsubscribe = subscribeWidgetTypography(widgetId, onChange);
  disposers.push(unsubscribe);
  return { onChange, unsubscribe };
}

function resetDom(): void {
  window.sessionStorage.clear();
  document.querySelectorAll("style").forEach((el) => el.remove());
}

beforeEach(() => {
  FakeBroadcastChannel.instances = [];
  resetDom();
});

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  vi.unstubAllGlobals();
  resetDom();
});

describe("clearAllLiveWidgetTypography", () => {
  it("kasuje migawki sessionStorage, zdejmuje wstrzyknięte <style> i powiadamia KAŻDEGO subskrybenta wartością undefined", () => {
    seedSnapshot("w-1", TYPO_A);
    seedSnapshot("w-2", TYPO_B);
    seedStyleNode("w-1");
    seedStyleNode("w-2");
    const first = subscribe("w-1");
    const second = subscribe("w-2");
    expect(first.onChange).toHaveBeenLastCalledWith(TYPO_A);
    expect(second.onChange).toHaveBeenLastCalledWith(TYPO_B);

    clearAllLiveWidgetTypography();

    expect(window.sessionStorage.getItem(storageKey("w-1"))).toBeNull();
    expect(window.sessionStorage.getItem(storageKey("w-2"))).toBeNull();
    expect(liveStyleIds()).toEqual([]);
    expect(first.onChange).toHaveBeenLastCalledWith(undefined);
    expect(second.onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("zostawia NIETKNIĘTE obce klucze sessionStorage i obce znaczniki <style>", () => {
    window.sessionStorage.setItem("builder:selected-widget", "w-1");
    window.sessionStorage.setItem("i18nextLng", "pl");
    seedSnapshot("w-1", TYPO_A);
    const foreign = document.createElement("style");
    foreign.id = "theme-design-live";
    foreign.textContent = ":root{--brand:#000}";
    document.head.appendChild(foreign);

    clearAllLiveWidgetTypography();

    expect(window.sessionStorage.getItem("builder:selected-widget")).toBe("w-1");
    expect(window.sessionStorage.getItem("i18nextLng")).toBe("pl");
    expect(window.sessionStorage.getItem(storageKey("w-1"))).toBeNull();
    expect(document.getElementById("theme-design-live")).not.toBeNull();
  });

  it("zdejmuje znaczniki <style>, nawet gdy sessionStorage jest WYŁĄCZONY", () => {
    seedStyleNode("w-1");
    seedStyleNode("w-2");

    withDisabledSessionStorage(() => {
      expect(() => clearAllLiveWidgetTypography()).not.toThrow();
    });

    expect(liveStyleIds()).toEqual([]);
  });

  it("NIE powiadamia nikogo, gdy nie ma ani jednej migawki do skasowania", () => {
    const { onChange } = subscribe("w-1");

    clearAllLiveWidgetTypography();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("powiadamia o KAŻDYM widgecie z migawki, także o takim, którego nikt nie subskrybuje", () => {
    seedSnapshot("w-1", TYPO_A);
    seedSnapshot("w-2", TYPO_B);
    const seen: unknown[] = [];
    const listener = (event: Event) => {
      if (event instanceof CustomEvent) seen.push(event.detail);
    };
    window.addEventListener(EVENT_NAME, listener);
    disposers.push(() => window.removeEventListener(EVENT_NAME, listener));

    clearAllLiveWidgetTypography();

    expect(seen).toEqual([
      { widgetId: "w-2", typography: undefined, updatedAt: expect.any(Number) },
      { widgetId: "w-1", typography: undefined, updatedAt: expect.any(Number) },
    ]);
  });
});

describe("broadcastWidgetTypography wraz z subscribeWidgetTypography", () => {
  it("obieg pełny: nadanie wstrzykuje <style> i migawkę, a czyszczenie zdejmuje OBA", () => {
    const { onChange } = subscribe("w-live");

    broadcastWidgetTypography("w-live", TYPO_A);

    expect(onChange).toHaveBeenLastCalledWith(TYPO_A);
    expect(window.sessionStorage.getItem(storageKey("w-live"))).toContain("w-live");
    const injected = document.getElementById(styleId("w-live"));
    expect(injected).toBeInstanceOf(HTMLStyleElement);
    expect(injected?.textContent).toContain("w-live");

    clearAllLiveWidgetTypography();

    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(window.sessionStorage.getItem(storageKey("w-live"))).toBeNull();
    expect(document.getElementById(styleId("w-live"))).toBeNull();
  });

  it("nadanie wartości undefined KASUJE migawkę i znacznik <style> tego widgetu", () => {
    const { onChange } = subscribe("w-live");
    broadcastWidgetTypography("w-live", TYPO_A);

    broadcastWidgetTypography("w-live", undefined);

    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(window.sessionStorage.getItem(storageKey("w-live"))).toBeNull();
    expect(document.getElementById(styleId("w-live"))).toBeNull();
  });

  it("nadpisuje istniejący znacznik <style> zamiast dokładać DRUGI dla tego samego widgetu", () => {
    broadcastWidgetTypography("w-live", TYPO_A);
    broadcastWidgetTypography("w-live", TYPO_B);

    expect(liveStyleIds()).toEqual([styleId("w-live")]);
    expect(document.getElementById(styleId("w-live"))?.textContent).toContain("uppercase");
  });

  it("oczyszcza znaki spoza [a-zA-Z0-9_-] w identyfikatorze znacznika <style>", () => {
    broadcastWidgetTypography("hero/1 ż", TYPO_A);

    expect(liveStyleIds()).toEqual(["builder-live-typography-style-hero-1--"]);
  });

  it("hydratuje świeżego subskrybenta z migawki zapisanej w sessionStorage", () => {
    seedSnapshot("w-hydrate", TYPO_A);

    const { onChange } = subscribe("w-hydrate");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(TYPO_A);
    expect(document.getElementById(styleId("w-hydrate"))?.textContent).toContain("w-hydrate");
  });

  it("IGNORUJE uszkodzoną migawkę JSON i nie wywraca subskrypcji", () => {
    window.sessionStorage.setItem(storageKey("w-broken"), "{nie-json");

    const { onChange } = subscribe("w-broken");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("IGNORUJE migawkę zapisaną pod cudzym widgetId", () => {
    window.sessionStorage.setItem(
      storageKey("w-mine"),
      JSON.stringify({ widgetId: "w-inny", typography: TYPO_A, updatedAt: 1 }),
    );

    const { onChange } = subscribe("w-mine");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("NIE reaguje na nadanie dotyczące innego widgetu", () => {
    const { onChange } = subscribe("w-mine");

    broadcastWidgetTypography("w-inny", TYPO_A);

    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ["ładunek nie jest obiektem", "tekst"],
    ["ładunek jest tablicą", [{ widgetId: "w-mine" }]],
    ["BRAKUJE pola widgetId", { typography: TYPO_A }],
    ["widgetId nie jest tekstem", { widgetId: 7, typography: TYPO_A }],
    ["typografia nie jest obiektem", { widgetId: "w-mine", typography: 42 }],
  ])("ODRZUCA zdarzenie, w którym %s", (_opis, detail) => {
    const { onChange } = subscribe("w-mine");

    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("ODRZUCA zwykłe Event pod tą samą nazwą, bo nie niesie żadnego detalu", () => {
    const { onChange } = subscribe("w-mine");

    window.dispatchEvent(new Event(EVENT_NAME));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("przyjmuje ładunek BEZ pola updatedAt i uzupełnia je znacznikiem czasu", () => {
    const { onChange } = subscribe("w-mine");

    window.dispatchEvent(
      new CustomEvent(EVENT_NAME, { detail: { widgetId: "w-mine", typography: TYPO_B } }),
    );

    expect(onChange).toHaveBeenLastCalledWith(TYPO_B);
  });

  it("po odsubskrybowaniu subskrybent NIE dostaje już żadnych powiadomień", () => {
    const { onChange, unsubscribe } = subscribe("w-mine");

    unsubscribe();
    broadcastWidgetTypography("w-mine", TYPO_A);
    clearAllLiveWidgetTypography();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("działa w przeglądarce BEZ BroadcastChannel - powiadomienie w tym samym dokumencie nadal dochodzi", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const { onChange } = subscribe("w-mine");

    broadcastWidgetTypography("w-mine", TYPO_A);

    expect(onChange).toHaveBeenLastCalledWith(TYPO_A);
  });

  it("PRZEŻYWA wyjątek z konstruktora BroadcastChannel i nadal powiadamia subskrybenta", () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new Error("BroadcastChannel zablokowany przez polityke");
        }
      },
    );
    const { onChange } = subscribe("w-mine");

    broadcastWidgetTypography("w-mine", TYPO_A);

    expect(onChange).toHaveBeenLastCalledWith(TYPO_A);
  });

  it("przyjmuje zmianę wysłaną z INNEJ karty przez BroadcastChannel", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const { onChange } = subscribe("w-mine");
    const innaKarta = new FakeBroadcastChannel("builder-widget-typography");

    innaKarta.postMessage({ widgetId: "w-mine", typography: TYPO_B, updatedAt: 2 });

    expect(onChange).toHaveBeenLastCalledWith(TYPO_B);
    expect(document.getElementById(styleId("w-mine"))?.textContent).toContain("uppercase");
    innaKarta.close();
  });

  it("po odsubskrybowaniu ZAMYKA kanał i nie przyjmuje już wiadomości z innej karty", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const { onChange, unsubscribe } = subscribe("w-mine");
    const innaKarta = new FakeBroadcastChannel("builder-widget-typography");

    unsubscribe();
    innaKarta.postMessage({ widgetId: "w-mine", typography: TYPO_B, updatedAt: 2 });

    expect(onChange).not.toHaveBeenCalled();
    innaKarta.close();
  });

  it("BEZ obiektu document nie dotyka DOM, ale nadal powiadamia subskrybentów", () => {
    const { onChange } = subscribe("w-mine");
    seedSnapshot("w-mine", TYPO_A);

    vi.stubGlobal("document", undefined);
    broadcastWidgetTypography("w-mine", TYPO_A);
    clearAllLiveWidgetTypography();
    vi.unstubAllGlobals();

    expect(onChange).toHaveBeenNthCalledWith(1, TYPO_A);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(liveStyleIds()).toEqual([]);
  });

  it("na serwerze (BEZ obiektu window) KAŻDA z trzech funkcji jest bezpiecznym no-opem", () => {
    const onChange = vi.fn();
    vi.stubGlobal("window", undefined);
    const unsubscribe = subscribeWidgetTypography("w-ssr", onChange);
    broadcastWidgetTypography("w-ssr", TYPO_A);
    clearAllLiveWidgetTypography();
    unsubscribe();
    vi.unstubAllGlobals();

    expect(onChange).not.toHaveBeenCalled();
    expect(liveStyleIds()).toEqual([]);
  });

  it("nadaje typografię także wtedy, gdy sessionStorage jest WYŁĄCZONY", () => {
    withDisabledSessionStorage(() => {
      const onChange = vi.fn();
      const unsubscribe = subscribeWidgetTypography("w-mine", onChange);
      disposers.push(unsubscribe);

      expect(() => broadcastWidgetTypography("w-mine", TYPO_A)).not.toThrow();

      expect(onChange).toHaveBeenLastCalledWith(TYPO_A);
      expect(document.getElementById(styleId("w-mine"))?.textContent).toContain("w-mine");
    });
  });
});
