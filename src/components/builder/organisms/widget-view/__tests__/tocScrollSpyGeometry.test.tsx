// TocWidget: aktywna sekcja i postęp czytania z GEOMETRII nagłówków, liczone
// w JEDNYM pasywnym listenerze `scroll` throttlowanym klatką animacji
// (AGENTS.md: „Derive article table-of-contents activity from heading
// geometry in one animation-frame-throttled scroll listener").
//
// Co udowadniamy i dlaczego:
//   * SZYBKI SKOK przez kilka sekcji w jednej klatce ustawia sekcję, w której
//     czytelnik faktycznie wylądował. Dawny IntersectionObserver z wąskim pasem
//     (`rootMargin: -20% 0px -70% 0px`) nie zgłaszał nagłówka, który
//     przeskoczył pas między dwiema klatkami - spis zostawał na starej sekcji
//     albo nie pokazywał żadnej.
//   * Nagłówek BEZ BOKSU (display:none, treść zwiniętego <details>, kopia
//     responsywna ukryta na tym ekranie) nie bywa aktywny. Przeglądarka mierzy
//     go zerowym prostokątem z `top = 0`, który zawsze leży „nad linią", więc
//     wygrywał z nagłówkiem przewiniętym już za górną krawędź okna, a na
//     początku strony zapalał się, zanim czytelnik minął jakikolwiek nagłówek.
//   * JEDEN listener scroll (pasywny) i żaden IntersectionObserver; seria
//     zdarzeń z jednej klatki zleca jeden pomiar, który aktualizuje naraz
//     aktywną pozycję i pasek postępu.
//   * Sprzątanie po odmontowaniu: listener zdjęty, zlecona klatka anulowana,
//     kolejne zdarzenia nie zlecają pracy. Render serwerowy nie dotyka
//     geometrii ani listenerów.
//
// Granice: geometria nagłówków (getBoundingClientRect), metryki dokumentu,
// wysokość okna i kolejka klatek (requestAnimationFrame) to atrapy - happy-dom
// nie liczy układu. IntersectionObserver to atrapa „pasowa" o semantyce
// przeglądarki: zgłasza wyłącznie ZMIANY przecięcia z pasem obserwacji przy
// każdej klatce. Widget, parser pozycji i React są prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { TocWidget } from "../TocWidget";
import type { WidgetContent } from "@/lib/builder/types";

const VIEWPORT_H = 1000;
const HEADING_H = 40;
/** Pozycje nagłówków w dokumencie (px od góry strony). */
const SECTIONS = [
  { id: "sec-a", text: "Sekcja A", top: 0 },
  { id: "sec-b", text: "Sekcja B", top: 1000 },
  { id: "sec-c", text: "Sekcja C", top: 2000 },
  { id: "sec-d", text: "Sekcja D", top: 3000 },
  { id: "sec-e", text: "Sekcja E", top: 4000 },
] as const;
const DOC_H = 5000;

let scrollY = 0;

// ---- kolejka klatek ----
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const requestFrame = vi.fn((cb: FrameRequestCallback) => {
  const id = nextFrame++;
  frames.set(id, cb);
  return id;
});
const cancelFrame = vi.fn((id: number) => {
  frames.delete(id);
});

// ---- IntersectionObserver o semantyce przeglądarki (pas rootMargin) ----
const observers = new Set<BandObserver>();
let observersCreated = 0;
class BandObserver {
  private readonly targets = new Map<Element, boolean>();
  private readonly top: number;
  private readonly bottom: number;
  constructor(
    private readonly cb: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    observersCreated += 1;
    // `rootMargin: "-20% 0px -70% 0px"` -> pas od 20% do 30% wysokości okna.
    const [t = "0%", , b = "0%"] = (options?.rootMargin ?? "0% 0px 0% 0px").split(/\s+/);
    this.top = (-parseFloat(t) / 100) * VIEWPORT_H;
    this.bottom = VIEWPORT_H + (parseFloat(b) / 100) * VIEWPORT_H;
    observers.add(this);
  }
  private intersects(el: Element): boolean {
    const r = el.getBoundingClientRect();
    return r.top < this.bottom && r.bottom > this.top;
  }
  observe(el: Element): void {
    const now = this.intersects(el);
    this.targets.set(el, now);
    this.cb(
      [
        { target: el, isIntersecting: now, boundingClientRect: el.getBoundingClientRect() },
      ] as never,
      this as never,
    );
  }
  /** Klatka: zgłoszenie tylko tych celów, których stan przecięcia się zmienił. */
  tick(): void {
    const changed: IntersectionObserverEntry[] = [];
    for (const [el, was] of this.targets) {
      const now = this.intersects(el);
      if (now === was) continue;
      this.targets.set(el, now);
      changed.push({
        target: el,
        isIntersecting: now,
        boundingClientRect: el.getBoundingClientRect(),
      } as never);
    }
    if (changed.length) this.cb(changed, this as never);
  }
  unobserve(el: Element): void {
    this.targets.delete(el);
  }
  disconnect(): void {
    this.targets.clear();
    observers.delete(this);
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** Jedna klatka przeglądarki: zlecone callbacki rAF, potem obserwatory przecięć. */
function flushFrame(): void {
  const pending = [...frames.values()];
  frames = new Map();
  act(() => {
    for (const cb of pending) cb(performance.now());
    for (const io of observers) io.tick();
  });
}

/** Przewinięcie strony: metryki dokumentu + zdarzenie `scroll` na oknie. */
function scrollPage(y: number): void {
  scrollY = y;
  act(() => {
    fireEvent.scroll(window);
  });
}

function mountHeadings(): void {
  const host = document.createElement("div");
  host.setAttribute("data-cms-content", "");
  for (const s of SECTIONS) {
    const h = document.createElement("h2");
    h.id = s.id;
    h.textContent = s.text;
    Object.defineProperty(h, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const top = s.top - scrollY;
        return {
          top,
          bottom: top + HEADING_H,
          left: 0,
          right: 800,
          width: 800,
          height: HEADING_H,
          x: 0,
          y: top,
          toJSON: () => ({}),
        } as DOMRect;
      },
    });
    host.appendChild(h);
  }
  document.body.appendChild(host);
}

