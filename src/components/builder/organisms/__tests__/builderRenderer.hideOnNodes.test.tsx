// PUBLICZNY RENDERER: `advanced.hideOn` SEKCJI, SEKCJI ZAGNIEŻDŻONEJ I KOLUMNY.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// Do 2026-10-18 renderer honorował `hideOn` wyłącznie dla widgetów (dwa
// `it.fails` w `builderRenderer.access.test.tsx`, dziś zwykłe kontrakty).
// Poprawka ma dwie warstwy i obie są tu udowodnione:
// 1. FILTR na urządzeniu renderera - sekcja, sekcja zagnieżdżona i kolumna
//    (także kolumna WEWNĄTRZ sekcji zagnieżdżonej) ukryte na bieżącym
//    urządzeniu nie trafiają do DOM-u, a rodzeństwo zostaje,
// 2. PIERWSZA KLATKA Z HTML-u SERWERA: SSR renderuje desktop, więc węzeł
//    ukryty na telefonie w nim jest - z atrybutem `data-hide-on-mobile` i regułą
//    `@media (max-width: 767px)`, która chowa go ZANIM ruszy JS. Mierzymy to
//    wyliczonym stylem (happy-dom liczy kaskadę i zapytania `@media` względem
//    szerokości okna), a nie tekstem reguły.
// Do tego HYDRATACJA: HTML serwera z sekcją ukrytą na telefonie hydratuje się
// na wąskim oknie bez rozjazdu (`onRecoverableError` milczy), a sekcja znika
// dopiero po korekcie urządzenia - czyli dokładnie tak jak widgety.
// Oraz spójność ze znacznikiem `data-search-overflow`: wyszukiwarka w kolumnie
// ukrytej na tym urządzeniu nie zdejmuje clipa z sekcji (`searchOverflow.ts`
// filtruje kolumny sekcji zagnieżdżonej tym samym predykatem co `RenderInner`).
//
// ── GRANICE ────────────────────────────────────────────────────────────────
// Leniwy rejestr widgetów zamieniony na lustro eager (jak w sąsiednich
// plikach), obserwatory przeglądarki z `stubObservers` - bez nich korekta
// urządzenia wybierałaby gałąź awaryjną `window.innerWidth`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import "@/test/i18nReal";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import type { BuilderDocument, Device } from "@/lib/builder/types";
import { BuilderRenderer } from "../BuilderRenderer";
import {
  column,
  doc,
  hideOn,
  innerSection,
  section,
  setWindowWidth,
  simpleSection,
  stubObservers,
  widget,
} from "./builderRendererFixtures";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

let observers: ReturnType<typeof stubObservers>;
let szerokoscPierwotna: number;

beforeEach(() => {
  observers = stubObservers();
  __resetBuilderDebugForTests();
  szerokoscPierwotna = window.innerWidth;
});

afterEach(() => {
  cleanup();
  observers.restore();
  ustawOkno(szerokoscPierwotna);
  document.body.innerHTML = "";
  __resetBuilderDebugForTests();
});

/**
 * Szerokość okna dla OBU odbiorców: zapytań `@media` happy-dom (liczy je
 * z własnego widoku - samo `innerWidth` ich nie przestawia) i renderera
 * (atrapa `ResizeObserver` mierzy `window.innerWidth`).
 */
function ustawOkno(width: number): void {
  const happyDOM: { setViewport(v: { width: number; height: number }): void } = Reflect.get(
    window,
    "happyDOM",
  );
  happyDOM.setViewport({ width, height: 800 });
  setWindowWidth(width);
}

function renderuj(dokument: BuilderDocument, device?: Device) {
  return renderWithQueryClient(<BuilderRenderer doc={dokument} lang="pl" device={device} />)
    .container;
}

