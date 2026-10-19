// @vitest-environment node
// Adapter benchmarków: lokalizacja treści na serwerze (jeden język, bez
// cytatów źródeł), przejście do typów wykresów (`ChartMetric`, przypisy
// Chicago) i formatowanie progów przez `Intl`. Treść bierzemy z prawdziwego
// importu grupy retencja - test przypina kształt, który dostanie klient.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chicagoBibliographyText, MAX_CHART_SOURCES } from "@/lib/charts/sources";
import {
  buildRegistry,
  readGroupInputs,
  type RegistryBenchmark,
} from "../../../../../../scripts/benchmarks/import-benchmarks";
import {
  STALE_SOURCE_MONTHS,
  ageMonths,
  bi,
  buildGroupPayload,
  citationsFor,
  formatBenchValue,
  localizeBenchmark,
  localizeSource,
  toBandsView,
  toChartMetric,
  toChartSource,
  type GeneratedBenchmark,
  type LocalizedContext,
  type LocalizedSource,
} from "../adapter";
import type { BenchSource } from "../types";

const registry = buildRegistry(
  readGroupInputs(path.resolve("docs/benchmarki/2026-10-18"), [
    "przychod",
    "retencja",
    "ekonomika",
  ]),
);

/** Wpis z importu jako `GeneratedBenchmark` - bez `metricId` (zawężenie daje kompilacja modułu). */
function generated(group: "revenue" | "retention" | "economics", key: string): GeneratedBenchmark {
  const found: RegistryBenchmark | undefined = registry.benchmarks
    .get(group)
    ?.find((e) => e.key === key);
  if (!found) throw new Error(`brak ${key}`);
  const { metricId: _metricId, ...rest } = found;
  return rest;
}

const sourceById = (id: string): BenchSource | undefined =>
  registry.sources.find((s) => s.id === id);

function source(id: string): BenchSource {
  const found = sourceById(id);
  if (!found) throw new Error(`brak źródła ${id}`);
  return found;
}

