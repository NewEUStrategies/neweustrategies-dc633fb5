// Mapowanie typografii widgetu: szablon HW-2 w `styles.css` <-> generator reguł
// per widget (`lib/builder/typographyCss.ts`) <-> dane ramki (`data-wt`, `--wt-*`).
//
// CO TEN PLIK DOWODZI (P2.4, werdykt html-weight:HW-2):
//  1. RÓWNOWAŻNOŚĆ KASKADY. Każda reguła rozmiaru i odstępu, którą generator
//     emitował per widget, ma w szablonie regułę o TYM SAMYM zbiorze selektorów
//     (po zamianie zakresu widgetu na bramkę tokenu) i tej samej deklaracji
//     `!important`. Bramka `[data-wt~=…][data-w-id][data-w-id]` ma tę samą
//     specyficzność co `[data-w-id="id"][data-w-id][data-w-id]`, a reguły idą w
//     kolejności emisji generatora - więc wynik kaskady dla tego samego DOM-u
//     jest ten sam. Zmiana list selektorów w generatorze bez szablonu (albo
//     odwrotnie) oblewa ten test.
//  2. Szablon jest NIEWARSTWOWY i stoi na końcu arkusza (po nim żadna reguła
//     nie może przejąć remisu specyficzności), a jego reguły idą w kolejności
//     emisji generatora (fs, tfs, dfs, g): element łapany przez dwie z nich
//     dostaje tę samą wartość co dawniej.
//  3. Akcja Kinetic Signal Notch (AGENTS.md) nadal wygrywa z szablonem
//     specyficznością - tak jak wygrywała z generatorem.
//  4. Ramka: dane szablonu nie zależą od urządzenia (przełączenie urządzenia nie
//     zmienia HTML-a ramki - zadanie K15 księgi P0.5).
//
// Reguły czytamy jako DANE (`@/test/cssRules`: kontekst at-reguł, selektory,
// deklaracje, specyficzność), nie jako fragmenty tekstu pliku.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Device, WidgetNode, WidgetTypography } from "@/lib/builder/types";
import { buildWidgetTypographyCss } from "@/lib/builder/typographyCss";
import { ChromeWidgetView } from "@/components/builder/organisms/ChromeWidgetView";
import { parseCssRules, specificity, specificityAbove, type CssRule } from "@/test/cssRules";

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

const STYLE_RULES = parseCssRules(readFileSync("src/styles.css", "utf8"));

/** Reguła szablonu HW-2: niewarstwowa, z bramką tokenu `[data-wt~=…]`. */
const isTemplateRule = (rule: CssRule) =>
  rule.context.length === 0 && rule.selectors.some((s) => s.includes("[data-wt~="));
/** Cokolwiek, co czyta dane szablonu (bramki tokenów i reguły zmiennych urządzeń). */
const usesTemplateData = (rule: CssRule) => rule.selectors.some((s) => /\[data-wt[~\]]/.test(s));

interface Rule {
  selectors: string[];
  body: string;
}

/** Reguła do porównań: selektory po normalizacji zakresu, deklaracje bez białych znaków. */
function toRule(rule: CssRule): Rule {
  return {
    selectors: rule.selectors.map(normalizeSelector),
    body: [...rule.declarations]
      .map(([property, value]) => `${property}:${value}`.replace(/\s+/g, "") + ";")
      .join(""),
  };
}

