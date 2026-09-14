// Test bramki „każdy `dangerouslySetInnerHTML` przez zaufany sanitizer".
//
// KAŻDY PRZYPADEK ODWZOROWUJE REALNY KSZTAŁT Z REPOZYTORIUM - numer pliku
// i linii stoi w komentarzu. Test syntetyczny, który nie przypomina kodu
// produkcyjnego, dowiódłby tylko, że wyrażenie regularne działa na wymyślonym
// wejściu, a bramka i tak zgubiłaby sinki rozciągnięte na 70 linii.
import { describe, expect, it } from "vitest";
import {
  classifySink,
  dangerousHtmlFailed,
  extractHtmlSinks,
  isScannable,
  renderDangerousHtmlReport,
  resolveExpression,
  scanDangerousHtml,
  sinkSymbol,
  type DangerousHtmlAllowEntry,
  type ScannedSource,
} from "../dangerousHtml";

function source(file: string, ...lines: string[]): ScannedSource {
  return { file, source: lines.join("\n") };
}

const NONE: readonly DangerousHtmlAllowEntry[] = [];

/** Pojedynczy plik -> raport, żeby przypadki czytały się jednym zdaniem. */
function scan(src: ScannedSource, allow: readonly DangerousHtmlAllowEntry[] = NONE) {
  return scanDangerousHtml([src], allow);
}

describe("isScannable", () => {
  it("bierze tylko produkcyjne .ts/.tsx i pomija moduł samej bramki", () => {
    expect(isScannable("src/components/blocks/renderer/atoms.tsx")).toBe(true);
    expect(isScannable("src/lib/ci/sourceScan.ts")).toBe(true);
    expect(isScannable("src/lib/ci/dangerousHtml.ts")).toBe(false);
    expect(isScannable("src/lib/ci/__tests__/dangerousHtml.test.ts")).toBe(false);
    expect(isScannable("src/components/foo.test.tsx")).toBe(false);
    expect(isScannable("src/styles.css")).toBe(false);
  });
});

describe("sanitizer pasujący do rodzaju sinka", () => {
  it("1. `sanitizeHtml(x)` z importu `@/lib/sanitize` przechodzi", () => {
    const src = source(
      "src/components/Foo.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export function Foo({ html }: { html: string }) {",
      "  return <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;",
      "}",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.sanitized).toBe(1);
  });

  it("4. `<style>` przyjmuje `hardenStyleCss`, a `sanitizeHtml` OBLEWA (FORBID_TAGS: style)", () => {
    const dobry = source(
      "src/components/Ok.tsx",
      'import { hardenStyleCss } from "@/lib/sanitizePure";',
      "export const Ok = ({ css }: { css: string }) => (",
      "  <style dangerouslySetInnerHTML={{ __html: hardenStyleCss(css) }} />",
      ");",
    );
    expect(scan(dobry).violations).toEqual([]);

    const zly = source(
      "src/components/Zly.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export const Zly = ({ css }: { css: string }) => (",
      "  <style dangerouslySetInnerHTML={{ __html: sanitizeHtml(css) }} />",
      ");",
    );
    const report = scan(zly);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].sink).toBe("style");
    expect(report.violations[0].remedy).toContain("hardenStyleCss");
  });

  it("5. JSON-LD: `JSON.stringify` OBLEWA, `safeJsonLd` przechodzi", () => {
    const zly = source(
      "src/routes/zly.tsx",
      "export const Zly = ({ graf }: { graf: unknown }) => (",
      '  <script type="application/ld+json"',
      "    dangerouslySetInnerHTML={{ __html: JSON.stringify(graf) }} />",
      ");",
    );
    const r1 = scan(zly);
    expect(r1.violations).toHaveLength(1);
    expect(r1.violations[0].sink).toBe("jsonld");

    const dobry = source(
      "src/routes/dobry.tsx",
      'import { safeJsonLd } from "@/lib/seo/jsonld";',
      "export const Dobry = ({ graf }: { graf: unknown }) => (",
      '  <script type="application/ld+json"',
      "    dangerouslySetInnerHTML={{ __html: safeJsonLd(graf) }} />",
      ");",
    );
    expect(scan(dobry).violations).toEqual([]);
  });

  it("13. lokalna funkcja o nazwie `sanitizeHtml` bez importu NICZEGO nie dowodzi", () => {
    const src = source(
      "src/components/Podszywacz.tsx",
      "const sanitizeHtml = (s: string) => s;",
      "export const X = ({ html }: { html: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />",
      ");",
    );
    const report = scan(src);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].remedy).toContain("nie jest tu zaimportowane");
  });

  it("14. dekorator zdejmujemy i oceniamy argument", () => {
    const dobry = source(
      "src/components/Dekor.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      'import { decorateCmsStatusIcons } from "@/lib/content/cmsInlineIcons";',
      "export const X = ({ raw }: { raw: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __html: decorateCmsStatusIcons(sanitizeHtml(raw)) }} />",
      ");",
    );
    expect(scan(dobry).violations).toEqual([]);

    const zly = source(
      "src/components/DekorZly.tsx",
      'import { decorateCmsStatusIcons } from "@/lib/content/cmsInlineIcons";',
      "export const X = ({ raw }: { raw: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __html: decorateCmsStatusIcons(raw) }} />",
      ");",
    );
    expect(scan(zly).violations).toHaveLength(1);
  });
});