describe("bi i localizeBenchmark", () => {
  it("wybiera język danych", () => {
    expect(bi({ pl: "tak", en: "yes" }, "pl")).toBe("tak");
    expect(bi({ pl: "tak", en: "yes" }, "en")).toBe("yes");
  });

  it("zwraca wpis w jednym języku z parami i kierunkiem każdego kontekstu", () => {
    const churn = generated("retention", "logo_churn_monthly");
    const en = localizeBenchmark(churn, "en", ["logo_churn_annual"]);
    expect(en.name).toBe("Monthly logo (customer) churn rate");
    expect(en.pairs).toEqual(["logo_churn_annual"]);
    expect(en.contexts[0]).toMatchObject({
      id: "logo_churn_monthly.news_b2c",
      direction: "lower",
      unit: "percent_pt",
      window: "month",
    });
    expect(en.contexts[0].method).toMatch(/Period: monthly\.$/);
    expect(en.contexts[0].bands[0].note).toMatch(/^Mather's 'Best-in-Class' level/);
    const pl = localizeBenchmark(churn, "pl", []);
    expect(pl.contexts[0].method).toMatch(/Okres: miesięcznie\.$/);
    expect(pl.caveats[0].sourceIds).toEqual([
      "recurly_churn_benchmarks_2026",
      "recurly_docs_churn_benchmarks",
    ]);
    // Zastrzeżenie bez przypisu nie niesie pustej tablicy.
    expect(pl.caveats[3]).toEqual({ text: expect.any(String) });
  });
});

describe("buildGroupPayload - odpowiedź server fn", () => {
  const benchmarks = (registry.benchmarks.get("retention") ?? []).map((e) => {
    const { metricId: _metricId, ...rest } = e;
    return rest;
  });
  const payload = buildGroupPayload({
    group: "retention",
    lang: "en",
    asOf: "2026-10-18",
    benchmarks,
    pairs: registry.pairs,
    sourceById,
  });

  it("niesie tylko źródła cytowane przez grupę, bez cytatów (excerpt zostaje na serwerze)", () => {
    const cited = new Set(
      benchmarks.flatMap((b) => [
        ...b.contexts.flatMap((c) => c.sourceIds),
        ...b.caveats.flatMap((c) => c.sourceIds ?? []),
      ]),
    );
    expect(new Set(payload.sources.map((s) => s.id))).toEqual(cited);
    for (const s of payload.sources) expect(s).not.toHaveProperty("excerpt");
    expect(JSON.stringify(payload)).not.toContain("excerpt");
  });

  it("dokleja pary z indeksu i lokalizuje wszystkie wpisy grupy", () => {
    expect(payload.benchmarks).toHaveLength(13);
    expect(payload.benchmarks.find((b) => b.key === "gross_revenue_churn")?.pairs).toEqual([
      "saas_quick_ratio",
    ]);
    expect(payload.benchmarks.find((b) => b.key === "cohort_retention_m1")?.pairs).toEqual([]);
  });
});

describe("localizeSource i ageMonths", () => {
  const raw: BenchSource = {
    id: "mgi_2025_memberjungle",
    aliases: ["retencja:mgi_2025_memberjungle"],
    title: "The 5 lessons we learnt",
    publisher: "Member Jungle (omówienie raportu MGI)",
    published: "2026 (strona bez daty publikacji)",
    url: "https://www.memberjungle.com/blog/x",
    accessed: "2026-10-18",
    reliability: "C",
    verification: "full",
    excerpt: "cytat",
  };

  it("EN: polska adnotacja wydawcy i daty znika, nazwiska zostają", () => {
    expect(localizeSource(raw, "en", "2026-10-18")).toEqual({
      id: "mgi_2025_memberjungle",
      title: "The 5 lessons we learnt",
      publisher: "Member Jungle",
      published: "2026",
      url: "https://www.memberjungle.com/blog/x",
      accessed: "2026-10-18",
      reliability: "C",
      verification: "full",
      ageMonths: 0,
    });
    const named = {
      ...raw,
      publisher: "Wirtualnemedia.pl (Rafał Badowski)",
      published: "b.d. (dostęp 2026-10-18)",
    };
    expect(localizeSource(named, "en", "2026-10-18")).toMatchObject({
      publisher: "Wirtualnemedia.pl (Rafał Badowski)",
      published: "n.d.",
      ageMonths: null,
    });
    expect(
      localizeSource(
        { ...raw, publisher: "Media Finance Monitor (P. Erdelyi i in.)" },
        "en",
        "2026-10-18",
      ).publisher,
    ).toBe("Media Finance Monitor (P. Erdelyi et al.)");
  });

  it("PL: zapis badaczy bez zmian; vendor tylko gdy prawdziwy", () => {
    const pl = localizeSource({ ...raw, vendor: true }, "pl", "2026-10-18");
    expect(pl).toMatchObject({ publisher: raw.publisher, published: raw.published, vendor: true });
    expect(localizeSource(raw, "pl", "2026-10-18")).not.toHaveProperty("vendor");
  });

  it(`wiek z wiodącej daty; sam rok liczony jako grudzień; > ${STALE_SOURCE_MONTHS} mies. = historyczne`, () => {
    expect(ageMonths("2025-06", "2026-10-18")).toBe(16);
    expect(ageMonths("2025-03-12 (aktualizacja)", "2026-10-18")).toBe(19);
    expect(ageMonths("2025", "2026-10-18")).toBe(10);
    expect(ageMonths("2018-08-29", "2026-10-18")).toBeGreaterThan(STALE_SOURCE_MONTHS);
    expect(ageMonths("brak daty publikacji", "2026-10-18")).toBeNull();
  });
});

describe("toChartMetric, toChartSource, citationsFor", () => {
  it("mapuje wpis na ChartMetric: skrót, rozwinięcie, nazwa jako „co mierzy”, zastrzeżenia jako akapit", () => {
    const b = localizeBenchmark(generated("revenue", "saas_quick_ratio"), "pl", [
      "gross_revenue_churn",
    ]);
    const metric = toChartMetric(b);
    expect(metric).toEqual({
      name: "QR",
      expansion: b.expansion,
      formula: b.formula,
      measures: b.name,
      reading: b.interpretation,
      levers: b.levers,
      caution: b.caveats.map((c) => c.text).join(" "),
    });
    expect(metric.levers).toMatch(/churnem brutto/);
  });

  it("przypis w stylu chicagowskim: instytucja jako autor, bez powtórzenia wydawcy", () => {
    const src = localizeSource(source("saascapital_retention_2025"), "en", "2026-10-18");
    const text = chicagoBibliographyText(toChartSource(src), "en");
    expect(text).toBe(
      `SaaS Capital. 2025 B2B SaaS Retention Benchmarks (Research Brief 32). 2025-09-18. Accessed 2026-10-18. ${src.url}.`,
    );
    expect(chicagoBibliographyText(toChartSource(src), "pl")).toContain("Dostęp 2026-10-18.");
  });

  it(`cytuje tylko aktywny kontekst, w jego kolejności, najwyżej ${MAX_CHART_SOURCES}`, () => {
    const sources: LocalizedSource[] = Array.from({ length: 16 }, (_, i) => ({
      id: `s${i}`,
      title: `T${i}`,
      publisher: `P${i}`,
      published: "2026",
      url: `https://example.org/${i}`,
      accessed: "2026-10-18",
      reliability: "B",
      verification: "full",
      ageMonths: 0,
    }));
    const ids = [...sources]
      .reverse()
      .map((s) => s.id)
      .slice(0, 15);
    const cited = citationsFor({ sourceIds: ids }, sources);
    expect(cited).toHaveLength(MAX_CHART_SOURCES);
    expect(cited.map((c) => c.id)).toEqual(ids.slice(0, MAX_CHART_SOURCES));
    expect(citationsFor({ sourceIds: ["s3", "brak"] }, sources).map((c) => c.id)).toEqual(["s3"]);
  });
});

describe("formatBenchValue i toBandsView - Intl, PL i EN", () => {
  const pct: Pick<LocalizedContext, "unit"> = { unit: "percent_pt" };

  it("punkty procentowe i brak wartości", () => {
    expect(formatBenchValue(2.7, pct, "pl")).toBe("2,7%");
    expect(formatBenchValue(2.7, pct, "en")).toBe("2.7%");
    expect(formatBenchValue(null, pct, "pl")).toBe("-");
    expect(formatBenchValue(Number.NaN, pct, "en")).toBe("-");
  });

  it("kwoty z groszy według wykładnika waluty", () => {
    const pln: Pick<LocalizedContext, "unit" | "currency"> = {
      unit: "money_minor",
      currency: "PLN",
    };
    expect(formatBenchValue(1900, pln, "pl")).toBe("19 zł");
    expect(formatBenchValue(1950, pln, "pl")).toBe("19,50 zł");
    expect(formatBenchValue(1950, pln, "en")).toBe("PLN 19.50");
    expect(formatBenchValue(972, { unit: "money_minor", currency: "USD" }, "en")).toBe("US$9.72");
    expect(formatBenchValue(972, { unit: "money_minor" }, "en")).toBe("-");
  });

  it("krotności, miesiące, godziny jako minuty i dni, NPS ze znakiem", () => {
    expect(formatBenchValue(1.5, { unit: "multiple" }, "pl")).toBe("1,5×");
    expect(formatBenchValue(3, { unit: "multiple" }, "en")).toBe("3×");
    expect(formatBenchValue(10, { unit: "months" }, "en")).toBe("10 months");
    expect(formatBenchValue(10, { unit: "months" }, "pl")).toBe("10 miesięcy");
    expect(formatBenchValue(0.5, { unit: "hours", displayUnit: "minutes" }, "en")).toBe("30 mins");
    expect(formatBenchValue(48, { unit: "hours", displayUnit: "days" }, "en")).toBe("2 days");
    expect(formatBenchValue(48, { unit: "hours", displayUnit: "days" }, "pl")).toBe("2 dni");
    expect(formatBenchValue(42, { unit: "percent_pt", displayUnit: "score" }, "en")).toBe("+42");
    expect(formatBenchValue(0, { unit: "percent_pt", displayUnit: "score" }, "en")).toBe("0");
  });

  it("widok pasm: otwarte końce jako „<” i „≥”, granice sformatowane", () => {
    const ctx = localizeBenchmark(generated("retention", "logo_churn_monthly"), "pl", [])
      .contexts[0];
    expect(toBandsView(ctx, "pl").map((b) => [b.tier, b.label, b.basis])).toEqual([
      ["optimal", "< 2,7%", "B"],
      ["good", "2,7%–3,5%", "B"],
      ["normal", "3,5%–4,9%", "B"],
      ["weak", "4,9%–7%", "B"],
      ["critical", "≥ 7%", "E"],
    ]);
    expect(toBandsView(ctx, "en")[0]).toMatchObject({ from: "", to: "2.7%", label: "< 2.7%" });
  });
});
