import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  compareWithAllowlist,
  countsByFile,
  isScannable,
  rawHtmlFailed,
  renderRawHtmlSinkReport,
  scanRawHtmlSinks,
} from "../rawHtmlSinks";
import { RAW_HTML_SINK_BASELINE } from "../../../../scripts/lib/rawHtmlSinkBaseline";

const scan = (source: string, file = "src/x.tsx") => scanRawHtmlSinks([{ file, source }]);

const hits = (spec: Record<string, number>) =>
  Object.entries(spec).flatMap(([file, n]) =>
    Array.from({ length: n }, (_, i) => ({ file, line: i + 1, snippet: "<div …/>" })),
  );

const lista = (spec: Record<string, [number, string]>) =>
  new Map(Object.entries(spec).map(([file, [sites, why]]) => [file, { sites, why }]));

/** Uzasadnienie prawdziwej długości - krótsze bramka odrzuca z definicji. */
const POWOD = "sanitizeHtml na treści z edytora, przed wstawieniem";

describe("skan", () => {
  it("łapie ujście w JSX i podaje linię oraz fragment kodu", () => {
    const [hit] = scan("<div dangerouslySetInnerHTML={{ __html: x }} />");
    expect(hit.line).toBe(1);
    expect(hit.snippet).toContain("dangerouslySetInnerHTML");
  });

  it("NIE liczy własnej dokumentacji - komentarze są maskowane", () => {
    // Test NOŚNY, nie kosmetyczny: surowy grep po repo daje 132 trafienia,
    // z czego ~37 to wzmianki w komentarzach (to repozytorium opisuje tę
    // dyscyplinę prozą w kilkunastu modułach naraz). Bramka licząca komentarze
    // żądałaby wpisów dla plików bez ani jednego ujścia, a „naprawą" byłoby
    // skreślenie zdania, które tłumaczyło, czego bramka pilnuje - dokładnie ten
    // wypadek opisuje nagłówek `src/lib/ci/sourceScan.ts`.
    expect(scan("// tu jest dangerouslySetInnerHTML")).toHaveLength(0);
    expect(scan("/* dangerouslySetInnerHTML */")).toHaveLength(0);
  });

  it("liczy ujście w napisie, bo napis to treść, nie komentarz", () => {
    // Kontrakt `bezKomentarzy` celowo NIE rusza napisów. Pinujemy to, żeby
    // nikt tego później nie „naprawił": literał trafia do kodu, komentarz nie.
    expect(scan('const s = "dangerouslySetInnerHTML";')).toHaveLength(1);
  });

  it("numeruje linie od jedynki i nie przesuwa ich przez komentarz blokowy", () => {
    const source = [
      "/*",
      " * dangerouslySetInnerHTML w prozie",
      " */",
      "<div dangerouslySetInnerHTML={{ __html: x }} />",
    ].join("\n");
    const found = scan(source);
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(4);
  });

  it("liczy wiele ujść w jednym pliku", () => {
    // `blocks/renderer/atoms.tsx` ma ich dziewięć - licznik per plik musi je
    // widzieć wszystkie, inaczej dziesiąte byłoby niewidzialne.
    const source = Array.from(
      { length: 3 },
      (_, i) => `<div id="${i}" dangerouslySetInnerHTML={{ __html: x }} />`,
    ).join("\n");
    expect(scan(source)).toHaveLength(3);
  });

  it("pomija testy i fixture'y, bierze produkcję", () => {
    expect(isScannable("src/components/X.tsx")).toBe(true);
    expect(isScannable("src/components/__tests__/X.test.tsx")).toBe(false);
    expect(isScannable("src/x.test.ts")).toBe(false);
    expect(isScannable("src/x.css")).toBe(false);
    expect(isScannable("src/lib/ci/rawHtmlSinks.ts")).toBe(false);
  });
});

