// @vitest-environment node
// Importer rejestru benchmarków (`scripts/benchmarks/import-benchmarks.ts`).
//
// Fikstury `fixtures/mini.*.json` odtwarzają w miniaturze każdy defekt materiału
// badaczy, który importer ma naprawić albo odrzucić (brief 05 §3): zduplikowane
// `arpu` w dwóch grupach (D1), ten sam raport pod różnymi id i z `www.` (D2),
// kolizja lokalnego `S100` w dwóch grupach, źródło użyte tylko w zastrzeżeniu
// (D3), pasma zapisane malejąco (D5), etykieta z kwalifikatorem i brak noty EN.
// Ostatni blok przepuszcza przez importer PRAWDZIWE dane grup przychód,
// retencja i ekonomika - to jednocześnie walidacja nakładek redakcyjnych.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BenchmarkImportError,
  buildRegistry,
  generateFiles,
  normalizeSourceUrl,
  readGroupInputs,
  renderIndexModule,
  runCli,
  type GroupInput,
  type Overlay,
  type RawGroup,
  type Registry,
} from "../../../../../../scripts/benchmarks/import-benchmarks";

// Ścieżki od katalogu roboczego (korzeń repo), nie od `import.meta.url` -
// konwencja `src/lib/__tests__/sanitizeEngineGuard.test.ts`.
const FIXTURES = path.resolve("src/lib/analytics/semantic/benchmarks/__tests__/fixtures");
const DOCS = path.resolve("docs/benchmarki/2026-10-18");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
}

/** Świeża (głęboka) kopia wejść - każdy test psuje własną. */
function miniInputs(): GroupInput[] {
  return [
    {
      file: "przychod",
      data: fixture("mini.przychod.json"),
      overlay: fixture("mini.przychod.overlay.json"),
    },
    {
      file: "ekonomika",
      data: fixture("mini.ekonomika.json"),
      overlay: fixture("mini.ekonomika.overlay.json"),
    },
  ];
}

/** Kopia nakładki z poprawką testu - fikstura na dysku zostaje nietknięta. */
function withOverlay(input: GroupInput, edit: (o: Overlay) => void): GroupInput {
  const doc: Overlay = JSON.parse(JSON.stringify(input.overlay));
  edit(doc);
  return { ...input, overlay: doc };
}

/** Kopia danych badaczy z poprawką testu. */
function withData(input: GroupInput, edit: (d: RawGroup) => void): GroupInput {
  const doc: RawGroup = JSON.parse(JSON.stringify(input.data));
  edit(doc);
  return { ...input, data: doc };
}

function problemsOf(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof BenchmarkImportError) return e.problems;
    throw e;
  }
  throw new Error("oczekiwano BenchmarkImportError");
}

function entry(registry: Registry, group: "revenue" | "retention" | "economics", key: string) {
  const found = registry.benchmarks.get(group)?.find((e) => e.key === key);
  if (!found) throw new Error(`brak ${group}.${key}`);
  return found;
}

describe("normalizeSourceUrl (D2)", () => {
  it("host małymi literami, bez www., końcowego ukośnika, utm_* i fragmentu", () => {
    expect(normalizeSourceUrl("https://www.Example.com/report/")).toBe(
      "https://example.com/report",
    );
    expect(normalizeSourceUrl("https://example.org/b?utm_source=nl&id=7&utm_medium=x")).toBe(
      "https://example.org/b?id=7",
    );
    expect(normalizeSourceUrl("https://example.org/c#wyniki")).toBe("https://example.org/c");
    expect(normalizeSourceUrl("https://mathereconomics.com/q1-2026/")).toBe(
      normalizeSourceUrl("https://www.mathereconomics.com/q1-2026"),
    );
  });

  it("ścieżka zachowuje wielkość liter (to inny zasób)", () => {
    expect(normalizeSourceUrl("https://example.com/Report")).not.toBe(
      normalizeSourceUrl("https://example.com/report"),
    );
  });
});