describe("rozwijanie wartości", () => {
  it('6. fallback `?? str(block.data, "html")` OBLEWA (kształt atoms.tsx SPRZED poprawki)', () => {
    const src = source(
      "src/components/blocks/renderer/atoms.tsx",
      'import { decorateCmsStatusIcons } from "@/lib/content/cmsInlineIcons";',
      'import { sanitize, str } from "./data";',
      "export const renderParagraph = ({ block, fnHtml, cls }: Ctx) => {",
      '  const safe = decorateCmsStatusIcons(fnHtml.get(block.id) ?? str(block.data, "html"));',
      "  return <div className={cls} dangerouslySetInnerHTML={{ __html: safe }} />;",
      "};",
    );
    const report = scan(src);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].sink).toBe("html");
  });

  it("7. ten sam fallback ZE `sanitize(...)` przechodzi (kształt molecules.tsx:633)", () => {
    const src = source(
      "src/components/blocks/renderer/atoms.tsx",
      'import { decorateCmsStatusIcons } from "@/lib/content/cmsInlineIcons";',
      'import { sanitize, str } from "./data";',
      "export const renderParagraph = ({ block, fnHtml, cls }: Ctx) => {",
      '  const safe = decorateCmsStatusIcons(fnHtml.get(block.id) ?? sanitize(str(block.data, "html")));',
      "  return <div className={cls} dangerouslySetInnerHTML={{ __html: safe }} />;",
      "};",
    );
    expect(scan(src).violations).toEqual([]);
  });

  it('8. łańcuch TRZYSTOPNIOWY (atoms.tsx:182-186 -> :203) - obalał wersję „jeden poziom"', () => {
    const src = source(
      "src/components/blocks/renderer/atoms.tsx",
      'import { decorateCmsStatusIcons } from "@/lib/content/cmsInlineIcons";',
      "export const renderQuote = ({ block, fnHtml }: Ctx) => {",
      "  const textFnRaw = fnHtml.get(`${block.id}:text`);",
      "  const textFn = textFnRaw === undefined ? undefined : decorateCmsStatusIcons(textFnRaw);",
      "  return textFn !== undefined ? (",
      '    <p className="cms-quote-text" dangerouslySetInnerHTML={{ __html: textFn }} />',
      "  ) : null;",
      "};",
    );
    expect(scan(src).violations).toEqual([]);
  });

  it("9. identyfikator WEWNĄTRZ wstawki `${…}` (kształt atoms.tsx:211)", () => {
    const src = source(
      "src/components/blocks/renderer/atoms.tsx",
      'import { decorateCmsStatusIcons } from "@/lib/content/cmsInlineIcons";',
      "export const renderQuote = ({ block, fnHtml }: Ctx) => {",
      "  const citeFnRaw = fnHtml.get(`${block.id}:cite`);",
      "  const citeFn = citeFnRaw === undefined ? undefined : decorateCmsStatusIcons(citeFnRaw);",
      "  return <cite dangerouslySetInnerHTML={{ __html: `- ${citeFn}` }} />;",
      "};",
    );
    expect(scan(src).violations).toEqual([]);
  });

  it("15. `useMemo(() => sanitizeHtml(html), [html])` (kształt Html.tsx:14,27)", () => {
    const src = source(
      "src/components/admin/blocks/edit/Html.tsx",
      'import { useMemo } from "react";',
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export function HtmlBlock({ html }: { html: string }) {",
      "  const safe = useMemo(() => sanitizeHtml(html), [html]);",
      "  return <div dangerouslySetInnerHTML={{ __html: safe }} />;",
      "}",
    );
    expect(scan(src).violations).toEqual([]);
  });

  it("nie przekracza granicy modułu - stała importowana wymaga wpisu w allowliście", () => {
    const src = source(
      "src/routes/__root.tsx",
      'import { THEME_INIT_SCRIPT } from "@/lib/theme/themeInitScript";',
      "export const Root = () => (",
      "  <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />",
      ");",
    );
    expect(scan(src).violations).toHaveLength(1);

    const allow: DangerousHtmlAllowEntry[] = [
      {
        file: "src/routes/__root.tsx",
        sink: "script",
        symbol: "THEME_INIT_SCRIPT",
        reason: "Musi wykonać się przed pierwszym malowaniem - to ochrona przed FOUC.",
      },
    ];
    const report = scan(src, allow);
    expect(report.violations).toEqual([]);
    expect(report.stats.allowlisted).toBe(1);
    expect(report.staleAllowlist).toEqual([]);
  });
});

describe("literały", () => {
  it('3. literał szablonowy na kilkunastu liniach (kształt NewsTickerView.tsx:295) jest „literal"', () => {
    const src = source(
      "src/components/builder/organisms/widget-view/NewsTickerView.tsx",
      'import { useId } from "react";',
      "export function Ticker() {",
      '  const animName = `news-ticker-vertical-${useId().replace(/:/g, "")}`;',
      "  return (",
      "    <style",
      "      dangerouslySetInnerHTML={{",
      "        __html: `",
      "          @keyframes ${animName} {",
      "            0% { transform: translate3d(0,0,0); }",
      "            100% { transform: translate3d(-50%,0,0); }",
      "          }",
      "          @media (prefers-reduced-motion: reduce) {",
      '            [data-news-ticker="horizontal"] { animation: none !important; }',
      "          }",
      "        `,",
      "      }}",
      "    />",
      "  );",
      "}",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.literal).toBe(1);
    expect(report.stats.totalSinks).toBe(1);
  });

  it("stała modułowa SCREAMING_SNAKE zdefiniowana w tym samym pliku (TMR_TITLE_CSS)", () => {
    const src = source(
      "src/components/builder/organisms/widget-view/TailoredMustReadsView.tsx",
      "const TMR_TITLE_CSS = `",
      "[data-widget] .tmr-title-clamp { display: block; overflow: hidden; }",
      "`;",
      "export const View = () => <style dangerouslySetInnerHTML={{ __html: TMR_TITLE_CSS }} />;",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.literal).toBe(1);
  });

  it("wstawka z bazy w `<style>` OBLEWA - to jest przypadek `red}</style><script>`", () => {
    const src = source(
      "src/components/Kolor.tsx",
      "export const Kolor = ({ color }: { color: string }) => (",
      "  <style dangerouslySetInnerHTML={{ __html: `.x{color:${color};}` }} />",
      ");",
    );
    expect(scan(src).violations).toHaveLength(1);
  });
});

// Bramka, którą omija się jednym `.concat(...)`, daje FAŁSZYWE poczucie
// pokrycia: raport pokazuje „literal", a do sinka leci dowolny HTML. Dlatego
// literał liczy się TYLKO wtedy, gdy jest CAŁYM wyrażeniem.
describe("23. prefiks literału NIE JEST literałem", () => {
  function sink(wyrazenie: string) {
    return scan(
      source(
        "src/components/Prefiks.tsx",
        "export const Prefiks = ({ userHtml, n }: Props) => (",
        `  <div dangerouslySetInnerHTML={{ __html: ${wyrazenie} }} />`,
        ");",
      ),
    );
  }

  it('`"prefix".concat(userHtml)` OBLEWA - zacytowany token to nie całość', () => {
    const report = sink('"prefix".concat(userHtml)');
    expect(report.stats.literal).toBe(0);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].expression).toBe('"prefix".concat(userHtml)');
  });

  it('`"a" + userHtml` OBLEWA nadal - konkatenacja rozbija się przed literałem', () => {
    const report = sink('"a" + userHtml');
    expect(report.stats.literal).toBe(0);
    expect(report.violations).toHaveLength(1);
  });

  it("literał z zaescape'owanym cudzysłowem W ŚRODKU zostaje literałem", () => {
    const report = sink('"<b class=\\"x\\">•</b>"');
    expect(report.violations).toEqual([]);
    expect(report.stats.literal).toBe(1);
  });

  it("backtick z doklejonym `.repeat(n)` OBLEWA - koniec literału to nie koniec wyrażenia", () => {
    const report = sink("`<hr/>`.repeat(n)");
    expect(report.stats.literal).toBe(0);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].expression).toBe("`<hr/>`.repeat(n)");
  });

  it("`` `safe`.concat(userHtml) `` OBLEWA - łańcuch metod na szablonie też wnosi obcą treść", () => {
    expect(sink("`safe`.concat(userHtml)").violations).toHaveLength(1);
  });

  it("liczba z doklejonym łańcuchem OBLEWA, goła liczba zostaje literałem", () => {
    expect(sink("5..toString().concat(userHtml)").violations).toHaveLength(1);
    const goly = sink("0");
    expect(goly.violations).toEqual([]);
    expect(goly.stats.literal).toBe(1);
  });
});

