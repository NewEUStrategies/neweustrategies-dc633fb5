// PUBLICZNY RENDERER: znacznik `data-search-overflow` już w HTML-u SSR.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// Pole wyszukiwarki w nagłówku nie może być przycinane przez opakowania
// buildera z `overflow: hidden` - także PRZED hydratacją, kiedy efekt
// w `SearchButtonWidget` jeszcze nie oznaczył przodków. Robiła to reguła
// `:has(.builder-search-widget)` w `styles.css`, zakazana bramką
// `noHasSelectors`. Test czyta HTML z `renderToString` (to, co przeglądarka
// maluje w pierwszej klatce) i sprawdza niezmiennik dawnej reguły: KAŻDY
// przodek ramki widgetu, który przycina (klasa `overflow-hidden` albo inline
// `overflow: hidden`), niesie znacznik. Druga strona: kolumny i sekcje bez
// wyszukiwarki znacznika nie dostają - clip zostaje tam, gdzie chroni układ.
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/i18nReal";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import type { BuilderDocument } from "@/lib/builder/types";
import { BuilderRenderer } from "../BuilderRenderer";
import {
  column,
  doc,
  hideOn,
  innerSection,
  section,
  stubObservers,
  tabsConfig,
  widget,
} from "./builderRendererFixtures";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

let observers: ReturnType<typeof stubObservers>;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  observers = stubObservers();
  __resetBuilderDebugForTests();
});

afterEach(() => {
  host?.remove();
  host = null;
  observers.restore();
  __resetBuilderDebugForTests();
});

function ssr(document: BuilderDocument): HTMLDivElement {
  const queryClient = new QueryClient();
  const html = renderToString(
    <QueryClientProvider client={queryClient}>
      <BuilderRenderer doc={document} lang="pl" chrome />
    </QueryClientProvider>,
  );
  queryClient.clear();
  host = window.document.createElement("div");
  host.innerHTML = html;
  window.document.body.append(host);
  return host;
}

function clips(el: HTMLElement): boolean {
  return el.classList.contains("overflow-hidden") || el.style.overflow === "hidden";
}

/** Przodkowie `el` aż do korzenia renderu, którzy przycinają, a nie mają znacznika. */
function unmarkedClippingAncestors(el: Element, root: Element): string[] {
  const out: string[] = [];
  let cur = el.parentElement;
  while (cur && cur !== root) {
    if (clips(cur) && !cur.hasAttribute("data-search-overflow")) {
      out.push(cur.outerHTML.slice(0, 120));
    }
    cur = cur.parentElement;
  }
  return out;
}

const headerDoc = () =>
  doc([
    section("hdr", [
      column("logo", [widget("w-logo", "heading")]),
      column("search", [widget("w-search", "search-button", { content: {} })]),
    ]),
  ]);

describe("znacznik z SSR nad widgetem wyszukiwarki", () => {
  it("żaden przodek widgetu nie przycina pola w pierwszej klatce", () => {
    const root = ssr(headerDoc());
    const frame = root.querySelector('[data-w-id="w-search"]');
    expect(frame).not.toBeNull();
    // Ramka sama przycina (inline `overflow: hidden`) - też musi nieść znacznik.
    expect(frame!.hasAttribute("data-search-overflow")).toBe(true);
    expect(unmarkedClippingAncestors(frame!, root)).toEqual([]);
  });

  it("sekcja, jej kontener, wiersz kolumn i slot kolumny z wyszukiwarką", () => {
    const root = ssr(headerDoc());
    const sec = root.querySelector('[data-sec-id="hdr"]')!;
    expect(sec.hasAttribute("data-search-overflow")).toBe(true);
    expect(sec.querySelector("[data-columns-row]")!.hasAttribute("data-search-overflow")).toBe(
      true,
    );
    expect(root.querySelector('[data-col-id="search"]')!.hasAttribute("data-search-overflow")).toBe(
      true,
    );
  });

  it("sąsiednia kolumna bez wyszukiwarki i jej widget zachowują clip", () => {
    const root = ssr(headerDoc());
    const logoSlot = root.querySelector<HTMLElement>('[data-col-id="logo"]')!;
    expect(logoSlot.hasAttribute("data-search-overflow")).toBe(false);
    expect(clips(logoSlot)).toBe(true);
    expect(root.querySelector('[data-w-id="w-logo"]')!.hasAttribute("data-search-overflow")).toBe(
      false,
    );
  });

  it("dokument bez wyszukiwarki nie ma znacznika nigdzie", () => {
    const root = ssr(
      doc([section("body", [column("a", [widget("w-a", "heading")]), column("b", [])])]),
    );
    expect(root.querySelector("[data-search-overflow]")).toBeNull();
  });

  it("wyszukiwarka w sekcji zagnieżdżonej - oznaczony cały łańcuch, także slot zewnętrzny", () => {
    const root = ssr(
      doc([
        section("hdr", [
          column("left", [widget("w-logo", "heading")]),
          innerSection("nested", [
            column("menu", [widget("w-menu", "heading")]),
            column("find", [widget("w-search", "search-button", { content: {} })]),
          ]),
        ]),
      ]),
    );
    const frame = root.querySelector('[data-w-id="w-search"]');
    expect(frame).not.toBeNull();
    expect(unmarkedClippingAncestors(frame!, root)).toEqual([]);
    expect(root.querySelector('[data-col-id="nested"]')!.hasAttribute("data-search-overflow")).toBe(
      true,
    );
    expect(root.querySelector('[data-col-id="left"]')!.hasAttribute("data-search-overflow")).toBe(
      false,
    );
    // Kolumna menu wewnątrz sekcji zagnieżdżonej nie zawiera wyszukiwarki.
    const menuFrame = root.querySelector('[data-w-id="w-menu"]')!;
    const menuSlot = menuFrame.closest("[data-column-slot]")!;
    expect(menuSlot.hasAttribute("data-search-overflow")).toBe(false);
  });
});

// Dawna reguła `:has()` pytała DOM - widget, którego renderer nie wyrenderuje,
// nie zdejmował nikomu clipa. Znacznik liczony z danych musi odsiewać tak samo.
describe("wyszukiwarka, która się nie renderuje, nie zdejmuje clipa", () => {
  it("ukryta na desktopie (hideOn) - SSR renderuje desktop, więc bez znacznika", () => {
    const root = ssr(
      doc([
        section("hdr", [
          column("logo", [widget("w-logo", "heading")]),
          column("search", [
            widget("w-search", "search-button", {
              content: {},
              advanced: hideOn({ desktop: true }),
            }),
          ]),
        ]),
      ]),
    );
    expect(root.querySelector('[data-w-id="w-search"]')).toBeNull();
    expect(root.querySelector("[data-search-overflow]")).toBeNull();
  });

  it("w kolumnie nieaktywnej zakładki - sekcja i wiersz zachowują clip", () => {
    const root = ssr(
      doc([
        section(
          "tabbed",
          [
            column("k-t1", [widget("w-t1", "heading")], { tabId: "t1" }),
            column("k-t2", [widget("w-search", "search-button", { content: {} })], {
              tabId: "t2",
            }),
          ],
          { tabs: tabsConfig([{ id: "t1" }, { id: "t2" }]) },
        ),
      ]),
    );
    expect(root.querySelector('[data-w-id="w-t1"]')).not.toBeNull();
    expect(root.querySelector('[data-w-id="w-search"]')).toBeNull();
    expect(root.querySelector("[data-search-overflow]")).toBeNull();
  });
});
