// TREŚĆ BENCHMARKÓW Z SERWERA (SPEC §5.5, N13, AD-09) - jedna server fn dla
// objaśnień wskaźników, skali oceny i słownika BI.
//
// DLACZEGO SERVER FN, A NIE LENIWY CHUNK. Treść sześciu grup to ok. 240 KB
// tekstu PL+EN z cytatami źródeł. Jako chunk klienta byłaby pobierana
// w CAŁOŚCI (oba języki, cytaty) i liczona do budżetu bundla; tu klient
// dostaje jedną grupę w jednym języku, bez `excerpt`. Treść jest ładowana
// dynamicznym importem WEWNĄTRZ handlera - kompilator server fn wycina
// handler z bundla klienta razem z tymi importami, więc żaden plik
// `groups/*.server.ts` ani `sources.ts` nie trafia do przeglądarki
// (pilnuje tego `__tests__/clientBoundary.test.ts`).
//
// BRAK NAJEMCY - ŚWIADOMIE. Benchmarki to treść GLOBALNA (zweryfikowane
// raporty zewnętrzne z datą), identyczna dla każdego najemcy; funkcja nie
// czyta ani nie zwraca danych obszaru, więc nie rozwiązuje najemcy i nie
// przyjmuje go w wejściu. Bramka roli zostaje, bo objaśnienia są częścią
// panelu przychodu (admin/editor), a nie treścią publiczną.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildGroupPayload, type BenchmarkGroupPayload, type GeneratedBenchmark } from "./adapter";
import type { BenchGroup } from "./types";

const GROUPS = [
  "revenue",
  "retention",
  "economics",
  "funnel",
  "email",
  "community",
] as const satisfies readonly BenchGroup[];

const inputSchema = z.object({
  group: z.enum(GROUPS),
  lang: z.enum(["pl", "en"]),
});

export const getBenchmarkGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => inputSchema.parse(i))
  .handler(async ({ data, context }): Promise<BenchmarkGroupPayload> => {
    // Rola z SESJI (`has_role` czyta `auth.uid()` i obszar z profilu), nigdy
    // z wejścia. Fail-closed: `null` (brak wiersza roli, brak grantu) nie
    // jest zgodą. Admin ALBO editor - ta sama poprzeczka co panel przychodu.
    const [admin, editor] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "editor" }),
    ]);
    if (admin.data !== true && editor.data !== true) throw new Error("forbidden");

    // Sześć LITERALNYCH importów wewnątrz handlera: bundler musi widzieć każdy
    // moduł z nazwy (import ze sklejanej ścieżki wciągnąłby cały katalog
    // `groups/` do jednego chunku i ukrył zależność przed bramką granicy),
    // a kompilator server fn wycina je z klienta razem z handlerem.
    let benchmarks: readonly GeneratedBenchmark[];
    switch (data.group) {
      case "revenue":
        benchmarks = (await import("./groups/revenue.server")).REVENUE_BENCHMARKS;
        break;
      case "retention":
        benchmarks = (await import("./groups/retention.server")).RETENTION_BENCHMARKS;
        break;
      case "economics":
        benchmarks = (await import("./groups/economics.server")).ECONOMICS_BENCHMARKS;
        break;
      case "funnel":
        benchmarks = (await import("./groups/funnel.server")).FUNNEL_BENCHMARKS;
        break;
      case "email":
        benchmarks = (await import("./groups/email.server")).EMAIL_BENCHMARKS;
        break;
      case "community":
        benchmarks = (await import("./groups/community.server")).COMMUNITY_BENCHMARKS;
        break;
    }
    const { sourceById } = await import("./sources");
    const { BENCHMARK_PAIRS, BENCHMARK_REGISTRY_AS_OF } = await import("./index");
    return buildGroupPayload({
      group: data.group,
      lang: data.lang,
      asOf: BENCHMARK_REGISTRY_AS_OF,
      benchmarks,
      pairs: BENCHMARK_PAIRS,
      sourceById,
    });
  });