describe("maskowanie komentarzy", () => {
  it("10. plik wspominający atrybut WYŁĄCZNIE w komentarzu ma zero sinków", () => {
    const src = source(
      "src/lib/builder/widgetTextFields.ts",
      "// Pola tekstowe widgetów renderowane są przez dangerouslySetInnerHTML,",
      "// więc ich treść musi przejść przez sanitizer.",
      'export const WIDGET_TEXT_FIELDS = ["html"] as const;',
    );
    expect(extractHtmlSinks(src)).toEqual([]);
    expect(scan(src).stats.totalSinks).toBe(0);
  });

  it("11. komentarz cytujący CAŁY atrybut nie wywraca bramki na jej własnej dokumentacji", () => {
    const src = source(
      "src/components/search/SearchSnippet.tsx",
      "// NIE PISZ dangerouslySetInnerHTML={{ __html: zlo }} - fragment idzie",
      "// przez sanitizer w warstwie zapytania.",
      "export const SearchSnippet = () => <span />;",
    );
    expect(extractHtmlSinks(src)).toEqual([]);
  });

  it("12. komentarz `/* … */` WEWNĄTRZ literału CSS zostaje (kształt VisualCanvas.tsx:782-784)", () => {
    const src = source(
      "src/components/admin/builder/ui/organisms/builder/VisualCanvas.tsx",
      "export function Canvas() {",
      "  const ringCss = `",
      "    [data-visual-canvas] [data-widget-id]{outline:1px dashed transparent;}",
      "    /* WidgetResizeOverlay owns the single-selection frame. Keeping a",
      "       second outline here produced two slightly different borders. */",
      "    [data-visual-canvas] [data-widget-id].is-selected{outline-color:transparent}",
      "  `;",
      "  return <style dangerouslySetInnerHTML={{ __html: ringCss }} />;",
      "}",
    );
    const sinks = extractHtmlSinks(src);
    expect(sinks).toHaveLength(1);
    expect(sinks[0].expression).toContain("ringCss");
    expect(scan(src).violations).toEqual([]);
  });
});

describe("ustalanie znacznika", () => {
  it("2. `__html` w KOLEJNEJ linii (kształt BuilderRenderer.tsx:676) zostaje rozpoznane", () => {
    const src = source(
      "src/components/builder/organisms/BuilderRenderer.tsx",
      'import { hardenStyleCss } from "@/lib/sanitizePure";',
      "export const X = ({ mobileOrderCss }: { mobileOrderCss: string }) => (",
      "  <style",
      "    dangerouslySetInnerHTML={{",
      "      __html: hardenStyleCss(`@media (max-width: 767px){${mobileOrderCss}}`),",
      "    }}",
      "  />",
      ");",
    );
    const sinks = extractHtmlSinks(src);
    expect(sinks).toHaveLength(1);
    expect(sinks[0].sink).toBe("style");
    expect(scan(src).violations).toEqual([]);
  });

  it('16. nazwa znacznika będąca ZMIENNĄ (`<Tag {...attrs}>`) to rodzaj „html"', () => {
    const src = source(
      "src/components/blocks/renderer/molecules.tsx",
      "export const renderCell = ({ fnHtml, attrs, Tag, ci }: Ctx) => {",
      "  const withFn = fnHtml.get(`${ci}`);",
      "  return <Tag key={ci} {...attrs} dangerouslySetInnerHTML={{ __html: withFn }} />;",
      "};",
    );
    const sinks = extractHtmlSinks(src);
    expect(sinks).toHaveLength(1);
    expect(sinks[0].sink).toBe("html");
  });

  it("17. `<` jako operator porównania w propsie POPRZEDZAJĄCYM nie myli znacznika", () => {
    const src = source(
      "src/components/Porownanie.tsx",
      'import { hardenStyleCss } from "@/lib/sanitizePure";',
      "export const X = ({ count, css }: { count: number; css: string }) => (",
      '  <style data-small={count < 3 ? "a" : "b"}',
      "    dangerouslySetInnerHTML={{ __html: hardenStyleCss(css) }} />",
      ");",
    );
    const sinks = extractHtmlSinks(src);
    expect(sinks[0].sink).toBe("style");
    expect(scan(src).violations).toEqual([]);
  });

  it("18. znacznik nieustalony to NARUSZENIE (fail-loud, nie ciche przepuszczenie)", () => {
    const raw = {
      file: "src/components/Dziwny.tsx",
      line: 3,
      sink: "unknown" as const,
      attribute: "{ __html: cos }",
      expression: "cos",
    };
    const sink = classifySink(raw, "const cos = 1;", NONE);
    expect(sink.status).toBe("violation");
    expect(sink.remedy).toContain("znacznik");
  });

  it("atrybut BEZ klucza `__html` też oblewa - wartość z zewnątrz ukrywa źródło", () => {
    const src = source(
      "src/components/Przekazany.tsx",
      "export const X = ({ htmlProp }: { htmlProp: { __html: string } }) => (",
      "  <div dangerouslySetInnerHTML={htmlProp} />",
      ");",
    );
    const report = scan(src);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].remedy).toContain("__html");
  });
});

describe("allowlista i tryby awarii", () => {
  it("19. wpis niepasujący do niczego trafia do `staleAllowlist` i OBLEWA bramkę", () => {
    const src = source(
      "src/components/Foo.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export const Foo = ({ h }: { h: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(h) }} />",
      ");",
    );
    const allow: DangerousHtmlAllowEntry[] = [
      {
        file: "src/components/Skasowany.tsx",
        sink: "html",
        symbol: "duch",
        reason: "Wpis po refaktorze, którego nie ma już czego zwalniać - musi oblać.",
      },
    ];
    const report = scan(src, allow);
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toHaveLength(1);
    expect(dangerousHtmlFailed(report)).toBe(true);
  });

  it("20. pusty zestaw źródeł OBLEWA - bramka, która nic nie widzi, nie jest zielona", () => {
    const report = scanDangerousHtml([], NONE);
    expect(report.stats.totalSinks).toBe(0);
    expect(dangerousHtmlFailed(report)).toBe(true);
    expect(renderDangerousHtmlReport(report)).toContain("ANI JEDNEGO SINKA");
  });

  it("21. raport: zielony podaje zasięg, czerwony `plik:linia` i `remedy`", () => {
    const ok = source(
      "src/components/Foo.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export const Foo = ({ h }: { h: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(h) }} />",
      ");",
    );
    const zielony = renderDangerousHtmlReport(scan(ok));
    expect(zielony).toContain("1 sinków");
    expect(zielony).toContain("1 sanityzowanych");

    const zle = source(
      "src/components/Zle.tsx",
      "export const Zle = ({ h }: { h: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __html: h }} />",
      ");",
    );
    const czerwony = renderDangerousHtmlReport(scan(zle));
    expect(czerwony).toContain("src/components/Zle.tsx:2");
    expect(czerwony).toContain("sanitizeHtml");
  });

  it("`sinkSymbol` bierze nazwę, nie treść literału", () => {
    expect(sinkSymbol('html ?? ""')).toBe("html");
    expect(sinkSymbol("citations.chicago")).toBe("citations.chicago");
    expect(sinkSymbol("expertLayoutScopeCss(scopeId, settings)")).toBe("expertLayoutScopeCss");
  });
});

