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
