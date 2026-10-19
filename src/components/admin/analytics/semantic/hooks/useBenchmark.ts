// BENCHMARK WSKAŹNIKA W KLIENCIE (SPEC §5.5, AD-09) - jedno zapytanie na
// GRUPĘ i język, wspólne dla kafla, objaśnienia, skali i słownika.
//
// DLACZEGO KLUCZ PER GRUPA, A NIE PER WSKAŹNIK. Server fn zwraca całą grupę
// (12-18 wpisów) w jednym języku. Kafle MRR, ARR i NRR na jednym ekranie to
// trzy wpisy z dwóch grup - z kluczem per wpis byłyby trzy identyczne
// odczyty tej samej grupy. `select` wyjmuje z odpowiedzi jeden wpis, a cache
// trzyma grupę raz.
//
// DLACZEGO `staleTime: Infinity`. Treść rejestru zmienia się wyłącznie
// z wdrożeniem (importer + commit), nie w trakcie sesji - ponowny odczyt
// przy każdym fokusie okna byłby czystym kosztem. `gcTime: Infinity` z tego
// samego powodu: objaśnienie otwierane drugi raz po kwadransie nie może
// znowu czekać na serwer.
//
// TREŚĆ NIE JEST TU IMPORTOWANA. Hook zna tylko lekki indeks (klucz, skrót,
// grupa, metryka); pasma, metody i źródła przychodzą z `getBenchmarkGroup`
// (bramka `clientBoundary.test.ts`).
import { useCallback, useMemo } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { metricById, type MetricId } from "@/lib/analytics/semantic/metrics";
import type {
  BenchLang,
  BenchmarkGroupPayload,
  LocalizedBenchmark,
  LocalizedSource,
} from "@/lib/analytics/semantic/benchmarks/adapter";
import { getBenchmarkGroup } from "@/lib/analytics/semantic/benchmarks/benchmarks.functions";
import {
  evaluateMetric,
  type BenchmarkEvaluation,
} from "@/lib/analytics/semantic/benchmarks/evaluate";
import {
  benchmarkIndexEntry,
  primaryBenchmarkFor,
  type BenchmarkIndexEntry,
} from "@/lib/analytics/semantic/benchmarks/index";
import type { BenchContextSegment, BenchGroup } from "@/lib/analytics/semantic/benchmarks/types";

/** Fabryka kluczy: `["benchmarks", grupa, język]` - treść globalna, bez najemcy. */
export const benchmarkKeys = {
  all: () => ["benchmarks"] as const,
  group: (group: BenchGroup, lang: BenchLang) => ["benchmarks", group, lang] as const,
};