/** HTML serwera wpięty do dokumentu - tak, jak widzi go przeglądarka przed JS. */
function htmlSerwera(dokument: BuilderDocument): HTMLElement {
  const qc = new QueryClient();
  const host = document.createElement("div");
  host.innerHTML = renderToString(
    <QueryClientProvider client={qc}>
      <BuilderRenderer doc={dokument} lang="pl" />
    </QueryClientProvider>,
  );
  document.body.append(host);
  return host;
}

const ids = (root: ParentNode, attr: "data-sec-id" | "data-col-id" | "data-widget-id") =>
  [...root.querySelectorAll(`[${attr}]`)].map((el) => el.getAttribute(attr));

const DOKUMENT_Z_WERSJA_MOBILNA = doc([
  simpleSection("desktopowa", { advanced: hideOn({ mobile: true }) }),
  simpleSection("mobilna", { advanced: hideOn({ desktop: true, tablet: true }) }),
]);

describe("filtr na urządzeniu renderera", () => {
  it.each<[Device, string[]]>([
    ["desktop", ["desktopowa"]],
    ["tablet", ["desktopowa"]],
    ["mobile", ["mobilna"]],
  ])("wzorzec „wersja desktopowa + mobilna” na %s pokazuje jedną sekcję", (device, widoczne) => {
    expect(ids(renderuj(DOKUMENT_Z_WERSJA_MOBILNA, device), "data-sec-id")).toEqual(widoczne);
  });

  it("sekcja zagnieżdżona ukryta na telefonie znika z całą treścią, rodzeństwo zostaje", () => {
    const dokument = doc([
      section("s", [
        column("zwykla", [widget("w1")]),
        innerSection("zagniezdzona", [column("z1", [widget("w2")])], {
          advanced: hideOn({ mobile: true }),
        }),
      ]),
    ]);
    const telefon = renderuj(dokument, "mobile");
    expect(ids(telefon, "data-widget-id")).toEqual(["w1"]);
    cleanup();
    expect(ids(renderuj(dokument, "desktop"), "data-widget-id")).toEqual(["w1", "w2"]);
  });

  it("kolumna WEWNĄTRZ sekcji zagnieżdżonej ukryta na telefonie znika, sąsiednia zostaje", () => {
    const dokument = doc([
      section("s", [
        innerSection("in", [
          column("z1", [widget("w1")]),
          column("z2", [widget("w2")], { advanced: hideOn({ mobile: true }) }),
        ]),
      ]),
    ]);
    expect(ids(renderuj(dokument, "mobile"), "data-widget-id")).toEqual(["w1"]);
  });

  it("ukrycie na tablecie nie dotyka telefonu ani desktopu", () => {
    const dokument = doc([
      section("s", [
        column("zawsze", [widget("w1")]),
        column("bez-tabletu", [widget("w2")], { advanced: hideOn({ tablet: true }) }),
      ]),
    ]);
    expect(ids(renderuj(dokument, "tablet"), "data-widget-id")).toEqual(["w1"]);
    cleanup();
    expect(ids(renderuj(dokument, "mobile"), "data-widget-id")).toEqual(["w1", "w2"]);
  });
});

