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
//  2. Szablon jest NIEWARSTWOWY i stoi na końcu arkusza.
//  3. Akcja Kinetic Signal Notch (AGENTS.md) nadal wygrywa z szablonem
//     specyficznością - tak jak wygrywała z generatorem.
//  4. Ramka: dane szablonu nie zależą od urządzenia (przełączenie urządzenia nie
//     zmienia HTML-a ramki - zadanie K15 księgi P0.5).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Device, WidgetNode, WidgetTypography } from "@/lib/builder/types";
import { buildWidgetTypographyCss } from "@/lib/builder/typographyCss";
import { ChromeWidgetView } from "@/components/builder/organisms/ChromeWidgetView";

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

const STYLES = readFileSync("src/styles.css", "utf8");
const TEMPLATE_MARKER = "SZABLON TYPOGRAFII WIDGETU";

interface Rule {
  selectors: string[];
  body: string;
}

/** Parser płaskich reguł (szablon nie ma zagnieżdżeń); komentarze wycięte. */
function parseRules(css: string): Rule[] {
  const out: Rule[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const chunk of clean.split("}")) {
    const [rawSelector, rawBody] = chunk.split("{");
    if (!rawBody) continue;
    out.push({
      selectors: splitSelectors(rawSelector).map(normalizeSelector),
      body: rawBody.replace(/\s+/g, ""),
    });
  }
  return out;
}

/** Przecinki poza nawiasami rozdzielają selektory. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
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

function templateRules(): Rule[] {
  const start = STYLES.indexOf(TEMPLATE_MARKER);
  expect(start).toBeGreaterThan(0);
  return parseRules(STYLES.slice(STYLES.lastIndexOf("/*", start)));
}

function templateRule(token: string): Rule {
  const body =
    token === "g"
      ? "margin-top:var(--cms-title-description-gap)!important;"
      : `font-size:var(--wt-${token})!important;`;
  const rules = templateRules().filter((r) => r.body === body);
  if (rules.length !== 1) throw new Error(`reguła szablonu dla tokenu ${token}: ${rules.length}`);
  return rules[0];
}

function generatorRules(typography: WidgetTypography, device: Device = "desktop"): Rule[] {
  return parseRules(buildWidgetTypographyCss("gen-id", typography, device, { specificity: 3 }));
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
    expect(templateRule("fs").body).toBe("font-size:var(--wt-fs)!important;");
    expect(templateRule("tfs").body).toBe("font-size:var(--wt-tfs)!important;");
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
    expect(templateRule("dfs").body).toBe("font-size:var(--wt-dfs)!important;");
  });

  it("odstęp tytuł-opis: reguła `g` na zmiennej ze stylu ramki", () => {
    const rules = generatorRules({ titleDescriptionGapPx: 12 });
    const margins = rules.filter((r) => r.body === "margin-top:12px!important;");
    expect(margins).toHaveLength(2);
    expect(sorted(templateRule("g").selectors)).toEqual(
      sorted(margins.flatMap((r) => r.selectors)),
    );
    expect(templateRule("g").body).toBe("margin-top:var(--cms-title-description-gap)!important;");
  });

  it("kolejność szablonu = kolejność emisji generatora (fs, tfs, dfs, g)", () => {
    const order = ["fs", "tfs", "dfs", "g"].map((token) =>
      STYLES.indexOf(`[data-wt~="${token}"][data-w-id][data-w-id]`),
    );
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("szablon jest niewarstwowy i ostatni w arkuszu", () => {
    const tail = STYLES.slice(STYLES.lastIndexOf("/*", STYLES.indexOf(TEMPLATE_MARKER))).replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(tail).not.toMatch(/@layer|@media|@supports|@container/);
    // Po szablonie nie ma już żadnej reguły spoza niego.
    const lastRule = templateRules().at(-1);
    expect(lastRule?.body).toBe("margin-top:var(--cms-title-description-gap)!important;");
    expect(STYLES.trimEnd().endsWith("}")).toBe(true);
  });
});

/** Specyficzność [a, b, c]; `:is()`/`:not()` biorą maksimum argumentów. */
function specificity(selector: string): [number, number, number] {
  let a = 0;
  let b = 0;
  let c = 0;
  let rest = selector;
  for (;;) {
    const m = /:(is|not)\(/.exec(rest);
    if (!m) break;
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth > 0 && i < rest.length) {
      if (rest[i] === "(") depth++;
      if (rest[i] === ")") depth--;
      i++;
    }
    const inner = rest.slice(m.index + m[0].length, i - 1);
    const best = splitSelectors(inner)
      .map((s) => specificity(s.trim()))
      .sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0] ?? [0, 0, 0];
    a += best[0];
    b += best[1];
    c += best[2];
    rest = rest.slice(0, m.index) + " " + rest.slice(i);
  }
  a += (rest.match(/#[\w-]+/g) ?? []).length;
  b += (rest.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  c += (rest.match(/(^|[\s>+~])[a-z][\w-]*|::[\w-]+/gi) ?? []).length;
  return [a, b, c];
}

const above = (x: number[], y: number[]) =>
  x[0] !== y[0] ? x[0] > y[0] : x[1] !== y[1] ? x[1] > y[1] : x[2] > y[2];

describe("Kinetic Signal Notch wygrywa z szablonem (AGENTS.md)", () => {
  it("reguła akcji ma wyższą specyficzność niż każdy selektor szablonu, który ją łapie", () => {
    document.body.innerHTML = `
      <div data-builder-renderer data-device="desktop">
        <div data-w-id="sl" data-wt="tfs dfs">
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
    const kinetic = specificity(
      "[data-w-id][data-w-id][data-w-id] .nes-kinetic-shell .nes-kinetic-action",
    );
    const kineticSpan = specificity(
      "[data-w-id][data-w-id][data-w-id] .nes-kinetic-shell .nes-kinetic-action span",
    );
    expect(STYLES).toContain(
      "[data-w-id][data-w-id][data-w-id] .nes-kinetic-shell .nes-kinetic-action,",
    );
    let matched = 0;
    // Selektory szablonu z bramką zamienioną na sam atrybut (ten sam wkład w
    // specyficzność: trzy atrybuty), żeby `matches` widział każdy token.
    const fullSelectors = templateRules()
      .filter((r) => r.body.startsWith("font-size:"))
      .flatMap((r) => r.selectors.map((s) => s.replace(/^S/, "[data-wt][data-w-id][data-w-id]")));
    for (const selector of fullSelectors) {
      if (selector.includes("::")) continue;
      for (const [node, winner] of [
        [action, kinetic],
        [inner, kineticSpan],
      ] as const) {
        if (!node.matches(selector)) continue;
        matched++;
        expect(above(winner, specificity(selector)), selector).toBe(true);
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