/** Zapytanie o treść jednej grupy w jednym języku. */
export function benchmarkGroupQueryOptions(group: BenchGroup, lang: BenchLang) {
  return queryOptions({
    queryKey: benchmarkKeys.group(group, lang),
    queryFn: (): Promise<BenchmarkGroupPayload> => getBenchmarkGroup({ data: { group, lang } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
}

export interface BenchmarkRef {
  /** Metryka - wybiera wpis wiodący (`primary` albo jedyny). */
  metricId?: MetricId;
  /** Jawny wpis rejestru - wygrywa z `metricId` (np. wpis bez metryki: NPS). */
  benchKey?: string;
}

/** Wpis indeksu dla odniesienia; `undefined`, gdy metryka nie ma benchmarku. */
export function benchmarkEntryFor(ref: BenchmarkRef): BenchmarkIndexEntry | undefined {
  if (ref.benchKey) return benchmarkIndexEntry(ref.benchKey);
  return ref.metricId ? primaryBenchmarkFor(ref.metricId) : undefined;
}

/**
 * Stan odczytu, który komponent pokazuje słowem: `none` (metryka bez
 * benchmarku - to stan rejestru, nie błąd), `idle` (zapytanie wyłączone),
 * `loading`, `error`, `ready`.
 */
export type BenchmarkStatus = "none" | "idle" | "loading" | "error" | "ready";

export interface UseBenchmarkResult {
  entry: BenchmarkIndexEntry | undefined;
  bench: LocalizedBenchmark | null;
  /** Źródła cytowane przez grupę (bez cytatów) - przypisy wybiera `citationsFor`. */
  sources: readonly LocalizedSource[];
  status: BenchmarkStatus;
  refetch: () => void;
}

interface Selected {
  bench: LocalizedBenchmark | null;
  sources: readonly LocalizedSource[];
}

const NO_SOURCES: readonly LocalizedSource[] = [];

export function useBenchmark({
  metricId,
  benchKey,
  lang,
  enabled = true,
}: BenchmarkRef & { lang: BenchLang; enabled?: boolean }): UseBenchmarkResult {
  const entry = benchmarkEntryFor({ metricId, benchKey });
  const key = entry?.key;
  // `select` musi być stabilny - inaczej react-query liczy go przy każdym
  // renderze i zwraca nowy obiekt, a komponent renderuje się w kółko.
  const select = useCallback(
    (payload: BenchmarkGroupPayload): Selected => ({
      bench: payload.benchmarks.find((b) => b.key === key) ?? null,
      sources: payload.sources,
    }),
    [key],
  );
  // Bez wpisu zapytanie stoi (grupa-wartownik nie jest nigdy pobierana).
  const query = useQuery({
    ...benchmarkGroupQueryOptions(entry?.group ?? "revenue", lang),
    enabled: enabled && entry !== undefined,
    select,
  });
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return useMemo((): UseBenchmarkResult => {
    let status: BenchmarkStatus;
    if (!entry) status = "none";
    else if (query.isError) status = "error";
    else if (query.data) status = "ready";
    else if (!enabled) status = "idle";
    else status = "loading";
    return {
      entry,
      bench: query.data?.bench ?? null,
      sources: query.data?.sources ?? NO_SOURCES,
      status,
      refetch: retry,
    };
  }, [entry, enabled, query.data, query.isError, retry]);
}

/**
 * Wstępne pobranie grupy na najechanie albo fokus ikony objaśnienia - treść
 * jest w cache, zanim czytelnik kliknie. Bez wpisu (metryka bez benchmarku)
 * nic się nie dzieje.
 */
export function usePrefetchBenchmark(): (ref: BenchmarkRef & { lang: BenchLang }) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (ref) => {
      const entry = benchmarkEntryFor(ref);
      if (!entry) return;
      void queryClient.prefetchQuery(benchmarkGroupQueryOptions(entry.group, ref.lang));
    },
    [queryClient],
  );
}

/**
 * Ocena wartości metryki benchmarkiem - JEDNA reguła dla kafla, słownika,
 * objaśnienia i sekcji BI (inaczej ten sam churn byłby „normalny” w kaflu
 * i „słaby” w słowniku).
 *
 * Kwota to zawsze POZIOM: kontekst mierzący wzrost r/r albo realizację planu
 * nie ocenia kwoty, więc dla metryk pieniężnych podajemy `measure: "level"`
 * i dostajemy jawne „benchmark mierzy inną wielkość”. Pozostałe metryki
 * przechodzą jako wartości natywne (udział jako udział, CMGR jako CMGR) -
 * niezgodność wyłapie kontrola jednostki.
 */
export function evaluateMetricValue(
  metricId: MetricId,
  value: number | null,
  bench: LocalizedBenchmark | null,
  opts: { n?: number; currency?: string; segment?: BenchContextSegment; ctxId?: string } = {},
): BenchmarkEvaluation {
  const def = metricById(metricId);
  return evaluateMetric(
    {
      value,
      unit: def.unit,
      ...(def.currencyBound ? { measure: "level" as const } : {}),
      currency: opts.currency,
      n: opts.n,
      segment: opts.segment,
      ctxId: opts.ctxId,
    },
    bench,
  );
}
