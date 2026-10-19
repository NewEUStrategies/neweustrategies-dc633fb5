// Fikstury testów UI benchmarków: PRAWDZIWA treść rejestru zlokalizowana tak,
// jak robi to server fn (`buildGroupPayload`), bez sieci i bez sesji.
//
// Testy komponentów asertują więc liczby, etykiety i źródła, które naprawdę
// zobaczy admin - fikstura wymyślona ręcznie przepuściłaby komponent, który
// psuje się dopiero na 7 pasmach, otwartych końcach albo nocie heurystyki.
// Import treści (`groups/**`, `sources.ts`) wolno robić WYŁĄCZNIE w testach
// (bramka `clientBoundary.test.ts`).
import {
  buildGroupPayload,
  type BenchLang,
  type BenchmarkGroupPayload,
  type GeneratedBenchmark,
  type LocalizedBenchmark,
  type LocalizedContext,
} from "@/lib/analytics/semantic/benchmarks/adapter";
import { COMMUNITY_BENCHMARKS } from "@/lib/analytics/semantic/benchmarks/groups/community.server";
import { ECONOMICS_BENCHMARKS } from "@/lib/analytics/semantic/benchmarks/groups/economics.server";
import { EMAIL_BENCHMARKS } from "@/lib/analytics/semantic/benchmarks/groups/email.server";
import { FUNNEL_BENCHMARKS } from "@/lib/analytics/semantic/benchmarks/groups/funnel.server";
import { RETENTION_BENCHMARKS } from "@/lib/analytics/semantic/benchmarks/groups/retention.server";
import { REVENUE_BENCHMARKS } from "@/lib/analytics/semantic/benchmarks/groups/revenue.server";
import {
  BENCHMARK_PAIRS,
  BENCHMARK_REGISTRY_AS_OF,
} from "@/lib/analytics/semantic/benchmarks/index";
import { sourceById } from "@/lib/analytics/semantic/benchmarks/sources";
import type { BenchGroup } from "@/lib/analytics/semantic/benchmarks/types";

const GROUPS: Readonly<Record<BenchGroup, readonly GeneratedBenchmark[]>> = {
  revenue: REVENUE_BENCHMARKS,
  retention: RETENTION_BENCHMARKS,
  economics: ECONOMICS_BENCHMARKS,
  funnel: FUNNEL_BENCHMARKS,
  email: EMAIL_BENCHMARKS,
  community: COMMUNITY_BENCHMARKS,
};

/** Odpowiedź `getBenchmarkGroup` dla grupy i języka - dokładnie jak z serwera. */
export function payloadFor(group: BenchGroup, lang: BenchLang): BenchmarkGroupPayload {
  return buildGroupPayload({
    group,
    lang,
    asOf: BENCHMARK_REGISTRY_AS_OF,
    benchmarks: GROUPS[group],
    pairs: BENCHMARK_PAIRS,
    sourceById,
  });
}

/** Jeden zlokalizowany wpis rejestru po kluczu. */
export function localized(group: BenchGroup, key: string, lang: BenchLang): LocalizedBenchmark {
  const found = payloadFor(group, lang).benchmarks.find((b) => b.key === key);
  if (!found) throw new Error(`fikstura: brak wpisu ${group}.${key}`);
  return found;
}

/** Zlokalizowany kontekst po identyfikatorze. */
export function contextOf(bench: LocalizedBenchmark, id: string): LocalizedContext {
  const found = bench.contexts.find((c) => c.id === id);
  if (!found) throw new Error(`fikstura: brak kontekstu ${id}`);
  return found;
}