describe("22. plik zbiorczy - obrona przed CICHĄ ZIELONOŚCIĄ", () => {
  // Bilans klamer, który pomyli się na jednym `${…}`, gubi część sinków, a
  // bramka wygląda wtedy DOKŁADNIE jak przechodząca. Dlatego liczba jest
  // przypięta na sztywno, a nie sprawdzana nierównością.
  const src = source(
    "src/components/Zbiorczy.tsx",
    'import { sanitizeHtml, } from "@/lib/sanitize";',
    'import { hardenStyleCss } from "@/lib/sanitizePure";',
    'import { safeJsonLd } from "@/lib/seo/jsonld";',
    'import { useId, useMemo } from "react";',
    "// Uwaga: dangerouslySetInnerHTML={{ __html: zlo }} w komentarzu NIE liczy się.",
    "export function Zbiorczy({ html, css, graf }: Props) {",
    '  const anim = `zb-${useId().replace(/:/g, "")}`;',
    "  const safe = useMemo(() => sanitizeHtml(html), [html]);",
    "  return (",
    "    <div>",
    "      <div dangerouslySetInnerHTML={{ __html: safe }} />",
    "      <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />",
    "      <style dangerouslySetInnerHTML={{ __html: hardenStyleCss(css) }} />",
    "      <style",
    "        dangerouslySetInnerHTML={{",
    "          __html: `",
    "            @keyframes ${anim} { from { opacity: 0 } to { opacity: 1 } }",
    '            .x[data-y="1"] { content: "}" }',
    "          `,",
    "        }}",
    "      />",
    '      <script type="application/ld+json"',
    "        dangerouslySetInnerHTML={{ __html: safeJsonLd(graf) }} />",
    "      <p dangerouslySetInnerHTML={{ __html: html }} />",
    "    </div>",
    "  );",
    "}",
  );

  it("znajduje DOKŁADNIE sześć sinków i rozpoznaje każdy rodzaj", () => {
    const sinks = extractHtmlSinks(src);
    expect(sinks).toHaveLength(6);
    expect(sinks.map((s) => s.sink)).toEqual(["html", "html", "style", "style", "jsonld", "html"]);
  });

  it("puszcza pięć dowiedzionych i zatrzymuje jedno surowe `html`", () => {
    const report = scan(src);
    expect(report.stats.totalSinks).toBe(6);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].expression).toBe("html");
    expect(report.stats.sanitized).toBe(4);
    expect(report.stats.literal).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cofanie się do znacznika jest miejscem, w którym bramka najłatwiej robi się
// CICHO ZIELONA: gdy skan zgubi się na niesparowanym cudzysłowie i mimo to
// zwróci JAKIŚ znacznik, sink w `<style>` zostanie wzięty za `html`, a wtedy
// `sanitizeHtml` (FORBID_TAGS zawiera `style`) przejdzie jako „dowód". Dlatego
// każde zgubienie się MUSI kończyć się rodzajem `unknown`, czyli naruszeniem.
// ─────────────────────────────────────────────────────────────────────────────
describe("24. zgubione cofanie do znacznika kończy się naruszeniem, nie zgadywaniem", () => {
  it("niesparowany cudzysłów w propsie zatrzymuje cofanie", () => {
    const src = source(
      "src/components/Urwany.tsx",
      "export const Urwany = ({ h }: { h: string }) => (",
      "  <p data-label=' dangerouslySetInnerHTML={{ __html: h }} />",
      ");",
    );
    const sinks = extractHtmlSinks(src);
    expect(sinks).toHaveLength(1);
    expect(sinks[0].sink).toBe("unknown");
    expect(scan(src).violations[0].remedy).toContain("znacznik");
  });

  it("apostrof w wyrażeniu regularnym wewnątrz propsa klamrowego też je zatrzymuje", () => {
    // Cofanie przeskakuje zrównoważone `{…}`, więc wchodzi w treść propsa.
    // Apostrof z `/'/ ` nie ma pary, a bramka nie ma prawa udać, że ją znalazła.
    const src = source(
      "src/components/Regex.tsx",
      "export const Regex = ({ h }: { h: string }) => (",
      "  <p data-quote={/'/.test(h)} dangerouslySetInnerHTML={{ __html: h }} />",
      ");",
    );
    const sinks = extractHtmlSinks(src);
    expect(sinks).toHaveLength(1);
    expect(sinks[0].sink).toBe("unknown");
    expect(scan(src).violations).toHaveLength(1);
  });

  it("zagnieżdżone klamry w propsie rozłożonym nie gubią znacznika `<style>`", () => {
    // Cofanie przeskakuje CAŁY zrównoważony props. Gdyby liczyło tylko pierwszą
    // parę klamer, zatrzymałoby się w środku obiektu i uznało sink za `html` -
    // a wtedy `sanitizeHtml`, który kasuje `<style>`, przeszedłby jako dowód.
    const src = source(
      "src/components/Zagniezdzone.tsx",
      'import { hardenStyleCss } from "@/lib/sanitizePure";',
      "export const Z = ({ css }: { css: string }) => (",
      "  <style {...{ media: { print: false } }} dangerouslySetInnerHTML={{ __html: hardenStyleCss(css) }} />",
      ");",
    );
    const sinks = extractHtmlSinks(src);
    expect(sinks[0].sink).toBe("style");
    expect(scan(src).violations).toEqual([]);
  });

  it("atrybut przypisany imperatywnie do obiektu propsów nie ma znacznika", () => {
    // `attrs.dangerouslySetInnerHTML = …` nie mówi, czy props trafi do `<div>`,
    // czy do `<style>`, a od tego zależy, który sanitizer jest dowodem. Wybór
    // najłagodniejszego wariantu byłby cichym zwolnieniem dla CSS-u.
    const src = source(
      "src/components/Imperatywny.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export function attach(attrs: Attrs, h: string) {",
      "  const safe = sanitizeHtml(h);",
      "  attrs.dangerouslySetInnerHTML = { __html: safe };",
      "  return attrs;",
      "}",
    );
    const sinks = extractHtmlSinks(src);
    expect(sinks[0].sink).toBe("unknown");
    expect(scan(src).violations).toHaveLength(1);
  });

  it("atrybut, przed którym nie ma NICZEGO, nie dostaje domyślnego rodzaju `html`", () => {
    // Rodzaj `html` jest najłagodniejszy (przyjmuje `sanitizeHtml`), więc
    // przyznanie go „z braku lepszego" byłoby cichym zwolnieniem.
    const src = source("src/components/Fragment.tsx", "  dangerouslySetInnerHTML={{ __html: t }}");
    const sinks = extractHtmlSinks(src);
    expect(sinks).toHaveLength(1);
    expect(sinks[0].sink).toBe("unknown");
    expect(scan(src).violations[0].status).toBe("violation");
  });
});

describe("25. klucz `__html` czytany z POZYCJI, nie z samego napisu", () => {
  it("napis `__html` postawiony przed kluczem nie podszywa się pod klucz", () => {
    // Gdyby bramka brała pierwsze wystąpienie napisu, wystarczyłoby postawić
    // przed kluczem odczyt pola o tej samej nazwie, żeby oceniła co innego,
    // niż naprawdę trafia do DOM-u.
    const src = source(
      "src/components/Pozycja.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export const P = ({ h, cache }: { h: string; cache: Cache }) => (",
      "  <div dangerouslySetInnerHTML={{ ...cache.__html, __html: sanitizeHtml(h) }} />",
      ");",
    );
    const sinks = extractHtmlSinks(src);
    expect(sinks[0].expression).toBe("sanitizeHtml(h)");
    expect(scan(src).violations).toEqual([]);
  });

  it("klucz o dłuższej nazwie (`__htmlLegacy`) nie jest kluczem `__html`", () => {
    const src = source(
      "src/components/Dluzszy.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export const D = ({ h, stary }: { h: string; stary: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __htmlLegacy: stary, __html: sanitizeHtml(h) }} />",
      ");",
    );
    const sinks = extractHtmlSinks(src);
    expect(sinks[0].expression).toBe("sanitizeHtml(h)");
    expect(scan(src).violations).toEqual([]);
  });

  it("skrót `{{ __html }}` OBLEWA - wartość wchodzi spoza pola widzenia bramki", () => {
    const src = source(
      "src/components/Skrot.tsx",
      "export const S = ({ __html }: { __html: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __html }} />",
      ");",
    );
    const sinks = extractHtmlSinks(src);
    expect(sinks[0].expression).toBeNull();
    expect(scan(src).violations[0].remedy).toContain("__html");
  });

  it("niedomknięta klamra atrybutu GUBI sink, więc bramka oblewa na zerze sinków", () => {
    // To jest dokładnie awaria „bilans klamer przestał działać". Pojedynczy
    // zgubiony sink w prawdziwym repo wygląda jak bramka przechodząca, dlatego
    // zero sinków musi być traktowane jako awaria skanera.
    const src = source(
      "src/components/Niedomkniety.tsx",
      "export const N = ({ h }: { h: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __html: h }",
      ");",
    );
    expect(extractHtmlSinks(src)).toEqual([]);
    expect(scan(src).stats.totalSinks).toBe(0);
    expect(dangerousHtmlFailed(scan(src))).toBe(true);
  });

  it("pusty `__html` (po zamaskowanym komentarzu) nie wnosi treści - to literał", () => {
    const src = source(
      "src/components/Pusty.tsx",
      "export const P = () => (",
      "  <div dangerouslySetInnerHTML={{ __html: /* TODO: treść */ }} />",
      ");",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.literal).toBe(1);
  });
});

describe("26. dowodem jest PARA (nazwa, moduł), nie sama nazwa", () => {
  it("domyślny import `sanitizeHtml` z cudzego pakietu nie jest dowodem", () => {
    // `import sanitizeHtml from "dompurify"` ma właściwą nazwę i zły moduł -
    // bez czytania importów domyślnych bramka wzięłaby to za swój sanitizer.
    const src = source(
      "src/components/Domyslny.tsx",
      'import sanitizeHtml from "dompurify";',
      "export const D = ({ h }: { h: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(h) }} />",
      ");",
    );
    const report = scan(src);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].remedy).toContain("@/lib/sanitize");
  });

  it("ścieżka relatywna liczy się dopiero po sprowadzeniu do `@/`", () => {
    // `../sanitize` z `src/lib/blocks/` TO jest `@/lib/sanitize`, ale
    // `../../lib/sanitize` z `src/components/` wychodzi POZA `src/` i wskazuje
    // zupełnie inny plik - porównanie samego ogona ścieżki dałoby fałszywy dowód.
    const wewnatrz = source(
      "src/lib/blocks/Foo.tsx",
      'import { sanitizeHtml } from "../sanitize";',
      "export const F = ({ h }: { h: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(h) }} />",
      ");",
    );
    expect(scan(wewnatrz).violations).toEqual([]);

    const poza = source(
      "src/components/Poza.tsx",
      'import { sanitizeHtml } from "../../lib/sanitize";',
      "export const P = ({ h }: { h: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(h) }} />",
      ");",
    );
    const report = scan(poza);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].remedy).toContain("nie jest tu zaimportowane");
  });

  it("delegat zdefiniowany we WŁASNYM module jest dowodem bez importu", () => {
    // `clean` z InteractiveViews.tsx:19-21 nie jest skądkolwiek importowane -
    // bez reguły „moduł własny też się liczy" bramka oblewałaby prawidłowy kod.
    const src = source(
      "src/components/blocks/InteractiveViews.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "const clean = (s: string) => sanitizeHtml(s);",
      "export const View = ({ raw }: { raw: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __html: clean(raw) }} />",
      ");",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.sanitized).toBe(1);
  });

  it("delegat `sanitize` (polityka bloków) NIE pasuje do `<style>`", () => {
    // Ta sama pułapka co przy `sanitizeHtml`: polityka bloków kasuje `<style>`,
    // więc przepuszczenie przez nią CSS-u skasowałoby motyw całej strony.
    const src = source(
      "src/components/blocks/renderer/atoms.tsx",
      'import { sanitize } from "./data";',
      "export const renderCss = ({ css }: Ctx) => (",
      "  <style dangerouslySetInnerHTML={{ __html: sanitize(css) }} />",
      ");",
    );
    const report = scan(src);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].remedy).toContain("nie pasuje do sinka");
  });
});

