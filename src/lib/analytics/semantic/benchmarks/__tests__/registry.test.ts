// @vitest-environment node
// REJESTR BENCHMARKÓW PO GENERACJI (karta S6, kryterium 2) - testy na
// WYGENEROWANYCH modułach `groups/*.server.ts`, `sources.ts` i `index.ts`,
// czyli na tym, co naprawdę czyta server fn i klient.
//
// PO CO OSOBNO OD TESTÓW IMPORTERA. `importer.test.ts` sprawdza reguły na
// fiksturach i trzech grupach toru T2; tu pilnujemy całości (77 wpisów,
// 194 kontekstów, 190 wpisów źródłowych; +1 w I9b - `engagement_rate`, Z-14-03) i ZGODNOŚCI PLIKÓW W REPO z danymi:
// ręczna poprawka liczby w wygenerowanym pliku albo zmiana nakładki bez
// ponownego importu zapala ostatni blok (zastępuje osobny krok CI `--check`).
//
// Każda asercja mówi, CO się zepsuje w panelu, gdy padnie: pasmo
// nieposortowane = ocena „optymalny” dla złej wartości, sierota źródła =
// przypis bez pasma, rozjazd churnu M↔R = „dobry” miesięczny i „słaby”
// roczny dla tego samego klienta.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  generateFiles,
  GROUP_FILES,
  GROUP_OF_FILE,
  normalizeSourceUrl,
  readGroupInputs,
  REPO_ROOT,
} from "../../../../../../scripts/benchmarks/import-benchmarks";
import { METRICS } from "../../metrics";
import type { GeneratedBenchmark, GeneratedContext } from "../adapter";
import { annualizeChurn, mirrorBands } from "../consistency";
import { contextDirection, tierOf } from "../evaluate";
import { COMMUNITY_BENCHMARKS } from "../groups/community.server";
import { ECONOMICS_BENCHMARKS } from "../groups/economics.server";
import { EMAIL_BENCHMARKS } from "../groups/email.server";
import { FUNNEL_BENCHMARKS } from "../groups/funnel.server";
import { RETENTION_BENCHMARKS } from "../groups/retention.server";
import { REVENUE_BENCHMARKS } from "../groups/revenue.server";
import {
  BENCH_GROUPS,
  BENCHMARK_INDEX,
  BENCHMARK_PAIRS,
  BENCHMARK_REGISTRY_AS_OF,
  benchmarkIndexEntry,
} from "../index";
import { BENCHMARK_SOURCES, canonicalSourceId, sourceById } from "../sources";
import type { BenchGroup, Tier } from "../types";

const DOCS = path.resolve("docs/benchmarki/2026-10-18");

const BY_GROUP: Readonly<Record<BenchGroup, readonly GeneratedBenchmark[]>> = {
  revenue: REVENUE_BENCHMARKS,
  retention: RETENTION_BENCHMARKS,
  economics: ECONOMICS_BENCHMARKS,
  funnel: FUNNEL_BENCHMARKS,
  email: EMAIL_BENCHMARKS,
  community: COMMUNITY_BENCHMARKS,
};
const ALL: readonly GeneratedBenchmark[] = BENCH_GROUPS.flatMap((g) => BY_GROUP[g]);
const CONTEXTS: readonly GeneratedContext[] = ALL.flatMap((b) => b.contexts);
const TIERS = ["critical", "weak", "normal", "good", "optimal"] as const satisfies readonly Tier[];
const RANK: Readonly<Record<Tier, number>> = {
  critical: 1,
  weak: 2,
  normal: 3,
  good: 4,
  optimal: 5,
};

function context(id: string): GeneratedContext {
  const found = CONTEXTS.find((c) => c.id === id);
  if (!found) throw new Error(`test: brak kontekstu ${id}`);
  return found;
}

// ---------------------------------------------------------------------------
// Surowe dane badaczy i nakładki - do kontroli źródeł i podstawy B/E.
// ---------------------------------------------------------------------------