const MANUAL: WidgetContent = {
  // Jawne kotwice istniejących nagłówków - widget nie skanuje DOM-u.
  items_pl: SECTIONS.map((s) => `#${s.id} | ${s.text}`),
  showProgress: true,
};

function activeHref(): string | null {
  return (
    document.querySelector<HTMLAnchorElement>('a[aria-current="location"]')?.getAttribute("href") ??
    null
  );
}

const de = document.documentElement;
let realInnerHeight: PropertyDescriptor | undefined;

beforeEach(() => {
  scrollY = 0;
  frames = new Map();
  nextFrame = 1;
  observers.clear();
  observersCreated = 0;
  requestFrame.mockClear();
  cancelFrame.mockClear();
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  vi.stubGlobal("IntersectionObserver", BandObserver);
  realInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
  Object.defineProperty(window, "innerHeight", { configurable: true, value: VIEWPORT_H });
  Object.defineProperty(de, "scrollHeight", { configurable: true, value: DOC_H });
  Object.defineProperty(de, "clientHeight", { configurable: true, value: VIEWPORT_H });
  Object.defineProperty(de, "scrollTop", { configurable: true, get: () => scrollY });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  mountHeadings();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (realInnerHeight) Object.defineProperty(window, "innerHeight", realInnerHeight);
  Reflect.deleteProperty(de, "scrollHeight");
  Reflect.deleteProperty(de, "clientHeight");
  Reflect.deleteProperty(de, "scrollTop");
  document.body.innerHTML = "";
});

describe("TocWidget - aktywna sekcja z geometrii nagłówków", () => {
  it("szybki skok przez kilka sekcji w jednej klatce ustawia sekcję, w której wylądował czytelnik", () => {
    render(<TocWidget content={MANUAL} lang="pl" />);
    flushFrame();

    // Jeden skok z początku strony za nagłówek D (A, B, C i D mijają pas
    // obserwacji w tej samej klatce) - aktywna jest D, nie stara pozycja.
    scrollPage(3100);
    flushFrame();
    expect(activeHref()).toBe("#sec-d");
    expect(screen.getByRole("link", { name: /Sekcja D/ })).toHaveAttribute(
      "aria-current",
      "location",
    );
    expect(screen.getByRole("link", { name: /Sekcja A/ })).not.toHaveAttribute("aria-current");

    // I z powrotem, znów przez kilka sekcji naraz.
    scrollPage(1050);
    flushFrame();
    expect(activeHref()).toBe("#sec-b");
  });

  it("nagłówek tuż pod linią odniesienia (~20% okna) jeszcze nie jest aktywny", () => {
    render(<TocWidget content={MANUAL} lang="pl" />);
    flushFrame();
    // Linia = 200 px. C ma górę na 2000 - 1790 = 210 px (pod linią), B jest nad nią.
    scrollPage(1790);
    flushFrame();
    expect(activeHref()).toBe("#sec-b");
    // C przekracza linię (góra na 190 px) - teraz C.
    scrollPage(1810);
    flushFrame();
    expect(activeHref()).toBe("#sec-c");
  });
});

