// Server fn statystyk ścieżek (S5, kontrakt §5.2): wyniki per krok i warianty
// A/B (`admin_journey_stats`) oraz seria dzienna (`admin_journey_series`).
//
// Bramka `requireCrmStaff` = bramka SQL (admin|editor). Zapisy testowe są
// poza liczbami po stronie SQL. Okno > 400 dni albo > 50 tys. zapisów SQL
// czyta z rollupu dziennego (`source: "rollup"` w DTO - UI pokazuje to
// w podpisie). Nazwy RPC są literałami (`generate:ts-sql-contract`).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCrmStaff } from "@/integrations/supabase/require-staff";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import type { JourneyRead, JourneySeriesPoint, JourneyStatsDto } from "./dto";
import { parseJourneySeries, parseJourneyStats } from "./parse";

/** Najdłuższa seria dzienna (SQL: 22023 `window_invalid`). */
export const JOURNEY_SERIES_MAX_DAYS = 731;

const DAY_MS = 86_400_000;
const MISSING_SOURCE = new Set(["42883", "PGRST202"]);
const ISO = z.string().datetime({ offset: true });

function readState<T>(
  error: { message: string; code?: string } | null,
  ready: () => T,
): JourneyRead<T> {
  if (error) {
    if (error.code === "42501") return { state: "forbidden" };
    if (error.code !== undefined && MISSING_SOURCE.has(error.code)) return { state: "unavailable" };
    throw new Error(error.message);
  }
  return { state: "ready", data: ready() };
}

const StatsInput = z
  .object({
    journeyId: z.string().uuid(),
    versionId: z.string().uuid().nullable().default(null),
    sinceIso: ISO.nullable().default(null),
    untilIso: ISO.nullable().default(null),
  })
  .refine((w) => !w.sinceIso || !w.untilIso || Date.parse(w.untilIso) > Date.parse(w.sinceIso), {
    message: "window_invalid",
  });

export const getJourneyStats = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => StatsInput.parse(input))
  .handler(async ({ data, context }): Promise<JourneyRead<JourneyStatsDto>> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_stats",
      {
        p_journey_id: data.journeyId,
        p_version_id: data.versionId,
        p_since: data.sinceIso,
        p_until: data.untilIso,
      },
    );
    return readState(error, () => parseJourneyStats(raw));
  });

const SeriesInput = z
  .object({ journeyId: z.string().uuid(), sinceIso: ISO, untilIso: ISO })
  .refine((w) => Date.parse(w.untilIso) >= Date.parse(w.sinceIso), { message: "window_invalid" })
  .refine(
    (w) => Date.parse(w.untilIso) - Date.parse(w.sinceIso) <= JOURNEY_SERIES_MAX_DAYS * DAY_MS,
    {
      message: "window_invalid",
    },
  );

export const getJourneySeries = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => SeriesInput.parse(input))
  .handler(async ({ data, context }): Promise<JourneyRead<JourneySeriesPoint[]>> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_series",
      { p_journey_id: data.journeyId, p_since: data.sinceIso, p_until: data.untilIso },
    );
    return readState(error, () => parseJourneySeries(raw));
  });
