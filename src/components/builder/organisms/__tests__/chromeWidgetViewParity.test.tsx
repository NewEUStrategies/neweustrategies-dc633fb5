// F17: `ChromeWidgetView` musi dawać DOKŁADNIE TEN SAM HTML SSR co `WidgetView`
// dla każdego typu widgetu, którego używa nagłówek, stopka i menu mobilne.
//
// DLACZEGO TO JEST BRAMKA, A NIE „miły test”
// Nagłówek i stopka renderują się na KAŻDEJ stronie i są pierwszą rzeczą, którą
// widzi czytelnik. Gdyby lżejszy dyspozytor chrome rysował choćby o jeden
// `<div>` mniej, pierwsza klatka miałaby inną wysokość niż drzewo po
// hydratacji - czyli CLS dokładnie tam, gdzie kosztuje najwięcej (audyt CWV:
// 0,66-0,75 przed naprawą z 2026-09-06, 0,003 po niej).
//
// LISTA TYPÓW NIE JEST PISANA Z RĘKI: bierzemy ją z `defaultDocFor("header")`,
// `("footer")` i `("menu")`, czyli z dokumentów, które renderują się jako żywy
// fallback chrome. Dołożenie nowego typu do domyślnego chrome automatycznie
// rozszerza tę bramkę.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultDocFor } from "@/lib/builder/chromeDefaults";
import type { BuilderDocument, WidgetNode, WidgetType } from "@/lib/builder/types";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import { ChromeWidgetView } from "@/components/builder/organisms/ChromeWidgetView";

// Ten sam zabieg, co w `typographyMapping.test.tsx`: rejestr leniwy zamieniamy
// na lustro eager, bo `renderToStaticMarkup` nie umie poczekać na `React.lazy`.
// Lustro jest kontraktowo identyczne z rejestrem
// (`src/lib/builder/ci/__tests__/eagerWidgetChunks.test.ts`).
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit"]) b[m] = () => b;
  b.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
  return { supabase: { from: () => b, rpc: async () => ({ data: [], error: null }) } };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

/** Wszystkie węzły widgetów z dokumentu chrome, w kolejności dokumentu. */
function widgetsOf(doc: BuilderDocument): WidgetNode[] {
  const out: WidgetNode[] = [];
  for (const section of doc.sections) {
    for (const child of section.children) {
      const columns = child.kind === "inner-section" ? child.columns : [child];
      for (const col of columns) {
        for (const widget of col.children) {
          if (widget.kind === "widget") out.push(widget);
        }
      }
    }
  }
  return out;
}

const CHROME_WIDGETS: WidgetNode[] = [
  ...widgetsOf(defaultDocFor("header")),
  ...widgetsOf(defaultDocFor("footer")),
  ...widgetsOf(defaultDocFor("menu")),
];

/** Dodatkowe typy chrome, których domyślne dokumenty nie zawierają, a które
 *  redakcja realnie wstawia do nagłówka i stopki. */
const EXTRA_CHROME_TYPES: WidgetType[] = [
  "heading",
  "text",
  "button",
  "menu",
  "icon",
  "cta",
  "divider",
  "spacer",
];

function markup(Component: typeof WidgetView | typeof ChromeWidgetView, node: WidgetNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <Component node={node} lang="pl" device="desktop" />
    </QueryClientProvider>,
  );
}

describe("ChromeWidgetView == WidgetView dla typów chrome", () => {
  it("domyślne dokumenty chrome nie są puste (inaczej bramka mierzy nic)", () => {
    expect(CHROME_WIDGETS.length).toBeGreaterThan(20);
  });

  for (const node of CHROME_WIDGETS) {
    it(`${node.type} (${node.id}) renderuje identyczny HTML SSR`, () => {
      expect(markup(ChromeWidgetView, node)).toBe(markup(WidgetView, node));
    });
  }

  for (const type of EXTRA_CHROME_TYPES) {
    it(`${type} (poza domyślnym dokumentem) renderuje identyczny HTML SSR`, () => {
      const node: WidgetNode = {
        id: `chrome-parity-${type}`,
        kind: "widget",
        type,
        content: {
          text_pl: "Tytuł",
          text_en: "Title",
          html_pl: "<p>Treść</p>",
          html_en: "<p>Body</p>",
          label_pl: "Etykieta",
          label_en: "Label",
          title_pl: "CTA",
          cta_pl: "Kliknij",
          href: "/programs",
          iconName: "Star",
          menu_key: "main",
        },
      };
      expect(markup(ChromeWidgetView, node)).toBe(markup(WidgetView, node));
    });
  }

  it("styl ramki i typografia widgetu też są identyczne", () => {
    const node: WidgetNode = {
      id: "chrome-parity-style",
      kind: "widget",
      type: "heading",
      content: { text_pl: "Nagłówek", tag: "h2" },
      style: {
        textColor: "#112233",
        typography: { fontSize: { desktop: "22px" } },
      },
      advanced: { cssClass: "moja-klasa", htmlId: "moj-id" },
    };
    const chrome = markup(ChromeWidgetView, node);
    expect(chrome).toBe(markup(WidgetView, node));
    // Kontrapunkt: gdyby ramka nie jechała, test wyżej porównywałby dwa pustostany.
    expect(chrome).toContain('data-w-id="chrome-parity-style"');
    expect(chrome).toContain("22px !important");
  });

  it("nieznany typ NIE jest renderowany w chrome na sztywno - idzie przez granicę leniwą", async () => {
    // `React.lazy` nie rozwiąże się w `renderToStaticMarkup`, więc sprawdzamy
    // kontrakt na poziomie modułu: pełny dyspozytor wchodzi tu WYŁĄCZNIE
    // dynamicznym `import()`, bo tylko taka krawędź wypada z chunku wejściowego.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/builder/organisms/ChromeWidgetView.tsx", "utf8");
    expect(src).toMatch(/import\(\s*"\.\/WidgetView"\s*\)/);
    expect(src).not.toMatch(/^import\s+[^;]*from\s+"\.\/WidgetView";/m);
  });
});