describe("allowlista", () => {
  it("nowy plik z ujściem oblewa - nowy kod nie może zacząć bez uzasadnienia", () => {
    const report = compareWithAllowlist(hits({ "src/new.tsx": 1 }), new Map());
    expect(report.fresh).toHaveLength(1);
    expect(rawHtmlFailed(report)).toBe(true);
  });

  it("wzrost w znanym pliku oblewa - dziewięć ujść nie może cicho stać się dziesięcioma", () => {
    const report = compareWithAllowlist(
      hits({ "src/a.tsx": 10 }),
      lista({ "src/a.tsx": [9, "treść z pre-passu fnHtml, sanitize w precomputeFootnotes"] }),
    );
    expect(report.grown).toEqual([{ file: "src/a.tsx", was: 9, now: 10 }]);
    expect(rawHtmlFailed(report)).toBe(true);
  });

  it("puste uzasadnienie oblewa", () => {
    const report = compareWithAllowlist(
      hits({ "src/a.tsx": 1 }),
      lista({ "src/a.tsx": [1, "   "] }),
    );
    expect(report.unjustified).toEqual(["src/a.tsx"]);
    expect(rawHtmlFailed(report)).toBe(true);
  });

  it("uzasadnienie-zaślepka oblewa", () => {
    // Bez tego pole `why` jest ozdobą, a lista - zwykłym ratchetem. Zaślepkę
    // odrzucamy także wtedy, gdy jest długa („TODO: dopisać, jak wrócę").
    expect(
      rawHtmlFailed(
        compareWithAllowlist(hits({ "src/a.tsx": 1 }), lista({ "src/a.tsx": [1, "TODO"] })),
      ),
    ).toBe(true);
    expect(
      rawHtmlFailed(
        compareWithAllowlist(
          hits({ "src/a.tsx": 1 }),
          lista({ "src/a.tsx": [1, "TODO: dopisać uzasadnienie przy najbliższej okazji"] }),
        ),
      ),
    ).toBe(true);
  });

  it("spadek NIE oblewa - drobne porządki nie wymagają edycji listy", () => {
    const report = compareWithAllowlist(
      hits({ "src/a.tsx": 1 }),
      lista({ "src/a.tsx": [2, POWOD] }),
    );
    expect(rawHtmlFailed(report)).toBe(false);
    expect(report.improved).toEqual([{ file: "src/a.tsx", was: 2, now: 1 }]);
  });

  it("plik wyczyszczony do zera to poprawa, nie błąd, ale trafia na listę przeterminowanych", () => {
    const report = compareWithAllowlist(
      [],
      lista({ "src/a.tsx": [2, POWOD], "src/b.tsx": [1, POWOD] }),
    );
    expect(report.improved).toContainEqual({ file: "src/a.tsx", was: 2, now: 0 });
    expect(report.stale).toContain("src/a.tsx");
    // Zero ujść w CAŁYM skanie to osobny, cięższy przypadek - tu liczy się
    // wyłącznie to, że sprzątnięcie pliku nie jest naruszeniem.
    expect(report.fresh).toHaveLength(0);
    expect(report.grown).toHaveLength(0);
    expect(report.unjustified).toHaveLength(0);
  });

  it("stan bez zmian przechodzi cicho", () => {
    const report = compareWithAllowlist(
      hits({ "src/a.tsx": 2 }),
      lista({ "src/a.tsx": [2, POWOD] }),
    );
    expect(rawHtmlFailed(report)).toBe(false);
    expect(renderRawHtmlSinkReport(report, 1)).toContain("OK");
  });

  it("ZERO ZNALEZIONYCH UJŚĆ OBLEWA - zepsuty skan wygląda jak czyste repozytorium", () => {
    // Jedyny tryb awarii tej bramki, który jest CICHO ZIELONY: skaner, który
    // przestał dopasowywać (przeniesiony katalog, zmieniony wzorzec, maskowanie
    // zjadające plik), raportuje brak naruszeń. Ta sama reguła co
    // `gateCoverageFailed` na `totalGates === 0`.
    const report = compareWithAllowlist([], new Map());
    expect(report.total).toBe(0);
    expect(rawHtmlFailed(report)).toBe(true);
    expect(renderRawHtmlSinkReport(report, 0)).toContain("zepsuty skan");
  });

  it("raport nowego ujścia podaje cztery znane lekarstwa, nie samą liczbę", () => {
    const report = compareWithAllowlist(hits({ "src/new.tsx": 1 }), new Map());
    const rendered = renderRawHtmlSinkReport(report, 0);
    expect(rendered).toContain("sanitizeHtml");
    expect(rendered).toContain("hardenStyleCss");
    expect(rendered).toContain("safeJsonLd");
    expect(rendered).toContain("węzeł");
  });

  it("liczy wystąpienia per plik", () => {
    expect(countsByFile(hits({ "src/a.tsx": 2, "src/b.tsx": 1 }))).toEqual(
      new Map([
        ["src/a.tsx", 2],
        ["src/b.tsx", 1],
      ]),
    );
  });
});

describe("inwariant repozytorium", () => {
  const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);

  const walk = (dir: string, out: string[]): string[] => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  };

  const realneUjscia = () =>
    scanRawHtmlSinks(
      walk(join(process.cwd(), "src"), [])
        .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
        .filter(isScannable)
        .map((file) => ({ file, source: readFileSync(file, "utf8") })),
    );

  it("lista pokrywa realne źródło co do pliku i co do liczby", () => {
    // Bez tego testu lista i repozytorium mogą się rozjechać cicho: runner
    // czyta listę, a nikt nie czyta runnera. Dlatego listę REGENERUJE się
    // (`--print-baseline`), a nie dopisuje ręcznie.
    const zmierzone = countsByFile(realneUjscia());
    const zlisty = new Map(
      Object.entries(RAW_HTML_SINK_BASELINE).map(([file, entry]) => [file, entry.sites]),
    );
    expect(Object.fromEntries([...zmierzone].sort())).toEqual(
      Object.fromEntries([...zlisty].sort()),
    );
  });

  it("zmierzony stan to 84 ujścia w 56 plikach", () => {
    const ujscia = realneUjscia();
    expect(ujscia).toHaveLength(84);
    expect(countsByFile(ujscia).size).toBe(56);
  });

  it("bramka na realnym źródle jest zielona i każdy wpis niesie uzasadnienie", () => {
    const report = compareWithAllowlist(
      realneUjscia(),
      new Map(Object.entries(RAW_HTML_SINK_BASELINE)),
    );
    expect(report.fresh).toEqual([]);
    expect(report.grown).toEqual([]);
    expect(report.unjustified).toEqual([]);
    expect(report.stale).toEqual([]);
    expect(rawHtmlFailed(report)).toBe(false);
  });
});
