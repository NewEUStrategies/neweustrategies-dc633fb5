// RAMKA WIDGETU: STAŁE DEKLARACJE JAKO KLASY, WARTOŚCI PER INSTANCJA INLINE.
//
// ── CO TU MA DOWÓD (P2.6, HW-6) ────────────────────────────────────────────
// Domyślna ramka blokowego widgetu niosła u KAŻDEGO widgetu strony ten sam
// `style="width:100%;min-width:0;max-width:100%;box-sizing:border-box;
// align-self:stretch;justify-self:stretch;margin-top:0;margin-bottom:0"`
// (137 B × 23 na produkcji). Parser dokumentu rozbiera każdy taki atrybut jako
// CSS w zadaniu ParseHTML, a po boocie za LCP to zadanie liczy się do TBT.
//
// Plik pilnuje czterech rzeczy:
// 1. domyślna ramka strony publicznej nie ma atrybutu `style`;
// 2. WYNIKOWE deklaracje ramki (kaskada: klasy + inline) są te same co przed
//    zmianą - wartości per instancja (szerokość ≠ 100 %, marginesy `auto`,
//    jawna wysokość, `flex` widgetu inline) zostają inline i wygrywają z klasą
//    tak jak dotąd;
// 3. w kanwie edytora szerokość zostaje inline, bo nakładka zmiany rozmiaru
//    czyta tryb szerokości z `el.style.width` (bez niej pełnoszeroki widget
//    w kolumnie z paddingiem dostawał plakietkę „auto”);
// 4. SSR i klient wypisują ten sam `class` i ten sam `style` (parytet
//    hydratacji: React nie łata różnic atrybutów).
//
// GRANICA DOWODU: happy-dom liczy kaskadę (`getComputedStyle` uwzględnia
// arkusze i pierwszeństwo inline), ale nie ma tu skompilowanego arkusza
// Tailwinda. `FRAME_UTILITIES_CSS` niżej podaje znaczenie klas ramki
// (wartości Tailwinda 4 sprowadzone do longhandów, bo happy-dom nie rozwija
// `margin-block` i nie liczy `calc`). Wyliczony styl prawdziwego arkusza przy
// 390/820/1350 px w obu motywach mierzy sonda parytetu stylów z P2.4.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRef } from "react";
import { renderToString } from "react-dom/server";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import "@/test/i18nReal";
import type { Device, WidgetNode } from "@/lib/builder/types";
import { WidgetResizeOverlay } from "@/components/admin/builder/ui/organisms/builder/WidgetResizeOverlay";
import { BuilderWidgetNode } from "../BuilderWidgetNode";
import { widget } from "./builderRendererFixtures";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

/** Znaczenie klas, którymi ramka zastępuje stałe deklaracje inline. */
const FRAME_UTILITIES_CSS = `
.w-full { width: 100%; }
.min-w-0 { min-width: 0; }
.max-w-full { max-width: 100%; }
.box-border { box-sizing: border-box; }
.self-stretch { align-self: stretch; }
.justify-self-stretch { justify-self: stretch; }
.my-0 { margin-top: 0; margin-bottom: 0; }
.mt-0 { margin-top: 0; }
.mb-0 { margin-bottom: 0; }
`;

let utilities: HTMLStyleElement;
beforeAll(() => {
  utilities = document.createElement("style");
  utilities.textContent = FRAME_UTILITIES_CSS;
  document.head.appendChild(utilities);
});
afterAll(() => utilities.remove());

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface FrameCase {
  node: WidgetNode;
  inRow?: boolean;
  onlyOneBlock?: boolean;
  device?: Device;
  /** Ramka w kanwie edytora (edycja w miejscu, `InlineEditProvider`). */
  editorCanvas?: boolean;
}

const noopContentChange = () => {};

function element({
  node,
  inRow = false,
  onlyOneBlock = false,
  device = "desktop",
  editorCanvas = false,
}: FrameCase) {
  return (
    <BuilderWidgetNode
      widget={node}
      lang="pl"
      device={device}
      inRow={inRow}
      onlyOneBlock={onlyOneBlock}
      onContentChange={editorCanvas ? noopContentChange : undefined}
    />
  );
}

/** Ramka z renderu klienckiego. */
function clientFrame(c: FrameCase): HTMLElement {
  const { container } = renderWithQueryClient(element(c));
  const frame = container.querySelector<HTMLElement>(`[data-widget-id="${c.node.id}"]`);
  if (!frame) throw new Error("brak ramki widgetu");
  return frame;
}

/** Ramka z HTML serwera (to samo drzewo, `renderToString`). */
function serverFrame(c: FrameCase): HTMLElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const html = renderToString(
    <QueryClientProvider client={client}>{element(c)}</QueryClientProvider>,
  );
  const host = document.createElement("div");
  host.innerHTML = html;
  const frame = host.querySelector<HTMLElement>(`[data-widget-id="${c.node.id}"]`);
  if (!frame) throw new Error("brak ramki widgetu w HTML serwera");
  return frame;
}