describe("buildRegistry - fikstury defektów materiału", () => {
  it("D1: scala ekonomika.arpu do przychód.arpu z VAT per kontekst i skalą groszy", () => {
    const r = buildRegistry(miniInputs());
    const arpu = entry(r, "revenue", "arpu");
    expect(arpu.contexts.map((c) => [c.id, c.vat])).toEqual([
      ["arpu.b2c_pl_net", "net"],
      ["arpu.b2c_pl_gross", "gross"],
    ]);
    expect(arpu.caveats.map((c) => c.text.pl)).toEqual([
      "Szacunek jest niepewny.",
      "Kwoty brutto wymagają przeliczenia na netto.",
    ]);
    // Grosze: 8 zł → 800, otwarte końce zostają null.
    expect(arpu.contexts[0].bands.map((b) => [b.min, b.max])).toEqual([
      [null, 800],
      [800, 1200],
      [1200, 1800],
      [1800, 2500],
      [2500, null],
    ]);
    expect(r.benchmarks.get("economics")?.map((e) => e.key)).toEqual(["rule_of_40"]);
    expect(r.contributors.get("revenue")).toEqual(["przychod", "ekonomika"]);
    expect(r.stats.entries).toBe(4);
  });

  it("D2: ten sam raport z www. i ukośnikiem to jeden wpis kanoniczny z aliasami", () => {
    const r = buildRegistry(miniInputs());
    const report = r.sources.find((s) => s.aliases.includes("przychod:S1"));
    expect(report).toMatchObject({
      // Pierwszy slug nie-S<n> wygrywa z S1 (canonical bez nakładki).
      id: "slug_b",
      aliases: ["przychod:S1", "ekonomika:slug_b"],
      // Wiarygodność najniższa z aliasów, dostawca = OR, weryfikacja pełna, gdy którykolwiek „tak”.
      reliability: "B",
      vendor: true,
      verification: "full",
      url: "https://www.Example.com/report/",
      accessed: "2026-10-18",
    });
    expect(entry(r, "revenue", "arpu").contexts[0].sourceIds).toEqual(["slug_b"]);
    // Ten sam wpis kanoniczny w kontekście scalonym nie dubluje się.
    expect(entry(r, "revenue", "arpu").contexts[1].sourceIds).toEqual(["ekonomika_s100", "slug_b"]);
  });

  it("kolizja lokalnego S100 w dwóch grupach: dwa różne wpisy kanoniczne, nigdy S<n>", () => {
    const r = buildRegistry(miniInputs());
    const s100 = r.sources.filter((s) => s.aliases.some((a) => a.endsWith(":S100")));
    expect(s100.map((s) => [s.id, s.aliases])).toEqual([
      ["vendor_b_2026", ["przychod:S100"]],
      ["ekonomika_s100", ["ekonomika:S100"]],
    ]);
    expect(r.sources.every((s) => !/^S\d+$/i.test(s.id))).toBe(true);
    expect(new Set(r.sources.map((s) => normalizeSourceUrl(s.url))).size).toBe(r.sources.length);
  });

  it("D9: „nie da się sprawdzić” = fragment z wyszukiwarki i wiarygodność C mimo nakładki", () => {
    const r = buildRegistry(miniInputs());
    expect(r.sources.find((s) => s.id === "slug_a")).toMatchObject({
      reliability: "C",
      verification: "snippet",
    });
    expect(r.sources.find((s) => s.id === "vendor_b_2026")).toMatchObject({
      verification: "snippet",
    });
  });

  it("D3: źródło przypięte tylko w zastrzeżeniu trafia do caveat.sourceIds", () => {
    const r = buildRegistry(miniInputs());
    expect(entry(r, "revenue", "arpu").caveats[0].sourceIds).toEqual(["firm_d_2017"]);
  });

  it("D3: źródło nieużyte (sierota) jest błędem", () => {
    const [przychod, ekonomika] = miniInputs();
    const broken = withOverlay(przychod, (o) => {
      delete o.metrics.arpu.caveat_sources;
    });
    const problems = problemsOf(() => buildRegistry([broken, ekonomika]));
    expect(problems.some((p) => p.includes("przychod.sources.S2") && p.includes("D3"))).toBe(true);
  });

  it("D3: drop_reason usuwa sierotę z rejestru, ale nie wolno go użyć", () => {
    const [przychod, ekonomika] = miniInputs();
    const dropped = withOverlay(przychod, (o) => {
      delete o.metrics.arpu.caveat_sources;
      o.sources.S2.drop_reason = "nieużywane";
    });
    const r = buildRegistry([dropped, ekonomika]);
    expect(r.sources.some((s) => s.aliases.includes("przychod:S2"))).toBe(false);
    expect(r.stats.droppedSources).toBe(1);

    const usedDropped = withOverlay(przychod, (o) => {
      o.sources.S2.drop_reason = "nieużywane";
    });
    expect(problemsOf(() => buildRegistry([usedDropped, ekonomika])).join("\n")).toContain(
      "drop_reason",
    );
  });

  it("D5: pasma zapisane malejąco są sortowane, noty idą za pasmem, kierunek lower", () => {
    const r = buildRegistry(miniInputs());
    const ctx = entry(r, "revenue", "average_discount").contexts[0];
    expect(ctx.bands.map((b) => [b.tier, b.min, b.max])).toEqual([
      ["optimal", 0, 15],
      ["good", 15, 25],
      ["normal", 25, 35],
      ["weak", 35, 50],
      ["critical", 50, null],
    ]);
    // Nota pasma „krytyczny” (indeks 0 w źródle) zostaje przy nim po sortowaniu,
    // a słowo „heurystyka” w nocie daje podstawę E.
    expect(ctx.bands[4]).toMatchObject({
      note: { pl: "heurystyka: głębokie rabaty", en: "heuristic: deep discounts" },
      basis: "E",
    });
    expect(ctx.bands[0].basis).toBe("B");
    expect(ctx.direction).toBe("lower");
  });

  it("D5: przerwa między pasmami jest błędem", () => {
    const [przychod, ekonomika] = miniInputs();
    const gap = withData(przychod, (d) => {
      d.metrics[1].contexts[0].bands[1].min = 36;
    });
    expect(problemsOf(() => buildRegistry([gap, ekonomika])).join("\n")).toContain("przerwa");
  });

  it("kwalifikator etykiety → poziom „słaby” + nota PL z kwalifikatorem i EN z nakładki", () => {
    const r = buildRegistry(miniInputs());
    const ctx = entry(r, "revenue", "annual_plan_share").contexts[0];
    expect(ctx.bands[0]).toMatchObject({
      tier: "weak",
      note: { pl: "za mało rocznych", en: "too few annual plans" },
    });
    expect(ctx.bands[4]).toMatchObject({
      tier: "weak",
      note: { pl: "zbyt szczelnie; sprawdź ARPU", en: "too tight; check ARPU" },
    });
    expect(ctx.direction).toBe("range");
  });

  it("brak notes_en dla pasma z notą jest błędem (parytet PL/EN)", () => {
    const [przychod, ekonomika] = miniInputs();
    const broken = withOverlay(przychod, (o) => {
      const notes = o.metrics.arpu.contexts[0].notes_en;
      if (notes) delete notes["3"];
    });
    const problems = problemsOf(() => buildRegistry([broken, ekonomika]));
    expect(problems).toContain(
      "przychod.arpu.contexts[0].bands[3]: pasmo z notą lub kwalifikatorem wymaga notes_en",
    );
  });

  it("D4: kierunek w nakładce sprzeczny z pasmami jest błędem", () => {
    const [przychod, ekonomika] = miniInputs();
    const broken = withOverlay(przychod, (o) => {
      o.metrics.average_discount.contexts[0].direction = "higher";
    });
    expect(problemsOf(() => buildRegistry([broken, ekonomika])).join("\n")).toContain("(D4)");
  });

  it("D6-D7: kontekst pieniężny wymaga waluty i VAT, procent przy kwocie nie jest poziomem", () => {
    const [przychod, ekonomika] = miniInputs();
    const noVat = withOverlay(przychod, (o) => {
      delete o.metrics.arpu.contexts[0].vat;
    });
    expect(problemsOf(() => buildRegistry([noVat, ekonomika])).join("\n")).toContain(
      "currency i vat",
    );
    const pctLevel = withOverlay(przychod, (o) => {
      const c = o.metrics.arpu.contexts[0];
      c.unit = "percent_pt";
      delete c.currency;
      delete c.vat;
    });
    expect(problemsOf(() => buildRegistry([pctLevel, ekonomika])).join("\n")).toContain("(D6)");
  });

  it("D8: okres jednoznaczny musi zgadzać się z oknem", () => {
    const [przychod, ekonomika] = miniInputs();
    const broken = withOverlay(przychod, (o) => {
      o.metrics.arpu.contexts[0].window = "quarter";
    });
    expect(problemsOf(() => buildRegistry([broken, ekonomika])).join("\n")).toContain("(D8)");
  });

  it("D10: zdublowany skrót jest błędem", () => {
    const [przychod, ekonomika] = miniInputs();
    const broken = withOverlay(przychod, (o) => {
      o.metrics.average_discount.abbr = "aps";
    });
    expect(problemsOf(() => buildRegistry([broken, ekonomika])).join("\n")).toContain("(D10)");
  });

  it("D11: więcej niż 12 źródeł w kontekście jest błędem", () => {
    const [przychod, ekonomika] = miniInputs();
    const ids = Array.from({ length: 13 }, (_, i) => `x${i}`);
    const many = withOverlay(
      withData(przychod, (d) => {
        d.metrics[0].contexts[0].source_ids = ids;
        for (const id of ids) {
          d.sources.push({
            id,
            title: id,
            publisher: "P",
            published: "2025",
            url: `https://example.org/${id}`,
            excerpt: "",
            verification: "tak",
          });
        }
      }),
      (o) => {
        for (const id of ids) o.sources[id] = { reliability: "B" };
        // S1 przestaje być użyte w kontekście - przypinamy je do zastrzeżenia.
        o.metrics.arpu.caveat_sources = { "0": ["S2", "S1"] };
      },
    );
    expect(problemsOf(() => buildRegistry([many, ekonomika])).join("\n")).toContain("D11)");
  });

  it("metric_id spoza słownika metryk, null bez powodu i primary przy jedynym wpisie są błędami", () => {
    const [przychod, ekonomika] = miniInputs();
    expect(
      problemsOf(() => buildRegistry(miniInputs(), { knownMetricIds: new Set(["arpu"]) })).join(
        "\n",
      ),
    ).toContain("„average_discount” nie istnieje");
    const nullNoReason = withOverlay(przychod, (o) => {
      o.metrics.average_discount.metric_id = null;
    });
    expect(problemsOf(() => buildRegistry([nullNoReason, ekonomika])).join("\n")).toContain(
      "no_metric_reason",
    );
    const lonePrimary = withOverlay(przychod, (o) => {
      o.metrics.arpu.primary = true;
    });
    expect(problemsOf(() => buildRegistry([lonePrimary, ekonomika])).join("\n")).toContain(
      "primary",
    );
  });

  it("wpis bez metryki niesie powód, a indeks - pary i daty przeglądu", () => {
    const [przychod, ekonomika] = miniInputs();
    const noMetric = withOverlay(przychod, (o) => {
      o.metrics.average_discount.metric_id = null;
      o.metrics.average_discount.no_metric_reason = { pl: "Brak danych.", en: "No data." };
    });
    const r = buildRegistry([noMetric, ekonomika]);
    expect(entry(r, "revenue", "average_discount")).toMatchObject({
      noMetricReason: { pl: "Brak danych.", en: "No data." },
    });
    expect(entry(r, "revenue", "average_discount").metricId).toBeUndefined();
    expect(r.pairs).toEqual({ annual_plan_share: ["arpu"] });
    // Pewność niska: przegląd po 6 mies.; nadpisanie z nakładki wygrywa.
    expect(entry(r, "revenue", "arpu").reviewBy).toBe("2027-04-18");
    expect(entry(r, "revenue", "annual_plan_share").reviewBy).toBe("2027-10-18");
    expect(entry(r, "economics", "rule_of_40").reviewBy).toBe("2027-01-31");
    // Metoda dostaje okres w obu językach.
    expect(entry(r, "economics", "rule_of_40").contexts[0].method).toEqual({
      pl: "kwartyle źródła. Okres: rocznie (CY-2025).",
      en: "source quartiles. Period: annually (CY-2025).",
    });
  });
});