describe("27. ternary: pytajnik pytajnikowi nierówny", () => {
  it("`?.` przed operatorem warunkowym nie jest początkiem ternary", () => {
    // Gdyby bramka wzięła pytajnik z `block?.html` za ternary, „ramionami"
    // stałyby się `.html ? sanitizeHtml(block.html)` i reszta - czyli ocena
    // poszłaby na tekst, który w ogóle nie jest wyrażeniem.
    const src = source(
      "src/components/Opcjonalny.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export const O = ({ block }: { block: Block }) => (",
      '  <div dangerouslySetInnerHTML={{ __html: block?.html ? sanitizeHtml(block.html) : "" }} />',
      ");",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.sanitized).toBe(1);
  });

  it("ternary zagnieżdżony w gałęzi PRAWDA - oceniane są oba wewnętrzne ramiona", () => {
    // Bez liczenia zagnieżdżeń pierwszy napotkany dwukropek rozciąłby wyrażenie
    // w złym miejscu i jedno z ramion nigdy nie zostałoby sprawdzone - a to
    // wystarczy, żeby surowy HTML przeszedł jako „sanityzowany".
    function sink(wyrazenie: string) {
      return scan(
        source(
          "src/components/Zagniezdzony.tsx",
          'import { sanitizeHtml } from "@/lib/sanitize";',
          "export const Z = ({ a, b, c, wide, tall }: Props) => (",
          `  <div dangerouslySetInnerHTML={{ __html: ${wyrazenie} }} />`,
          ");",
        ),
      );
    }

    const wszystkie = sink("wide ? tall ? sanitizeHtml(a) : sanitizeHtml(b) : sanitizeHtml(c)");
    expect(wszystkie.violations).toEqual([]);
    expect(wszystkie.stats.sanitized).toBe(1);

    const surowe = sink("wide ? tall ? sanitizeHtml(a) : b : sanitizeHtml(c)");
    expect(surowe.violations).toHaveLength(1);
    expect(surowe.stats.sanitized).toBe(0);
  });
});