function normalizeSelector(selector: string): string {
  let s = selector.replace(/\s+/g, " ").trim();
  // Białe znaki w nawiasach (prettier łamie listy `:is()`) i wokół kombinatorów.
  s = s
    .replace(/\(\s*/g, "(")
    .replace(/\s*\)/g, ")")
    .replace(/\s*,\s*/g, ",");
  s = s.replace(/\s*([+~>])\s*/g, "$1");
  // `*:not(...)` i `:not(...)` to ten sam selektor.
  s = s.replace(/(^|[\s>+~])\*(?=:)/g, "$1");
  // Zakres widgetu -> wspólny znacznik.
  s = s.replace(/\[data-w-id="[^"]*"\]\[data-w-id\]\[data-w-id\]/g, "S");
  s = s.replace(/\[data-wt~="[a-z]+"\]\[data-w-id\]\[data-w-id\]/g, "S");
  return s;
}

const TEMPLATE: Rule[] = STYLE_RULES.filter(isTemplateRule).map(toRule);

function templateRule(token: string): Rule {
  const body =
    token === "g"
      ? "margin-top:var(--cms-title-description-gap)!important;"
      : `font-size:var(--wt-${token})!important;`;
  const rules = TEMPLATE.filter((r) => r.body === body);
  if (rules.length !== 1) throw new Error(`reguła szablonu dla tokenu ${token}: ${rules.length}`);
  return rules[0];
}

function generatorRules(typography: WidgetTypography, device: Device = "desktop"): Rule[] {
  return parseCssRules(
    buildWidgetTypographyCss("gen-id", typography, device, { specificity: 3 }),
  ).map(toRule);
}

const sorted = (list: string[]) => [...new Set(list)].sort();

describe("szablon HW-2 == generator (selektory i deklaracje)", () => {
  it("rozmiar ogólny: reguły `fs` (teksty + placeholdery) i `tfs` (tytuły)", () => {
    const rules = generatorRules({ fontSize: { desktop: "16px" } });
    // Generator: ogólne, tytuł (klasa), tytuł (fallback), placeholdery.
    expect(rules.map((r) => r.body)).toEqual(Array(4).fill("font-size:16px!important;"));
    const [generic, titleClass, titleFallback, placeholder] = rules;
    expect(sorted(templateRule("fs").selectors)).toEqual(
      sorted([...generic.selectors, ...placeholder.selectors]),
    );
    expect(sorted(templateRule("tfs").selectors)).toEqual(
      sorted([...titleClass.selectors, ...titleFallback.selectors]),
    );
  });

  it("tytuł i opis: reguły `tfs` i `dfs`", () => {
    const rules = generatorRules({
      fontSize: { desktop: "18px" },
      descriptionFontSize: { desktop: "14px" },
    });
    expect(rules.map((r) => r.body)).toEqual([
      "font-size:18px!important;",
      "font-size:18px!important;",
      "font-size:14px!important;",
      "font-size:14px!important;",
    ]);
    expect(sorted(templateRule("tfs").selectors)).toEqual(
      sorted([...rules[0].selectors, ...rules[1].selectors]),
    );
    expect(sorted(templateRule("dfs").selectors)).toEqual(
      sorted([...rules[2].selectors, ...rules[3].selectors]),
    );
  });

  it("odstęp tytuł-opis: reguła `g` na zmiennej ze stylu ramki", () => {
    const rules = generatorRules({ titleDescriptionGapPx: 12 });
    const margins = rules.filter((r) => r.body === "margin-top:12px!important;");
    expect(margins).toHaveLength(2);
    expect(sorted(templateRule("g").selectors)).toEqual(
      sorted(margins.flatMap((r) => r.selectors)),
    );
  });

  it("kolejność reguł szablonu = kolejność emisji generatora (fs, tfs, dfs, g)", () => {
    // Remis specyficzności rozstrzyga kolejność: tytuł łapany przez `fs` i
    // `tfs` ma dostać rozmiar tytułu, jak z bloku generatora.
    const order = ["fs", "tfs", "dfs", "g"].map((token) => TEMPLATE.indexOf(templateRule(token)));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("szablon jest niewarstwowy i ostatni w arkuszu", () => {
    const template = STYLE_RULES.filter(usesTemplateData);
    expect(template.length).toBeGreaterThan(4);
    // Żadna reguła szablonu nie stoi w `@layer`/`@media`/`@supports`/`@container`.
    expect(template.filter((rule) => rule.context.length > 0)).toEqual([]);
    // Po pierwszej regule szablonu nie ma już reguł spoza niego (nic nie
    // przejmie remisu, który dawniej wygrywał późniejszy blok generatora).
    const first = STYLE_RULES.findIndex(usesTemplateData);
    expect(STYLE_RULES.slice(first).filter((rule) => !usesTemplateData(rule))).toEqual([]);
  });
});

/** Selektor akcji, przez który AGENTS.md każe deklarować rozmiar i grubość. */
const KINETIC_ACTION = "[data-w-id][data-w-id][data-w-id] .nes-kinetic-shell .nes-kinetic-action";

describe("Kinetic Signal Notch wygrywa z szablonem (AGENTS.md)", () => {
  it("reguła akcji ma wyższą specyficzność niż każdy selektor szablonu, który ją łapie", () => {
    document.body.innerHTML = `
      <div data-builder-renderer data-device="desktop">
        <div data-w-id="sl" data-wt="fs tfs dfs g">
          <div class="nes-kinetic-shell">
            <div class="nes-kinetic-row"><span data-title-root>Etykieta</span></div>
            <a class="nes-kinetic-action" data-description-root data-typography-exempt href="#">
              <span data-typography-exempt>więcej</span>
            </a>
          </div>
        </div>
      </div>`;
    const action = document.querySelector(".nes-kinetic-action")!;
    const inner = action.querySelector("span")!;
    // Reguła akcji: niewarstwowa (jak szablon), rozmiar z `!important`.
    const kinetic = STYLE_RULES.find(
      (rule) =>
        rule.context.length === 0 &&
        rule.selectors.includes(KINETIC_ACTION) &&
        rule.declarations.get("font-size")?.endsWith("!important"),
    );
    expect(kinetic).toBeDefined();
    let matched = 0;
    for (const node of [action, inner]) {
      const own = kinetic!.selectors.filter((s) => node.matches(s));
      expect(own.length, node.outerHTML).toBeGreaterThan(0);
      const winner = specificity(own[0]);
      for (const rule of STYLE_RULES.filter(isTemplateRule)) {
        if (!rule.declarations.has("font-size")) continue;
        for (const selector of rule.selectors) {
          if (selector.includes("::") || !node.matches(selector)) continue;
          matched++;
          expect(specificityAbove(winner, specificity(selector)), selector).toBe(true);
        }
      }
    }
    // Kontrapunkt: atrybut opisu akcji naprawdę łapie reguła szablonu `dfs`.
    expect(matched).toBeGreaterThan(0);
  });
});

function frameMarkup(device: Device, typography: WidgetTypography): string {
  const node: WidgetNode = {
    id: "map-frame",
    kind: "widget",
    type: "heading",
    content: { text_pl: "Nagłówek", subtitle_pl: "Opis" },
    style: { typography },
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <ChromeWidgetView node={node} lang="pl" device={device} />
    </QueryClientProvider>,
  );
}

describe("ramka - dane szablonu niezależne od urządzenia", () => {
  it("rozmiary per urządzenie: ten sam HTML ramki dla desktopu, tabletu i telefonu", () => {
    const typography = {
      fontSize: { desktop: "28px", tablet: "24px", mobile: "20px" },
      descriptionFontSize: { desktop: "15px", mobile: "13px" },
      titleDescriptionGapPx: 6,
    };
    const desktop = frameMarkup("desktop", typography);
    expect(frameMarkup("tablet", typography)).toBe(desktop);
    expect(frameMarkup("mobile", typography)).toBe(desktop);
    expect(desktop).toContain('data-wt="tfs dfs g"');
    expect(desktop).toContain("--wt-tfs-t:24px");
    expect(desktop).toContain("--wt-dfs-m:13px");
    expect(desktop).not.toContain("<style");
  });

  it("właściwość spoza szablonu: jeden blok generatora ze skrótem danych", () => {
    const html = frameMarkup("desktop", { fontSize: { desktop: "18px" }, textAlign: "center" });
    expect(html).toMatch(/<style data-wt-css="map-frame" data-css-hash="[a-z0-9]+">/);
    expect(html).toContain("text-align:center !important");
    expect(html).not.toContain("font-size:18px");
    // Bez rozmiarów generatora blok nie zależy od urządzenia.
    expect(frameMarkup("mobile", { fontSize: { desktop: "18px" }, textAlign: "center" })).toBe(
      html,
    );
  });

  it("rozmiar spoza białej listy: blok generatora per urządzenie, bez tokenów rozmiaru", () => {
    const typography = { fontSize: { desktop: "clamp(1rem, 3vw, 2rem)", mobile: "18px" } };
    const desktop = frameMarkup("desktop", typography);
    const mobile = frameMarkup("mobile", typography);
    expect(desktop).not.toContain("data-wt=");
    expect(desktop).toContain("font-size:clamp(1rem, 3vw, 2rem) !important");
    expect(mobile).toContain("font-size:18px !important");
  });
});