describe("generacja modułów i --check", () => {
  let tmp: string | null = null;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it("moduły niosą nagłówek PLIK GENEROWANY, SHA-256 wejść i szablon indeksu", async () => {
    const r = buildRegistry(miniInputs());
    const files = await generateFiles(r, FIXTURES);
    const revenue =
      files.get("src/lib/analytics/semantic/benchmarks/groups/revenue.server.ts") ?? "";
    expect(revenue).toMatch(
      /^\/\/ PLIK GENEROWANY przez scripts\/benchmarks\/import-benchmarks\.ts/,
    );
    expect(revenue).toMatch(/SHA-256 treści kanonicznej wejść: [0-9a-f]{64}/);
    expect(revenue).toContain("export const REVENUE_BENCHMARKS: readonly GeneratedBenchmark[] = [");
    const sources = files.get("src/lib/analytics/semantic/benchmarks/sources.ts") ?? "";
    expect(sources).toContain("export function canonicalSourceId(alias: string)");
    const index = renderIndexModule(r, { inputs: [], sha256: "0".repeat(64) });
    for (const name of [
      "BENCH_GROUPS",
      "BENCHMARK_REGISTRY_AS_OF",
      "BENCHMARK_INDEX",
      "BENCHMARK_PAIRS",
      "benchmarkIndexEntry",
      "benchmarksForMetric",
      "primaryBenchmarkFor",
    ]) {
      expect(index).toContain(name);
    }
    // Indeks klienta nie niesie treści: ani metod, ani cytatów.
    expect(index).not.toContain("excerpt");
    expect(index).not.toContain("Cytat");
  });

  it("--check: zgodność po zapisie, kod 1 przy ręcznej edycji wygenerowanego pliku", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "bench-import-"));
    const data = path.join(tmp, "dane");
    const out = path.join(tmp, "repo");
    // Katalog danych w układzie importera: <grupa>.json + <grupa>.overlay.json.
    mkdirSync(data, { recursive: true });
    for (const g of ["przychod", "ekonomika"]) {
      writeFileSync(
        path.join(data, `${g}.json`),
        readFileSync(path.join(FIXTURES, `mini.${g}.json`)),
      );
      writeFileSync(
        path.join(data, `${g}.overlay.json`),
        readFileSync(path.join(FIXTURES, `mini.${g}.overlay.json`)),
      );
    }
    const log: string[] = [];
    const io = {
      log: (l: string) => log.push(l),
      error: (l: string) => log.push(`E ${l}`),
      cwd: tmp,
      knownMetricIds: new Set(["arpu", "average_discount", "annual_plan_share", "rule_of_40"]),
    };
    const args = [data, "--groups", "przychod,ekonomika", "--out", out];
    expect(await runCli(args, io)).toBe(0);
    expect(await runCli([...args, "--check"], io)).toBe(0);

    const target = path.join(out, "src/lib/analytics/semantic/benchmarks/groups/revenue.server.ts");
    writeFileSync(target, `${readFileSync(target, "utf8")}\n// ręczna poprawka\n`);
    expect(await runCli([...args, "--check"], io)).toBe(1);
    expect(
      log.some((l) =>
        l.startsWith("E dryf: src/lib/analytics/semantic/benchmarks/groups/revenue.server.ts"),
      ),
    ).toBe(true);

    // Błąd walidacji też kończy się kodem 1, nieznana opcja - kodem 2.
    writeFileSync(path.join(data, "przychod.overlay.json"), "{}");
    expect(await runCli([...args, "--check"], io)).toBe(1);
    expect(await runCli([data, "--bez-sensu"], io)).toBe(2);
  });
});