/** Prostokąt elementu bez boksu - tak przeglądarka mierzy display:none i treść zwiniętego <details>. */
const NO_BOX = {
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  width: 0,
  height: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

/** Wstawia za nagłówkiem `afterId` kontener z nagłówkiem H3, który nie ma boksu. */
function mountBoxlessHeading(container: HTMLElement, afterId: string, id: string, text: string) {
  const h = document.createElement("h3");
  h.id = id;
  h.textContent = text;
  Object.defineProperty(h, "getBoundingClientRect", { configurable: true, value: () => NO_BOX });
  container.appendChild(h);
  document.getElementById(afterId)!.after(container);
}

describe("TocWidget - nagłówki bez boksu nie przejmują aktywnej pozycji", () => {
  it("nagłówek w zwiniętym <details> nie wypiera sekcji przewiniętej za górną krawędź okna", () => {
    // Blok Details wstrzykuje treść z nagłówkiem do zwiniętego <details>
    // między sekcjami B i C.
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Szczegóły";
    details.appendChild(summary);
    mountBoxlessHeading(details, "sec-b", "zwinieta", "Zwinięta podsekcja");
    const content: WidgetContent = {
      items_pl: [
        "#sec-a | Sekcja A",
        "#sec-b | Sekcja B",
        "#zwinieta | Zwinięta podsekcja",
        "#sec-c | Sekcja C",
        "#sec-d | Sekcja D",
      ],
    };
    render(<TocWidget content={content} lang="pl" />);
    flushFrame();

    // Środek długiej sekcji C: jej nagłówek ma górę na -500 px, D jeszcze
    // pod linią (500 px) - czytelnik wciąż jest w C.
    scrollPage(2500);
    flushFrame();
    expect(activeHref()).toBe("#sec-c");
    expect(screen.getByRole("link", { name: /Zwinięta podsekcja/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("ukryta kopia responsywna nie zapala pozycji przed pierwszym nagłówkiem ani po nim", () => {
    // Karta profilu renderuje nazwisko dwa razy (układ desktop i mobile);
    // jedna z kopii jest zawsze ukryta CSS-em.
    mountBoxlessHeading(document.createElement("div"), "sec-a", "ewa-nowak", "Ewa Nowak");
    const content: WidgetContent = {
      items_pl: ["#ewa-nowak | Ewa Nowak", "#sec-b | Sekcja B", "#sec-c | Sekcja C"],
    };
    render(<TocWidget content={content} lang="pl" />);
    flushFrame();

    // Początek strony: B (1000 px) i C leżą pod linią - nic nie jest aktywne.
    expect(activeHref()).toBeNull();
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current");
    }

    // B minęła górną krawędź okna (-100 px) - aktywna B, nie ukryta kopia.
    scrollPage(1100);
    flushFrame();
    expect(activeHref()).toBe("#sec-b");
  });
});

describe("TocWidget - jeden listener scroll throttlowany klatką", () => {
  it("rejestruje dokładnie jeden pasywny listener scroll i nie tworzy IntersectionObservera", () => {
    const add = vi.spyOn(window, "addEventListener");
    render(<TocWidget content={MANUAL} lang="pl" />);
    flushFrame();

    const scrollRegs = add.mock.calls.filter(([type]) => type === "scroll");
    expect(scrollRegs).toHaveLength(1);
    expect(scrollRegs[0][2]).toEqual({ passive: true });
    expect(observersCreated).toBe(0);
  });

  it("seria zdarzeń z jednej klatki zleca jeden pomiar, który aktualizuje aktywną pozycję i postęp naraz", () => {
    render(<TocWidget content={MANUAL} lang="pl" />);
    flushFrame();
    requestFrame.mockClear();

    for (const y of [500, 1200, 2100, 2600, 3100]) scrollPage(y);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    // Przed klatką nic się nie zmienia - pomiar należy do klatki.
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

    flushFrame();
    // 3100 / (5000 - 1000) = 77,5% -> 78; aktywna D - z tego samego pomiaru.
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "78");
    expect(activeHref()).toBe("#sec-d");

    // Następna klatka przyjmuje kolejne zlecenie.
    scrollPage(4000);
    expect(requestFrame).toHaveBeenCalledTimes(2);
    flushFrame();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(activeHref()).toBe("#sec-e");
  });
});

describe("TocWidget - sprzątanie i SSR", () => {
  it("po odmontowaniu zdejmuje listener, anuluje zleconą klatkę i nie zleca kolejnych", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const view = render(<TocWidget content={MANUAL} lang="pl" />);
    flushFrame();
    const listener = add.mock.calls.find(([type]) => type === "scroll")?.[1];
    expect(listener).toBeTypeOf("function");

    scrollPage(2100);
    const pendingId = requestFrame.mock.results.at(-1)?.value as number;
    view.unmount();

    expect(remove).toHaveBeenCalledWith("scroll", listener);
    expect(cancelFrame).toHaveBeenCalledWith(pendingId);
    expect(frames.size).toBe(0);

    requestFrame.mockClear();
    fireEvent.scroll(window);
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("render serwerowy nie mierzy nagłówków, nie rejestruje listenera i nie zleca klatek", () => {
    const add = vi.spyOn(window, "addEventListener");
    const measure = vi.fn();
    for (const s of SECTIONS) {
      Object.defineProperty(document.getElementById(s.id)!, "getBoundingClientRect", {
        configurable: true,
        value: measure,
      });
    }

    const html = renderToString(<TocWidget content={MANUAL} lang="pl" />);

    expect(html).toContain("Sekcja A");
    expect(add.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(0);
    expect(requestFrame).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
  });
});