/** Właściwości, które ramka przed P2.6 deklarowała inline. */
const FRAME_PROPERTIES = [
  "width",
  "min-width",
  "max-width",
  "box-sizing",
  "align-self",
  "justify-self",
  "margin-top",
  "margin-bottom",
] as const;

/** Wynikowe deklaracje ramki po kaskadzie (`0px` i `0` to ta sama wartość). */
function effective(el: HTMLElement): Record<string, string> {
  const computed = getComputedStyle(el);
  return Object.fromEntries(
    FRAME_PROPERTIES.map((p) => [p, computed.getPropertyValue(p).replace(/^0px$/, "0")]),
  );
}

/** Deklaracje domyślnej ramki blokowej sprzed P2.6 (dawny `style=""`). */
const BLOCK_FRAME: Record<string, string> = {
  width: "100%",
  "min-width": "0",
  "max-width": "100%",
  "box-sizing": "border-box",
  "align-self": "stretch",
  "justify-self": "stretch",
  "margin-top": "0",
  "margin-bottom": "0",
};

/**
 * Deklaracje inline jako posortowana lista `właściwość: wartość`. Surowego
 * atrybutu nie porównujemy: React po stronie klienta ustawia style przez
 * CSSOM, więc serializacja (spacje, średniki) różni się od HTML serwera, choć
 * deklaracje są te same.
 */
function declarations(el: HTMLElement): string[] {
  const out: string[] = [];
  for (let i = 0; i < el.style.length; i++) {
    const property = el.style.item(i);
    out.push(`${property}: ${el.style.getPropertyValue(property)}`);
  }
  return out.sort();
}