describe("prawdziwe dane: przychód, retencja, ekonomika (nakładki redakcyjne)", () => {
  const registry = buildRegistry(readGroupInputs(DOCS, ["przychod", "retencja", "ekonomika"]));

  it("statystyki importu: 32 wpisy (arpu scalone), 87 kontekstów, źródła kanoniczne z aliasami", () => {
    expect(registry.stats).toMatchObject({ entries: 32, contexts: 87, droppedSources: 2 });
    expect(registry.stats.aliases).toBe(94);
    expect(registry.stats.canonicalSources).toBe(registry.sources.length);
    expect(registry.groups).toEqual(["revenue", "retention", "economics"]);
  });

  it("wymagane konteksty churnu M↔R istnieją (testy spójności T4)", () => {
    const ids = new Set(
      [...registry.benchmarks.values()].flat().flatMap((e) => e.contexts.map((c) => c.id)),
    );
    for (const slug of ["news_b2c", "b2b_smb", "b2b_mid_market", "b2b_enterprise", "membership"]) {
      expect(ids.has(`logo_churn_monthly.${slug}`)).toBe(true);
    }
    for (const slug of [
      "news_b2c_all",
      "b2b_smb",
      "b2b_mid_market",
      "b2b_enterprise",
      "membership",
    ]) {
      expect(ids.has(`logo_churn_annual.${slug}`)).toBe(true);
    }
  });

  it("każdy wpis: dźwignie PL/EN ≤ 600 znaków, parytet zastrzeżeń, EN bez polskich liter (nazwy własne transliterowane)", () => {
    for (const e of [...registry.benchmarks.values()].flat()) {
      expect(e.levers.pl.length).toBeGreaterThan(80);
      expect(e.levers.en.length).toBeLessThanOrEqual(600);
      expect(e.levers.pl.length).toBeLessThanOrEqual(600);
      expect(e.formula.en).not.toBe("");
      for (const c of e.caveats) expect(c.text.en).not.toBe("");
      for (const c of e.contexts) {
        expect(c.label.en).not.toBe("");
        expect(c.method.en).toMatch(/Period: .+\.$/);
        for (const b of c.bands) if (b.note) expect(b.note.en).not.toBe("");
      }
    }
    const polishInEn = registry.warnings.filter((w) => w.includes("polskie znaki"));
    // Bez wyjątków - test parytetu rejestru (T4) nie ma listy wyjątków, więc
    // nazwy własne w EN są transliterowane jak w prasie anglojęzycznej
    // („Radio Nowy Swiat” w metodzie ARPU brutto).
    expect(polishInEn).toEqual([]);
    expect(registry.warnings.filter((w) => w.includes("Tailwinda"))).toEqual([]);
  });

  it("dźwignie retencji nie proponują utrudniania rezygnacji (DSA art. 25, UOKiK)", () => {
    for (const e of registry.benchmarks.get("retention") ?? []) {
      // Dźwignia może mówić o rezygnacji tylko jako o prostej, jawnej ścieżce.
      expect(e.levers.pl).not.toMatch(
        /utrudni(aj|j|ć|aniu)\s+(rezygnac|anulowan)|ukryj\s+(przycisk|rezygnac)/i,
      );
      expect(e.levers.en).not.toMatch(
        /\b(hide|bury|remove)\s+(the\s+)?cancel|harder\s+to\s+cancel|block\s+cancell?ation/i,
      );
      if (/rezygnac/i.test(e.levers.pl) && /pauz|tańsz/i.test(e.levers.pl)) {
        // Propozycja zatrzymania obok rezygnacji = zawsze z jawną podstawą prawną.
        expect(e.levers.pl).toMatch(/DSA|UOKiK/);
      }
    }
  });

  it("konteksty: posortowane i ciągłe pasma, ≤ 12 źródeł, domyślny kontekst „all” wszędzie", () => {
    for (const e of [...registry.benchmarks.values()].flat()) {
      expect(e.defaultContextBySegment.all).toBeTruthy();
      for (const c of e.contexts) {
        expect(c.sourceIds.length).toBeGreaterThan(0);
        expect(c.sourceIds.length).toBeLessThanOrEqual(12);
        c.bands.forEach((b, i) => {
          if (i > 0) expect(b.min).toBe(c.bands[i - 1].max);
        });
        if (c.unit === "money_minor") expect(c.currency && c.vat).toBeTruthy();
      }
    }
  });

  it("pary obowiązkowe: QR ↔ churn brutto, LTV/CAC → ARPU/churn/marża/CAC, save rate → ARPU", () => {
    expect(registry.pairs).toMatchObject({
      saas_quick_ratio: ["gross_revenue_churn"],
      gross_revenue_churn: ["saas_quick_ratio"],
      ltv_cac_ratio: ["arpu", "logo_churn_monthly", "subscription_gross_margin", "cac"],
      cancellation_save_rate: ["arpu"],
    });
  });

  it("źródła: jeden wpis na znormalizowany URL, wspólne raporty grup pod jednym id", () => {
    const byAlias = (alias: string) => registry.sources.find((s) => s.aliases.includes(alias))?.id;
    expect(byAlias("przychod:S105")).toBe("dnr_2026_poland");
    expect(byAlias("retencja:dnr_2026_poland")).toBe("dnr_2026_poland");
    expect(byAlias("ekonomika:risj_dnr2026_pl")).toBe("dnr_2026_poland");
    expect(byAlias("przychod:S10")).toBe("bm2025");
    expect(byAlias("przychod:S104")).toBe("mather_q1_2026");
    expect(registry.sources.find((s) => s.id === "mather_q1_2026")).toMatchObject({
      reliability: "C",
      verification: "snippet",
    });
    expect(new Set(registry.sources.map((s) => normalizeSourceUrl(s.url))).size).toBe(
      registry.sources.length,
    );
  });
});