describe("pierwsza klatka z HTML-u serwera (SSR = desktop)", () => {
  it("sekcja ukryta na telefonie jest w HTML-u, ale wąskie okno jej nie maluje", () => {
    // Każdy pomiar na ŚWIEŻYM HTML-u: happy-dom nie unieważnia wyliczonego stylu
    // po zmianie widoku, a przeglądarka i tak dostaje HTML przy jednej szerokości.
    ustawOkno(1280);
    const desktop = htmlSerwera(DOKUMENT_Z_WERSJA_MOBILNA);
    const naDesktopie = desktop.querySelector<HTMLElement>('[data-sec-id="desktopowa"]')!;
    // Sekcja ukryta na desktopie nie ma czego szukać w HTML-u desktopowym.
    expect(desktop.querySelector('[data-sec-id="mobilna"]')).toBeNull();
    expect(naDesktopie.hasAttribute("data-hide-on-mobile")).toBe(true);
    expect(getComputedStyle(naDesktopie).display).not.toBe("none");

    ustawOkno(390);
    const telefon = htmlSerwera(DOKUMENT_Z_WERSJA_MOBILNA);
    const naTelefonie = telefon.querySelector<HTMLElement>('[data-sec-id="desktopowa"]')!;
    expect(getComputedStyle(naTelefonie).display).toBe("none");
  });

  it("kolumna ukryta na telefonie: wąskie okno chowa jej slot, sąsiedni slot zostaje", () => {
    const host = htmlSerwera(
      doc([
        section("s", [
          column("zawsze", [widget("w1")]),
          column("bez-telefonu", [widget("w2")], { advanced: hideOn({ mobile: true }) }),
        ]),
      ]),
    );
    ustawOkno(390);
    const slot = (id: string) =>
      host.querySelector<HTMLElement>(`[data-column-slot][data-col-id="${id}"]`)!;
    expect(getComputedStyle(slot("bez-telefonu")).display).toBe("none");
    expect(getComputedStyle(slot("zawsze")).display).not.toBe("none");
  });

  it("kolumna sekcji zagnieżdżonej ukryta na telefonie też jest chowana od pierwszej klatki", () => {
    const host = htmlSerwera(
      doc([
        section("s", [
          innerSection("in", [
            column("z1", [widget("w1")]),
            column("z2", [widget("w2")], { advanced: hideOn({ mobile: true }) }),
          ]),
        ]),
      ]),
    );
    ustawOkno(390);
    const kolumnaZ2 = host.querySelector('[data-col-id="z2"]')!;
    const slotZ2 = kolumnaZ2.closest<HTMLElement>("[data-column-slot]")!;
    expect(getComputedStyle(slotZ2).display).toBe("none");
  });

  it("dokument bez ukryć nie dostaje atrybutów ani dodatkowego arkusza", () => {
    const host = htmlSerwera(doc([simpleSection("a")]));
    expect(host.querySelector("[data-hide-on-mobile]")).toBeNull();
    expect(host.querySelector("style")).toBeNull();
  });

  it("hydratacja HTML-u serwera na telefonie: bez rozjazdu, sekcja znika po korekcie urządzenia", async () => {
    ustawOkno(390);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (
      <QueryClientProvider client={qc}>
        <BuilderRenderer doc={DOKUMENT_Z_WERSJA_MOBILNA} lang="pl" />
      </QueryClientProvider>
    );
    const container = document.createElement("div");
    vi.stubEnv("SSR", true);
    container.innerHTML = renderToString(view);
    vi.stubEnv("SSR", false);
    document.body.append(container);
    expect(ids(container, "data-sec-id")).toEqual(["desktopowa"]);
    const errors: unknown[] = [];
    let root!: Root;
    try {
      await act(async () => {
        root = hydrateRoot(container, view, {
          onRecoverableError: (error) => errors.push(error),
        });
      });
      expect(errors).toEqual([]);
      expect(ids(container, "data-sec-id")).toEqual(["mobilna"]);
    } finally {
      act(() => root.unmount());
      vi.unstubAllEnvs();
    }
  });
});

describe("spójność ze znacznikiem wyszukiwarki", () => {
  it("wyszukiwarka w kolumnie sekcji zagnieżdżonej ukrytej na desktopie nie zdejmuje clipa", () => {
    const dokument = doc([
      section("s", [
        innerSection("in", [
          column("z1", [widget("szukaj", "search-button", { content: {} })], {
            advanced: hideOn({ desktop: true }),
          }),
        ]),
      ]),
    ]);
    const desktop = renderuj(dokument, "desktop");
    expect(desktop.querySelector('[data-sec-id="s"]')?.hasAttribute("data-search-overflow")).toBe(
      false,
    );
    cleanup();
    // KONTROLA DODATNIA: na telefonie ta sama kolumna JEST malowana.
    const telefon = renderuj(dokument, "mobile");
    expect(telefon.querySelector('[data-sec-id="s"]')?.hasAttribute("data-search-overflow")).toBe(
      true,
    );
  });
});
