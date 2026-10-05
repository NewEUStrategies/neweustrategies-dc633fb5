// RAMKA WIDGETU: STAŁE DEKLARACJE JAKO KLASY, WARTOŚCI PER INSTANCJA INLINE.
//
// ── CO TU MA DOWÓD (P2.6, HW-6) ────────────────────────────────────────────
// Domyślna ramka blokowego widgetu niosła u KAŻDEGO widgetu strony ten sam
// `style="width:100%;min-width:0;max-width:100%;box-sizing:border-box;
// align-self:stretch;justify-self:stretch;margin-top:0;margin-bottom:0"`
// (137 B × 23 na produkcji). Parser dokumentu rozbiera każdy taki atrybut jako
// CSS w zadaniu ParseHTML, a po boocie za LCP to zadanie liczy się do TBT.
//
// Plik pilnuje trzech rzeczy:
// 1. domyślna ramka nie ma atrybutu `style`, a każda zdjęta deklaracja ma na
//    tym samym elemencie klasę o identycznej deklaracji;
// 2. wartości PER INSTANCJA (szerokość ≠ 100 %, marginesy `auto`, jawna
//    wysokość, `flex` widgetu inline) zostają inline - inline wygrywa z klasą
//    dokładnie tak, jak wygrywał z resztą deklaracji przed zmianą;
// 3. SSR i klient wypisują ten sam `class` i ten sam `style` (parytet
//    hydratacji: React nie łata różnic atrybutów).
//
// GRANICA DOWODU: happy-dom nie liczy kaskady, więc „ta sama geometria" jest tu
// udowodniona na poziomie deklaracji (inline + klasy), a nie wyliczonego stylu.
// Wyliczony styl przy 390/820/1350 px w obu motywach mierzy sonda parytetu
// stylów z P2.4 na artefakcie.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import "@/test/i18nReal";
import type { Device, WidgetNode } from "@/lib/builder/types";
import { BuilderWidgetNode } from "../BuilderWidgetNode";
import { widget } from "./builderRendererFixtures";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

afterEach(cleanup);

interface FrameCase {
  node: WidgetNode;
  inRow?: boolean;
  onlyOneBlock?: boolean;
  device?: Device;
}

function element({ node, inRow = false, onlyOneBlock = false, device = "desktop" }: FrameCase) {
  return (
    <BuilderWidgetNode
      widget={node}
      lang="pl"
      device={device}
      inRow={inRow}
      onlyOneBlock={onlyOneBlock}
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

const classes = (el: HTMLElement) => el.className.split(/\s+/).filter(Boolean);

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

/** Klasy zastępujące stałe deklaracje domyślnej ramki blokowej. */
const BLOCK_STATIC_CLASSES = [
  "w-full",
  "min-w-0",
  "max-w-full",
  "box-border",
  "self-stretch",
  "justify-self-stretch",
  "my-0",
];

describe('BuilderWidgetNode - domyślna ramka blokowa bez style=""', () => {
  it("nie wypisuje atrybutu style, a każda stała deklaracja ma klasę na tym samym elemencie", () => {
    const frame = clientFrame({ node: widget("w1", "heading") });
    expect(frame.getAttribute("style")).toBeNull();
    expect(classes(frame)).toEqual(expect.arrayContaining(BLOCK_STATIC_CLASSES));
    // Para marginesów idzie jedną klasą `my-0`, nie dwiema.
    expect(classes(frame)).not.toContain("mt-0");
    expect(classes(frame)).not.toContain("mb-0");
  });

  it("nie dubluje klas, które ramka blokowa miała już wcześniej (w-full, min-w-0, max-w-full)", () => {
    const frame = clientFrame({ node: widget("w1", "heading") });
    for (const cls of ["w-full", "min-w-0", "max-w-full"]) {
      expect(classes(frame).filter((c) => c === cls)).toHaveLength(1);
    }
  });

  it("zachowuje klasy układu niezależne od stylu (flex-1 jedynego bloku, z-20 etykiety sekcji)", () => {
    expect(classes(clientFrame({ node: widget("w1", "heading"), onlyOneBlock: true }))).toContain(
      "flex-1",
    );
    const label = clientFrame({ node: widget("w2", "section-label") });
    expect(classes(label)).toEqual(expect.arrayContaining(["relative", "z-20"]));
    expect(label.getAttribute("style")).toBeNull();
  });

  it("tak samo na tablecie i telefonie (domyślna szerokość 100 % na każdym urządzeniu)", () => {
    for (const device of ["tablet", "mobile"] as const) {
      const frame = clientFrame({ node: widget(`w-${device}`, "heading"), device });
      expect(frame.getAttribute("style")).toBeNull();
      expect(classes(frame)).toEqual(expect.arrayContaining(BLOCK_STATIC_CLASSES));
    }
  });
});

describe("BuilderWidgetNode - wartości per instancja zostają inline", () => {
  it("szerokość inna niż 100 % zostaje inline i wygrywa z w-full jak dotąd", () => {
    const frame = clientFrame({
      node: widget("w1", "heading", { advanced: { width: "50%" } } as Partial<WidgetNode>),
    });
    expect(frame.style.width).toBe("50%");
    expect(frame.style.minWidth).toBe("");
    expect(frame.style.maxWidth).toBe("");
    expect(frame.style.alignSelf).toBe("");
    expect(classes(frame)).toEqual(expect.arrayContaining(BLOCK_STATIC_CLASSES));
  });

  it("selfAlign center: oba marginesy auto inline, bez klasy zerującej marginesy", () => {
    const frame = clientFrame({
      node: widget("w1", "heading", { style: { selfAlign: "center" } } as Partial<WidgetNode>),
    });
    expect(frame.style.marginTop).toBe("auto");
    expect(frame.style.marginBottom).toBe("auto");
    expect(classes(frame)).not.toContain("my-0");
    expect(classes(frame)).not.toContain("mt-0");
    expect(classes(frame)).not.toContain("mb-0");
  });

  it("selfAlign start: margines górny zerowany klasą, dolny auto inline", () => {
    const frame = clientFrame({
      node: widget("w1", "heading", { style: { selfAlign: "start" } } as Partial<WidgetNode>),
    });
    expect(frame.style.marginTop).toBe("");
    expect(frame.style.marginBottom).toBe("auto");
    expect(classes(frame)).toContain("mt-0");
    expect(classes(frame)).not.toContain("my-0");
  });

  it("jawna wysokość: wysokość i zamrożony flex zostają inline", () => {
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
    expect(frame.style.boxSizing).toBe("");
    expect(classes(frame)).toEqual(expect.arrayContaining(BLOCK_STATIC_CLASSES));
  });

  it("widget inline w wierszu: szerokość auto i flex zostają, stałe min/max/box-sizing idą klasami", () => {
    const frame = clientFrame({
      node: widget("w1", "heading", { advanced: { layout: "inline" } } as Partial<WidgetNode>),
      inRow: true,
    });
    expect(frame.getAttribute("data-widget-layout")).toBe("inline");
    expect(frame.style.width).toBe("auto");
    expect(frame.style.flex).toBe("0 0 auto");
    expect(frame.style.minWidth).toBe("");
    expect(frame.style.maxWidth).toBe("");
    expect(frame.style.boxSizing).toBe("");
    expect(classes(frame)).toEqual(expect.arrayContaining(["min-w-0", "max-w-full", "box-border"]));
    // Ramka inline nigdy nie dostaje stałych klas ramki BLOKOWEJ.
    expect(classes(frame)).not.toContain("self-stretch");
    expect(classes(frame)).not.toContain("my-0");
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