describe("28. czytanie wiązań lokalnych", () => {
  it('adnotacja typu z indeksem `Styles["css"]` nie gubi znaku `=`', () => {
    // Cudzysłów w adnotacji typu stoi PRZED inicjalizatorem. Skan, który go nie
    // pominie, weźmie `"css"` za początek wartości i nie znajdzie wiązania -
    // a brak wiązania to u tej bramki naruszenie, czyli fałszywy alarm na
    // prawidłowo sanityzowanym CSS-ie.
    const src = source(
      "src/components/builder/Scope.tsx",
      'import { hardenStyleCss } from "@/lib/sanitizePure";',
      'import type { BuilderStyles } from "@/lib/builder/types";',
      "export function Scope({ raw }: { raw: string }) {",
      '  const scopeCss: BuilderStyles["css"] = hardenStyleCss(raw);',
      "  return <style dangerouslySetInnerHTML={{ __html: scopeCss }} />;",
      "}",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.sanitized).toBe(1);
  });

  it("deklaracja bez inicjalizatora (`let raw;`) nie jest dowodem", () => {
    // Przypisanie stoi gdzie indziej, więc bramka nie widzi, co naprawdę
    // wpada do `raw`. Potraktowanie samej deklaracji jako wiązania kazałoby
    // jej czytać przypadkowy fragment pliku za następnym znakiem `=`.
    const src = source(
      "src/components/Pozne.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export function Pozne({ input }: { input: string }) {",
      "  let raw;",
      "  raw = sanitizeHtml(input);",
      "  return <div dangerouslySetInnerHTML={{ __html: raw }} />;",
      "}",
    );
    const report = scan(src);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].remedy).toContain("nie jest wiązane w tym pliku");
  });

  it("adnotacja typu rozbita na kilka linii nie kończy szukania inicjalizatora", () => {
    // Nowa linia wewnątrz `<…>` NIE jest końcem deklaracji. Potraktowanie jej
    // jak średnika zostawiłoby wiązanie nieodczytane, czyli dałoby fałszywy
    // alarm na kodzie, który sanitizer wywołuje prawidłowo.
    const src = source(
      "src/components/Wielolinijkowy.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export function W({ raw }: { raw: string }) {",
      "  const safe: ReturnType<",
      "    typeof sanitizeHtml",
      "  > = sanitizeHtml(raw);",
      "  return <div dangerouslySetInnerHTML={{ __html: safe }} />;",
      "}",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.sanitized).toBe(1);
  });

  it("destrukturyzacja z propsów nie jest dowodem - inicjalizator nie ma tego pola", () => {
    // `const { safe } = props` mówi tylko, skąd wartość przyszła, a nie czym
    // jest. Uznanie samej destrukturyzacji za wiązanie przepuściłoby każdy
    // surowy HTML podany przez rodzica.
    const src = source(
      "src/components/ZProps.tsx",
      "export function ZProps(props: { safe: string }) {",
      "  const { safe } = props;",
      "  return <div dangerouslySetInnerHTML={{ __html: safe }} />;",
      "}",
    );
    const report = scan(src);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].remedy).toContain("nie jest wiązane w tym pliku");
  });

  it("destrukturyzacja INNYCH pól nie podszywa się pod szukaną nazwę", () => {
    // `const { title } = block` nie mówi nic o `safe`. Gdyby bramka brała
    // pierwszą lepszą destrukturyzację, przypisałaby `safe` wartość `block`.
    const src = source(
      "src/components/Karta.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export function Karta({ block }: { block: Block }) {",
      "  const { title } = block;",
      "  const safe = sanitizeHtml(block.html);",
      "  return <h3 title={title} dangerouslySetInnerHTML={{ __html: safe }} />;",
      "}",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.sanitized).toBe(1);
  });

  it("`const { safe } = useMemo(() => ({ safe: … }))` - właściwość ostatnia w obiekcie", () => {
    const src = source(
      "src/components/Memo.tsx",
      'import { useMemo } from "react";',
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export function Memo({ html }: { html: string }) {",
      "  const { safe } = useMemo(() => ({ safe: sanitizeHtml(html) }), [html]);",
      "  return <div dangerouslySetInnerHTML={{ __html: safe }} />;",
      "}",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.sanitized).toBe(1);
  });

  it("właściwość po rodzeństwie i po NAPISIE o tej samej nazwie", () => {
    // Napis `--css:` w sąsiedniej właściwości wygląda jak klucz `css:`.
    // Wzięcie go za klucz dałoby wartość `` `--css: ${color}` `` zamiast
    // `hardenStyleCss(raw)`, czyli ocenę zupełnie innego wyrażenia.
    const src = source(
      "src/components/MemoDwa.tsx",
      'import { useMemo } from "react";',
      'import { hardenStyleCss } from "@/lib/sanitizePure";',
      "export function MemoDwa({ raw, color }: { raw: string; color: string }) {",
      "  const { css } = useMemo(",
      "    () => ({ tone: `--css: ${color}`, css: hardenStyleCss(`.wrap{${raw}}`), rest: 1 }),",
      "    [raw, color],",
      "  );",
      "  return <style dangerouslySetInnerHTML={{ __html: css }} />;",
      "}",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.sanitized).toBe(1);
  });

  it("ciało blokowe `useMemo` bez średnika po `return` nadal jest czytane", () => {
    // Bramka nie może zależeć od formatowania: `return x` bez średnika kończy
    // się klamrą bloku, a nie średnikiem.
    const src = source(
      "src/components/Blok.tsx",
      'import { useMemo } from "react";',
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export function Blok({ html }: { html: string }) {",
      "  const safe = useMemo(() => { return sanitizeHtml(html) }, [html]);",
      "  return <div dangerouslySetInnerHTML={{ __html: safe }} />;",
      "}",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.sanitized).toBe(1);
  });

  it("`useMemo` bez strzałki i bez argumentów OBLEWA zamiast przechodzić", () => {
    // Nieodczytane ciało `useMemo` to brak dowodu. Milczące przepuszczenie
    // zamieniłoby samo owinięcie wartości w `useMemo` w sposób na ominięcie bramki.
    function sink(wyrazenie: string) {
      return scan(
        source(
          "src/components/MemoDziwny.tsx",
          'import { useMemo } from "react";',
          "export const M = ({ build }: Props) => (",
          `  <div dangerouslySetInnerHTML={{ __html: ${wyrazenie} }} />`,
          ");",
        ),
      );
    }

    for (const wyrazenie of ["useMemo(build, [build])", "useMemo()"]) {
      const report = sink(wyrazenie);
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0].remedy).toContain("nie udało się odczytać ciała");
    }
  });

  it("lokalne opakowanie ocenia się po CIELE, nie po nazwie", () => {
    function sink(cialo: string) {
      return scan(
        source(
          "src/components/Opakowanie.tsx",
          'import { sanitizeHtml } from "@/lib/sanitize";',
          `const wrap = (h: string) => ${cialo};`,
          "export const O = ({ raw }: { raw: string }) => (",
          "  <div dangerouslySetInnerHTML={{ __html: wrap(raw) }} />",
          ");",
        ),
      );
    }

    const dobre = sink("sanitizeHtml(h)");
    expect(dobre.violations).toEqual([]);
    expect(dobre.stats.sanitized).toBe(1);

    const puste = sink("h");
    expect(puste.violations).toHaveLength(1);
    expect(puste.stats.sanitized).toBe(0);
  });

  it("łańcuch metod DOKLEJONY do sanitizera nie jest już wywołaniem sanitizera", () => {
    // `sanitizeHtml(h).trim()` NIE jest rozbijane na wywołanie, bo cały tekst
    // nim nie jest. Bramka woli oblać, niż uznać, że ostatnie ogniwo łańcucha
    // (tu akurat niewinne, ale równie dobrze `.concat(zlo)`) niczego nie wnosi.
    const src = source(
      "src/components/Lancuch.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export const L = ({ h }: { h: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(h).trim() }} />",
      ");",
    );
    const report = scan(src);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].remedy).toContain("nie daje się sprowadzić");
  });
});