interface RawBand {
  label: string;
  min: number | null;
  max: number | null;
  note?: string;
}
interface RawContext {
  bands: RawBand[];
}
interface RawMetric {
  key: string;
  contexts: RawContext[];
}
interface RawData {
  metrics: RawMetric[];
  sources: { id: string; url: string }[];
}
interface OverlayDoc {
  metrics: Record<string, { contexts: { id: string; basis_e?: number[] }[] }>;
  sources: Record<string, { drop_reason?: string }>;
}

function readDoc<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(DOCS, name), "utf8")) as T;
}

const RAW = GROUP_FILES.map((file) => ({
  file,
  data: readDoc<RawData>(`${file}.json`),
  overlay: readDoc<OverlayDoc>(`${file}.overlay.json`),
}));

describe("rejestr: liczność i tożsamość wpisów", () => {
  it("77 wpisów w sześciu grupach (arpu z ekonomiki scalone z przychodem)", () => {
    expect(BENCH_GROUPS).toEqual([
      "revenue",
      "retention",
      "economics",
      "funnel",
      "email",
      "community",
    ]);
    expect(Object.fromEntries(BENCH_GROUPS.map((g) => [g, BY_GROUP[g].length] as const))).toEqual({
      revenue: 12,
      retention: 13,
      economics: 7,
      funnel: 13,
      email: 18,
      community: 14,
    });
    expect(ALL).toHaveLength(77);
    expect(BENCHMARK_INDEX).toHaveLength(77);
    for (const g of BENCH_GROUPS) for (const b of BY_GROUP[g]) expect(b.group).toBe(g);
  });

  it("indeks klienta = rejestr: ten sam klucz, skrót, grupa i metryka w tej samej kolejności", () => {
    expect(BENCHMARK_INDEX.map((e) => [e.key, e.abbr, e.group, e.metricId ?? null])).toEqual(
      ALL.map((b) => [b.key, b.abbr, b.group, b.metricId ?? null]),
    );
    expect(benchmarkIndexEntry("logo_churn_monthly")?.group).toBe("retention");
    expect(benchmarkIndexEntry("nie_ma_takiego")).toBeUndefined();
  });

  it("klucze i skróty unikalne bez względu na wielkość liter", () => {
    const keys = ALL.map((b) => b.key.toLowerCase());
    const abbrs = ALL.map((b) => b.abbr.trim().toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(abbrs).size).toBe(abbrs.length);
  });

  it("skrót nie jest etykietą INNEJ metryki - ikona objaśnienia nie może wskazać dwóch wskaźników", () => {
    const clashes: string[] = [];
    for (const b of ALL) {
      const abbr = b.abbr.trim().toLowerCase();
      for (const m of METRICS) {
        if (m.id === b.metricId) continue;
        if (m.labelPl.trim().toLowerCase() === abbr || m.labelEn.trim().toLowerCase() === abbr) {
          clashes.push(`${b.key} (${b.abbr}) = etykieta ${m.id}`);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it("stan rejestru i daty przeglądu: asOf 2026-10-18, reviewBy po asOf", () => {
    expect(BENCHMARK_REGISTRY_AS_OF).toBe("2026-10-18");
    for (const b of ALL) {
      expect(b.asOf).toBe(BENCHMARK_REGISTRY_AS_OF);
      expect(b.reviewBy > b.asOf).toBe(true);
    }
  });

  it("pary obowiązkowe wskazują istniejące wpisy, nigdy siebie", () => {
    const keys = new Set(ALL.map((b) => b.key));
    for (const [key, pairs] of Object.entries(BENCHMARK_PAIRS)) {
      expect(keys.has(key)).toBe(true);
      for (const p of pairs) {
        expect(keys.has(p)).toBe(true);
        expect(p).not.toBe(key);
      }
    }
  });
});

describe("rejestr źródeł", () => {
  it("każdy przypis kontekstu i zastrzeżenia wskazuje źródło kanoniczne z rejestru", () => {
    const missing: string[] = [];
    for (const b of ALL) {
      for (const c of b.contexts) {
        for (const id of c.sourceIds) if (!sourceById(id)) missing.push(`${c.id} → ${id}`);
      }
      b.caveats.forEach((cv, i) => {
        for (const id of cv.sourceIds ?? []) {
          if (!sourceById(id)) missing.push(`${b.key}.caveats[${i}] → ${id}`);
        }
      });
    }
    expect(missing).toEqual([]);
  });

  it("adresy https, unikalne po normalizacji; identyfikatory opisowe, nigdy lokalne S<n>", () => {
    for (const s of BENCHMARK_SOURCES) {
      expect(s.url.startsWith("https://"), s.id).toBe(true);
      expect(s.id).not.toMatch(/^S\d+$/);
      expect(s.accessed).toBe(BENCHMARK_REGISTRY_AS_OF);
    }
    const urls = BENCHMARK_SOURCES.map((s) => normalizeSourceUrl(s.url));
    expect(new Set(urls).size).toBe(urls.length);
    const ids = BENCHMARK_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("190 wpisów źródłowych badaczy: każdy rozwiązany aliasem <grupa>:<id> albo jawnie odrzucony", () => {
    let total = 0;
    let resolved = 0;
    let dropped = 0;
    const unresolved: string[] = [];
    for (const { file, data, overlay } of RAW) {
      for (const s of data.sources) {
        total += 1;
        const canonical = canonicalSourceId(`${file}:${s.id}`);
        if (canonical) {
          resolved += 1;
          // Alias prowadzi do wpisu o TYM SAMYM adresie - nie do innego raportu.
          expect(normalizeSourceUrl(sourceById(canonical)?.url ?? "")).toBe(
            normalizeSourceUrl(s.url),
          );
        } else if (overlay.sources[s.id]?.drop_reason) dropped += 1;
        else unresolved.push(`${file}:${s.id}`);
      }
    }
    expect(unresolved).toEqual([]);
    expect(total).toBe(190);
    expect(resolved + dropped).toBe(190);
    expect(BENCHMARK_SOURCES.reduce((n, s) => n + s.aliases.length, 0)).toBe(resolved);
  });

  it("zero sierot: każde źródło kanoniczne jest cytowane przez kontekst albo zastrzeżenie", () => {
    const cited = new Set<string>();
    for (const b of ALL) {
      for (const c of b.contexts) for (const id of c.sourceIds) cited.add(id);
      for (const cv of b.caveats) for (const id of cv.sourceIds ?? []) cited.add(id);
    }
    expect(BENCHMARK_SOURCES.filter((s) => !cited.has(s.id)).map((s) => s.id)).toEqual([]);
  });

  it("najwyżej 12 źródeł na kontekst i co najmniej jedno (pasmo bez przypisu nie istnieje)", () => {
    for (const c of CONTEXTS) {
      expect(c.sourceIds.length, c.id).toBeGreaterThan(0);
      expect(c.sourceIds.length, c.id).toBeLessThanOrEqual(12);
    }
  });
});

describe("pasma kontekstów", () => {
  it("194 konteksty, 973 pasma; identyfikatory <key>.<slug> unikalne", () => {
    expect(CONTEXTS).toHaveLength(194);
    expect(CONTEXTS.reduce((n, c) => n + c.bands.length, 0)).toBe(973);
    const ids = CONTEXTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of ALL) {
      for (const c of b.contexts) expect(c.id.startsWith(`${b.key}.`), c.id).toBe(true);
      expect(b.defaultContextBySegment.all, b.key).toBeTruthy();
      for (const id of Object.values(b.defaultContextBySegment)) {
        expect(
          b.contexts.some((c) => c.id === id),
          `${b.key} → ${id}`,
        ).toBe(true);
      }
    }
  });

  it("posortowane rosnąco i ciągłe; otwarte końce tylko na brzegach; etykiety ∈ Tier; 3-7 pasm", () => {
    for (const c of CONTEXTS) {
      expect(c.bands.length, c.id).toBeGreaterThanOrEqual(3);
      expect(c.bands.length, c.id).toBeLessThanOrEqual(7);
      c.bands.forEach((band, i) => {
        expect(TIERS, c.id).toContain(band.tier);
        if (band.min === null) expect(i, `${c.id} min null`).toBe(0);
        if (band.max === null) expect(i, `${c.id} max null`).toBe(c.bands.length - 1);
        if (band.min !== null && band.max !== null) expect(band.min, c.id).toBeLessThan(band.max);
        if (i > 0) expect(band.min, `${c.id} ciągłość ${i}`).toBe(c.bands[i - 1].max);
      });
    }
  });

  it("kierunek per kontekst = kierunek z pasm; range jest jednomodalny (rośnie, potem maleje)", () => {
    const counts = { higher: 0, lower: 0, range: 0 };
    for (const c of CONTEXTS) {
      expect(c.direction, c.id).toBe(contextDirection({ bands: c.bands }));
      const ranks = c.bands.map((b) => RANK[b.tier]);
      if (c.direction === "higher") {
        ranks.forEach((r, i) => i === 0 || expect(r, c.id).toBeGreaterThanOrEqual(ranks[i - 1]));
      } else if (c.direction === "lower") {
        ranks.forEach((r, i) => i === 0 || expect(r, c.id).toBeLessThanOrEqual(ranks[i - 1]));
      } else {
        const peak = ranks.indexOf(Math.max(...ranks));
        ranks.forEach((r, i) => {
          if (i === 0) return;
          if (i <= peak) expect(r, `${c.id} wzrost`).toBeGreaterThanOrEqual(ranks[i - 1]);
          else expect(r, `${c.id} spadek`).toBeLessThanOrEqual(ranks[i - 1]);
        });
      }
      counts[c.direction ?? "higher"] += 1;
    }
    // Wszystkie trzy kierunki są w danych - test nie przechodzi „przez pustkę”.
    expect(counts.higher).toBeGreaterThan(0);
    expect(counts.lower).toBeGreaterThan(0);
    expect(counts.range).toBeGreaterThan(0);
  });

  it("podstawa E ⇔ heurystyka: nota pasma mówi „heurysty…” albo redakcja wskazała pasmo w basis_e", () => {
    const rawContexts = new Map<string, { raw: RawContext; basisE: ReadonlySet<number> }>();
    for (const { data, overlay } of RAW) {
      for (const m of data.metrics) {
        overlay.metrics[m.key]?.contexts.forEach((oc, i) => {
          rawContexts.set(oc.id, { raw: m.contexts[i], basisE: new Set(oc.basis_e ?? []) });
        });
      }
    }
    let heuristic = 0;
    for (const c of CONTEXTS) {
      const src = rawContexts.get(c.id);
      if (!src) throw new Error(`test: kontekst ${c.id} bez danych źródłowych`);
      // Importer sortuje pasma stabilnie po `min` - ta sama permutacja
      // przenosi indeksy `basis_e` (kolejność pliku) na pasma rejestru.
      const order = src.raw.bands
        .map((_, i) => i)
        .sort(
          (a, b) =>
            (src.raw.bands[a].min ?? Number.NEGATIVE_INFINITY) -
            (src.raw.bands[b].min ?? Number.NEGATIVE_INFINITY),
        );
      c.bands.forEach((band, k) => {
        const rawIndex = order[k];
        const expected =
          /heurysty/i.test(band.note?.pl ?? "") || src.basisE.has(rawIndex) ? "E" : "B";
        expect(band.basis, `${c.id}[${k}]`).toBe(expected);
        if (expected === "E") heuristic += 1;
      });
    }
    expect(heuristic).toBeGreaterThan(0);
  });

  it("tierOf na granicach PRAWDZIWYCH kontekstów: granica należy do pasma, które się od niej zaczyna", () => {
    for (const c of CONTEXTS) {
      c.bands.forEach((band, i) => {
        if (band.min === null) return;
        const at = tierOf(band.min, c);
        expect(at.tier, `${c.id} @ ${band.min}`).toBe(band.tier);
        const eps = Math.max(Math.abs(band.min) * 1e-9, 1e-9);
        const below = tierOf(band.min - eps, c);
        if (i === 0)
          expect(below, `${c.id} poniżej dziedziny`).toMatchObject({ why: "incomparable" });
        else expect(below.tier, `${c.id} tuż pod ${band.min}`).toBe(c.bands[i - 1].tier);
      });
      const last = c.bands[c.bands.length - 1];
      // Najwyższe pasmo domknięte z prawej: 100 % udziału to ostatnie pasmo,
      // a nie „poza skalą”.
      if (last.max !== null) expect(tierOf(last.max, c).tier, `${c.id} @ max`).toBe(last.tier);
    }
  });
});

describe("spójność krzyżowa na wygenerowanych pasmach", () => {
  const finite = (id: string): number[] =>
    context(id).bands.flatMap((b) => (b.max === null ? [] : [b.max]));

  it.each([
    ["news_b2c", "news_b2c_all"],
    ["b2b_smb", "b2b_smb"],
    ["b2b_mid_market", "b2b_mid_market"],
    ["b2b_enterprise", "b2b_enterprise"],
    ["membership", "membership"],
  ])("churn: logo_churn_monthly.%s ↔ logo_churn_annual.%s (annualizeChurn ±1 pp)", (m, r) => {
    const monthly = finite(`logo_churn_monthly.${m}`);
    const annual = finite(`logo_churn_annual.${r}`);
    expect(monthly).toHaveLength(annual.length);
    monthly.forEach((boundary, i) => {
      expect(Math.abs(annualizeChurn(boundary) - annual[i])).toBeLessThanOrEqual(1);
    });
    expect(context(`logo_churn_monthly.${m}`).bands.map((b) => b.tier)).toEqual(
      context(`logo_churn_annual.${r}`).bands.map((b) => b.tier),
    );
  });

  it("CCR + CAR = 100: pasma porzuceń checkoutu subskrypcji to lustro pasm konwersji", () => {
    const ccr = context("checkout_conversion_rate.subscription");
    const car = context("checkout_abandonment_rate.subscription");
    const shape = (bands: readonly { tier: Tier; min: number | null; max: number | null }[]) =>
      bands.map(({ tier, min, max }) => ({ tier, min, max }));
    expect(shape(mirrorBands(ccr.bands))).toEqual(shape(car.bands));
    expect(ccr.direction).toBe("higher");
    expect(car.direction).toBe("lower");
  });
});

describe("pliki w repo = wynik importera (dryf = błąd)", () => {
  it("groups/*.server.ts, sources.ts i index.ts są dokładnie tym, co generuje render*Module", async () => {
    const registry = buildRegistry(readGroupInputs(DOCS, GROUP_FILES), {
      knownMetricIds: new Set(METRICS.map((m) => m.id)),
    });
    expect(registry.warnings).toEqual([]);
    expect([...registry.benchmarks.keys()]).toEqual(GROUP_FILES.map((f) => GROUP_OF_FILE[f]));
    const generated = await generateFiles(registry, DOCS);
    expect(generated.size).toBe(8);
    for (const [rel, content] of generated) {
      const onDisk = readFileSync(path.join(REPO_ROOT, rel), "utf8");
      // Porównanie całego pliku: ręczna edycja liczby albo nieuruchomiony
      // importer po zmianie nakładki - ten sam objaw, ten sam błąd.
      expect(onDisk === content, `dryf ${rel} - uruchom importer`).toBe(true);
    }
  }, 60_000);
});