describe('BuilderWidgetNode - domyślna ramka blokowa strony publicznej bez style=""', () => {
  it.each(["desktop", "tablet", "mobile"] as const)(
    "na urządzeniu %s nie ma atrybutu style, a wynikowe deklaracje są te same co dawny inline",
    (device) => {
      const frame = clientFrame({ node: widget(`w-${device}`, "heading"), device });
      expect(frame.getAttribute("style")).toBeNull();
      expect(effective(frame)).toEqual(BLOCK_FRAME);
    },
  );

  it("nie powtarza klas w atrybucie class (każdy bajt ramki idzie ×23 na stronę)", () => {
    const tokens = clientFrame({ node: widget("w1", "heading") }).className.split(/\s+/);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("etykieta sekcji i jedyny blok kolumny też są bez style", () => {
    expect(clientFrame({ node: widget("w1", "section-label") }).getAttribute("style")).toBeNull();
    const only = clientFrame({ node: widget("w2", "heading"), onlyOneBlock: true });
    expect(only.getAttribute("style")).toBeNull();
    expect(effective(only)).toEqual(BLOCK_FRAME);
  });
});

describe("BuilderWidgetNode - wartości per instancja zostają inline i wygrywają z klasą", () => {
  it("szerokość inna niż 100 %", () => {
    const frame = clientFrame({
      node: widget("w1", "heading", { advanced: { width: "50%" } } as Partial<WidgetNode>),
    });
    expect(frame.style.width).toBe("50%");
    expect(effective(frame)).toEqual({ ...BLOCK_FRAME, width: "50%" });
  });

  it("selfAlign center: oba marginesy auto", () => {
    const frame = clientFrame({
      node: widget("w1", "heading", { style: { selfAlign: "center" } } as Partial<WidgetNode>),
    });
    expect(effective(frame)).toEqual({
      ...BLOCK_FRAME,
      "margin-top": "auto",
      "margin-bottom": "auto",
    });
  });

  it("selfAlign start: górny margines zero, dolny auto", () => {
    const frame = clientFrame({
      node: widget("w1", "heading", { style: { selfAlign: "start" } } as Partial<WidgetNode>),
    });
    expect(effective(frame)).toEqual({ ...BLOCK_FRAME, "margin-bottom": "auto" });
  });

  it("jawna wysokość: wysokość i zamrożony flex inline, reszta jak dotąd", () => {
    const frame = clientFrame({
      node: widget("w1", "heading", { advanced: { height: 240 } } as Partial<WidgetNode>),
    });
    expect(frame.getAttribute("data-widget-explicit-height")).toBe("true");
    expect(frame.style.height).toBe("240px");
    expect(frame.style.minHeight).toBe("240px");
    expect(frame.style.maxHeight).toBe("240px");
    expect(frame.style.flexBasis).toBe("auto");
    expect(frame.style.flexGrow).toBe("0");
    expect(frame.style.flexShrink).toBe("0");
    expect(effective(frame)).toEqual(BLOCK_FRAME);
  });

  it("widget inline w wierszu: szerokość auto i flex, bez rozciągania i zerowania marginesów", () => {
    const frame = clientFrame({
      node: widget("w1", "heading", { advanced: { layout: "inline" } } as Partial<WidgetNode>),
      inRow: true,
    });
    expect(frame.getAttribute("data-widget-layout")).toBe("inline");
    expect(frame.style.flex).toBe("0 0 auto");
    const decl = effective(frame);
    expect(decl).toMatchObject({
      width: "auto",
      "min-width": "0",
      "max-width": "100%",
      "box-sizing": "border-box",
    });
    // Stałe ramki BLOKOWEJ nie dotyczą widgetu w wierszu.
    expect(decl["align-self"]).not.toBe("stretch");
    expect(decl["margin-top"]).toBe("");
  });
});

describe("BuilderWidgetNode - kanwa edytora trzyma szerokość inline", () => {
  it("ramka w kanwie ma inline width:100%, a wynikowe deklaracje się nie zmieniają", () => {
    const frame = clientFrame({ node: widget("w1", "heading"), editorCanvas: true });
    expect(frame.style.width).toBe("100%");
    expect(effective(frame)).toEqual(BLOCK_FRAME);
  });

  it("strona publiczna (bez edycji w miejscu) nie ma inline szerokości", () => {
    expect(clientFrame({ node: widget("w1", "heading") }).style.width).toBe("");
  });

  /**
   * Prawdziwa ramka w kolumnie z paddingiem bezpiecznym (12 px z każdej
   * strony): kolumna 600 px, ramka 576 px. happy-dom nie robi layoutu, więc
   * prostokąty są podstawione per element - nakładka dzieli jeden przez drugi.
   */
  function CanvasHost({ node }: { node: WidgetNode }) {
    const ref = useRef<HTMLDivElement | null>(null);
    return (
      <div ref={ref} data-testid="kanwa" style={{ position: "relative" }}>
        <div data-col-id="c1" style={{ padding: 12, boxSizing: "border-box" }}>
          {element({ node, editorCanvas: true })}
        </div>
        <WidgetResizeOverlay
          containerRef={ref}
          widgetId={node.id}
          device="desktop"
          onResize={() => {}}
        />
      </div>
    );
  }

  function stubCanvasBoxes(): void {
    const rectOf = (width: number): DOMRect => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: 100,
      width,
      height: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset.testid === "kanwa" || this.dataset.colId) return rectOf(600);
      if (this.dataset.widgetId) return rectOf(576);
      return rectOf(0);
    });
    // happy-dom nie ma `ResizeObserver`.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  }

  it("nakładka zmiany rozmiaru opisuje pełnoszeroki widget jako 100 %, nie auto", () => {
    stubCanvasBoxes();
    renderWithQueryClient(<CanvasHost node={widget("w1", "heading")} />);
    expect(screen.getByText(/^W: /).textContent).toBe("W: 576px · 100%");
  });

  it("procentowa szerokość dalej idzie etykietą procentu", () => {
    stubCanvasBoxes();
    renderWithQueryClient(
      <CanvasHost
        node={widget("w1", "heading", { advanced: { width: "50%" } } as Partial<WidgetNode>)}
      />,
    );
    expect(screen.getByText(/^W: /).textContent).toBe("W: 576px · 50%");
  });
});

describe("BuilderWidgetNode - parytet SSR i klienta", () => {
  const cases: Array<[string, FrameCase]> = [
    ["domyślny blok", { node: widget("p1", "heading") }],
    [
      "blok 50 %",
      { node: widget("p2", "heading", { advanced: { width: "50%" } } as Partial<WidgetNode>) },
    ],
    [
      "blok selfAlign end",
      { node: widget("p3", "heading", { style: { selfAlign: "end" } } as Partial<WidgetNode>) },
    ],
    [
      "jawna wysokość na telefonie",
      {
        node: widget("p4", "heading", { advanced: { height: 120 } } as Partial<WidgetNode>),
        device: "mobile",
      },
    ],
    [
      "inline w wierszu",
      {
        node: widget("p5", "heading", { advanced: { layout: "inline" } } as Partial<WidgetNode>),
        inRow: true,
      },
    ],
    ["kanwa edytora", { node: widget("p6", "heading"), editorCanvas: true }],
  ];

  it.each(cases)("%s: ten sam class i style po obu stronach", (_label, c) => {
    const server = serverFrame(c);
    cleanup();
    const client = clientFrame(c);
    expect(server.className).toBe(client.className);
    expect(server.hasAttribute("style")).toBe(client.hasAttribute("style"));
    expect(declarations(server)).toEqual(declarations(client));
  });
});