describe("29. wartości, które nie mogą wnieść znaku `<`", () => {
  it("skalarne wiązanie wplecione w literał CSS zostaje literałem", () => {
    // Liczby, flagi i wartości puste nie są w stanie domknąć elementu `<style>`,
    // więc wymaganie od nich sanitizera byłoby fałszywym alarmem na każdej
    // nazwie animacji i każdym `--token` w repo.
    for (const wartosc of ["12", "1.5", "true", "false", "null", "undefined"]) {
      const src = source(
        "src/components/Skalar.tsx",
        `const TOKEN = ${wartosc};`,
        "export const S = () => (",
        "  <style dangerouslySetInnerHTML={{ __html: `.s{--t:${TOKEN}}` }} />",
        ");",
      );
      const report = scan(src);
      expect(report.violations).toEqual([]);
      expect(report.stats.literal).toBe(1);
    }
  });

  it("łańcuch siedmiu wiązań przekracza limit rozwijania i OBLEWA", () => {
    // Limit istnieje po to, żeby cykl wiązań nie zawiesił bramki. Po jego
    // przekroczeniu wynikiem MUSI być naruszenie - milczące „nie wiem"
    // byłoby zwolnieniem dla dowolnie długiego łańcucha przekierowań.
    const src = source(
      "src/components/Lancuszek.tsx",
      "const w1 = w2;",
      "const w2 = w3;",
      "const w3 = w4;",
      "const w4 = w5;",
      "const w5 = w6;",
      "const w6 = w7;",
      'const w7 = "<b>koniec</b>";',
      "export const L = () => (",
      "  <style dangerouslySetInnerHTML={{ __html: `.x{--v:${w1}}` }} />",
      ");",
    );
    const report = scan(src);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].remedy).toContain("limit rozwijania");
  });

  it("`useId()` jest bezpieczne tylko z łańcuchem metod, które nic nie wnoszą", () => {
    function sink(wyrazenie: string) {
      return scan(
        source(
          "src/components/Ident.tsx",
          'import { useId } from "react";',
          "export const I = ({ raw }: { raw: string }) => (",
          `  <style dangerouslySetInnerHTML={{ __html: \`.t{animation-name:\${${wyrazenie}}}\` }} />`,
          ");",
        ),
      );
    }

    const bezpieczne = sink('useId().replace(/:/g, "")');
    expect(bezpieczne.violations).toEqual([]);
    expect(bezpieczne.stats.literal).toBe(1);

    // `.concat(raw)` dokłada do identyfikatora treść spoza Reacta - czyli
    // dokładnie to, przed czym `useId()` miało chronić.
    const wnoszace = sink("useId().concat(raw)");
    expect(wnoszace.violations).toHaveLength(1);
    expect(wnoszace.stats.literal).toBe(0);
  });

  it("`JSON.stringify` liczy się dopiero z ucieczką `<` (kształt AlertBar.tsx:129-131)", () => {
    const src = source(
      "src/components/AlertBar.tsx",
      "export const AlertBar = ({ data }: { data: unknown }) => (",
      "  <script",
      "    dangerouslySetInnerHTML={{",
      '      __html: `window.__alert=${JSON.stringify(data).replace(/</g, "\\\\u003c")};`,',
      "    }}",
      "  />",
      ");",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.literal).toBe(1);
  });

  it("alias `cssText = (v) => JSON.stringify(v)` dziedziczy regułę `JSON.stringify`", () => {
    // VisualCanvas.tsx:778. Alias ukrywa nazwę `JSON.stringify` przed bramką,
    // więc bez zaglądania w ciało wiązania selektor `[data-x=…]` w `<style>`
    // przeszedłby bez żadnego dowodu.
    function sink(argument: string, ...dodatkowe: string[]) {
      return scan(
        source(
          "src/components/admin/builder/ui/organisms/builder/VisualCanvas.tsx",
          "const cssText = (v: string) => JSON.stringify(v);",
          ...dodatkowe,
          "export const Canvas = ({ tytul }: { tytul: string }) => (",
          `  <style dangerouslySetInnerHTML={{ __html: \`[data-x=\${cssText(${argument})}]{color:red}\` }} />`,
          ");",
        ),
      );
    }

    const literal = sink('"hero"');
    expect(literal.violations).toEqual([]);
    expect(literal.stats.literal).toBe(1);

    const stala = sink("nazwa", 'const nazwa = "hero";');
    expect(stala.violations).toEqual([]);
    expect(stala.stats.literal).toBe(1);

    // Wartość spoza repo (prop) nie jest stałą, więc `JSON.stringify` niczego
    // nie dowodzi - `</style>` w środku wyszłoby z serializacji nietknięte.
    const prop = sink("tytul");
    expect(prop.violations).toHaveLength(1);
    expect(prop.stats.literal).toBe(0);
  });

  it("niedomknięty nawias `JSON.stringify(` OBLEWA zamiast być zgadywany", () => {
    const src = source(
      "src/routes/Urwane.tsx",
      "export const U = ({ graf }: { graf: unknown }) => (",
      "  <div dangerouslySetInnerHTML={{ __html: JSON.stringify(graf }} />",
      ");",
    );
    const report = scan(src);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].remedy).toContain("nie daje się sprowadzić");
  });

  it("obiekt serializowany do `<style>` OBLEWA - klamry we wstawce nie mylą bilansu", () => {
    // Wstawka `${…}` zawiera własne klamry. Skan, który by ich nie zbilansował,
    // urwałby literał w połowie i ocenił kawałek tekstu zamiast wyrażenia.
    const src = source(
      "src/components/Serializacja.tsx",
      "export const S = () => (",
      "  <style dangerouslySetInnerHTML={{ __html: `.t{content:${JSON.stringify({ tone: 1 })}}` }} />",
      ");",
    );
    const report = scan(src);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].remedy).toContain("JSON.stringify");
  });

  it("znak ucieczki w literale szablonowym nie urywa szukania wstawek", () => {
    // `\\n` przed wstawką: bez pominięcia pary znaków skan rozjeżdża się o jeden
    // i wstawka `${kod}` nigdy nie trafia do oceny.
    const src = source(
      "src/components/Escape.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export const E = ({ raw }: { raw: string }) => {",
      "  const kod = sanitizeHtml(raw);",
      "  return <div dangerouslySetInnerHTML={{ __html: `<pre>\\n${kod}</pre>` }} />;",
      "};",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.sanitized).toBe(1);
  });

  it("nawiasy wokół CAŁEGO wyrażenia są zdejmowane przed oceną", () => {
    // Bez tego `(…)` byłoby wyrażeniem „nieznanego kształtu" i każdy
    // prettier-owy zawijas dawałby fałszywy alarm.
    const src = source(
      "src/components/Nawiasy.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export const N = ({ html }: { html: string }) => (",
      '  <div dangerouslySetInnerHTML={{ __html: ("<hr/>" + sanitizeHtml(html)) }} />',
      ");",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.sanitized).toBe(1);
  });

  it("dekorator wywołany BEZ argumentu nie wnosi treści", () => {
    const src = source(
      "src/components/DekorPusty.tsx",
      'import { enhanceContentImages } from "@/lib/content/enhanceImages";',
      "export const D = () => (",
      "  <div dangerouslySetInnerHTML={{ __html: enhanceContentImages() }} />",
      ");",
    );
    const report = scan(src);
    expect(report.violations).toEqual([]);
    expect(report.stats.literal).toBe(1);
  });
});

describe("30. księgowanie raportu", () => {
  it("pliki bez atrybutu w ogóle nie są parsowane, ale liczą się do zasięgu", () => {
    // Zasięg skanu jest jedyną liczbą, po której widać, że bramka objęła całe
    // repo. Gdyby pliki bez sinków wypadały z `scannedFiles`, log wyglądałby
    // tak samo przy skanie trzech plików i przy skanie całego `src/`.
    const bezSinka = source("src/lib/pure.ts", "export const WERSJA = 1;");
    const zSinkiem = source(
      "src/components/Jeden.tsx",
      'import { sanitizeHtml } from "@/lib/sanitize";',
      "export const J = ({ h }: { h: string }) => (",
      "  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(h) }} />",
      ");",
    );
    const report = scanDangerousHtml([bezSinka, zSinkiem], NONE);
    expect(report.stats.scannedFiles).toBe(2);
    expect(report.stats.totalSinks).toBe(1);
  });

  it("zwolnienie dla sinka BEZ klucza `__html` liczy się jako użyte", () => {
    // Symbol takiego sinka jest pusty. Gdyby klucz zwolnienia liczył się
    // inaczej niż przy dopasowaniu, wpis ratowałby sink i JEDNOCZEŚNIE trafiał
    // na listę przeterminowanych - bramka oblewałaby mimo poprawnej allowlisty.
    const src = source(
      "src/components/Przekazany.tsx",
      "export const X = ({ htmlProp }: { htmlProp: { __html: string } }) => (",
      "  <div dangerouslySetInnerHTML={htmlProp} />",
      ");",
    );
    const allow: DangerousHtmlAllowEntry[] = [
      {
        file: "src/components/Przekazany.tsx",
        sink: "html",
        symbol: "",
        reason: "Obiekt składany u wywołującego, sanityzacja stoi w warstwie zapytania.",
      },
    ];
    const report = scan(src, allow);
    expect(report.violations).toEqual([]);
    expect(report.stats.allowlisted).toBe(1);
    expect(report.staleAllowlist).toEqual([]);
  });

  it("dwa naruszenia w jednym pliku: sortowanie po linii, grupowanie po rodzaju", () => {
    const src = source(
      "src/components/Dwa.tsx",
      "export const Dwa = ({ a, b }: Props) => (",
      "  <div>",
      "    <p dangerouslySetInnerHTML={{ __html: a }} />",
      "    <span dangerouslySetInnerHTML={{ __html: b }} />",
      "  </div>",
      ");",
    );
    const allow: DangerousHtmlAllowEntry[] = [
      {
        file: "src/components/Duch.tsx",
        sink: "html",
        symbol: "duch",
        reason: "Wpis po refaktorze - plik już nie istnieje, więc musi trafić na listę.",
      },
    ];
    const report = scan(src, allow);
    expect(report.violations.map((v) => v.line)).toEqual([3, 4]);

    const tekst = renderDangerousHtmlReport(report);
    expect(tekst).toContain("HTML treści (2)");
    expect(tekst).toContain("nie ratuje już żadnego sinka");
  });
});

describe("31. `resolveExpression` rozwija tylko to, co jednoznaczne", () => {
  const zrodlo = [
    'import { sanitizeHtml } from "@/lib/sanitize";',
    "const safe = raw;",
    "const raw = sanitizeHtml(input);",
    "const dwuznaczny = a;",
    "const dwuznaczny = b;",
  ].join("\n");

  it("idzie po łańcuchu dokładnie tyle kroków, ile mu wolno", () => {
    expect(resolveExpression("safe", zrodlo, 1)).toBe("raw");
    expect(resolveExpression("safe", zrodlo, 2)).toBe("sanitizeHtml(input)");
  });

  it("zatrzymuje się na wyrażeniu złożonym i na nazwie wiązanej wielokrotnie", () => {
    // Trzeci krok nie ma czego rozwijać (to już wywołanie), a przy dwóch
    // wiązaniach tej samej nazwy wybór jednego z nich byłby zgadywaniem
    // zasięgu - czyli błędem, który kończy się cichą zielenią.
    expect(resolveExpression("safe", zrodlo, 3)).toBe("sanitizeHtml(input)");
    expect(resolveExpression("dwuznaczny", zrodlo, 1)).toBe("dwuznaczny");
    expect(resolveExpression("nieznany", zrodlo, 1)).toBe("nieznany");
  });
});
