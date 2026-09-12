// FUNKCJE SERWEROWE PULPITU - cienka warstwa nad agregatami bazy.
//
// CAŁY RACHUNEK SIEDZI W SQL-u (migracja 20260912110000). Ten plik nie liczy
// niczego: waliduje okno, woła funkcję i przepuszcza wynik przez `parse.ts`.
// To jest celowy podział - agregat musi zostać przy danych, bo inaczej "rok"
// znaczyłby transfer milionów wierszy do Node'a, a bramka roli musi zostać
// w bazie, bo funkcje są SECURITY DEFINER i to one omijają RLS.
//
// AUTORYZACJA JEST W BAZIE, NIE TUTAJ, i to nie jest przeoczenie. Gdyby bramkę
// roli postawić tu, a funkcję zostawić otwartą, każdy inny wołający (drugi
// endpoint, skrypt, przyszły edge function) omijałby ją milcząco. `middleware`
// poniżej daje więc tylko klienta z tożsamością wołającego; o tym, czy ta
// tożsamość ma prawo do pulpitu, rozstrzyga `admin_dashboard_tenant()`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  parseAudienceReport,
  parseContentReport,
  parseCrmReport,
  parseMarketingReport,
  parseRealtimeReport,
  parseTrafficReport,
} from "./parse";
import type {
  AudienceReport,
  ContentReport,
  CrmReport,
  MarketingReport,
  RealtimeReport,
  TrafficReport,
} from "./types";

/**
 * Odczyt pulpitu wraz z informacją, czy ŹRÓDŁO W OGÓLE ISTNIEJE.
 *
 * PO CO OSOBNA FLAGA, SKORO PUSTY RAPORT MA SAME ZERA. Bo to są dwie różne
 * wiadomości i prowadzą do dwóch różnych decyzji. "Zero sesji" znaczy: pomiar
 * działa, ruchu nie było - sprawdź dystrybucję. "Źródła nie ma" znaczy: migracja
 * jeszcze nie doszła do tej bazy - nie ma czego sprawdzać, poczekaj na wdrożenie.
 * Pulpit, który rysuje zera w obu przypadkach, wysyła człowieka w pościg za
 * awarią, której nie ma.
 */
export interface DashboardRead<T> {
  available: boolean;
  report: T;
}

/**
 * Błędy, które znaczą "tej funkcji/kolumny nie ma jeszcze w bazie", a nie
 * "zapytanie jest złe". Migracje idą osobnym wdrożeniem niż aplikacja, więc
 * kilka minut na każdą publikację ten stan jest NORMALNY i pulpit ma go
 * przeżyć bez pięćsetki.
 *   42883 - nie ma takiej funkcji      42P01 - nie ma takiej relacji
 *   42703 - nie ma takiej kolumny      PGRST202 - PostgREST nie zna funkcji
 */
const MISSING_SOURCE = new Set(["42883", "42P01", "42703", "PGRST202"]);

function isMissingSource(error: PostgrestError): boolean {
  return MISSING_SOURCE.has(error.code);
}

/**
 * Wspólna obsługa wyniku RPC. Brak źródła degraduje do pustego raportu z flagą;
 * KAŻDY inny błąd - w tym odmowa roli (42501) - leci dalej, bo cicha pustka
 * w miejscu odmowy uprawnień byłaby kłamstwem o stanie systemu.
 */
function read<T>(
  data: unknown,
  error: PostgrestError | null,
  parse: (value: unknown) => T,
): DashboardRead<T> {
  if (error) {
    if (isMissingSource(error)) return { available: false, report: parse(null) };
    throw new Error(error.message);
  }
  return { available: true, report: parse(data) };
}

/**
 * Okno analityczne. Obie granice i obie strony porównania przychodzą z klienta,
 * bo to ON zna strefę czasową patrzącego - patrz nagłówek `period.ts`.
 * `offsetMinutes` mieści się w ±14 h, czyli w faktycznym zakresie stref świata
 * (Kiritimati +14, Baker Island -12); szerszy zakres znaczyłby zepsuty zegar
 * klienta, a nie egzotyczną strefę.
 */
const windowInput = z.object({
  sinceIso: z.string().datetime(),
  untilIso: z.string().datetime(),
  prevSinceIso: z.string().datetime(),
  prevUntilIso: z.string().datetime(),
  bucket: z.enum(["minute", "hour", "day", "week", "month"]).default("day"),
  offsetMinutes: z.number().int().min(-840).max(840).default(0),
});

type WindowInput = z.infer<typeof windowInput>;

/** Argumenty wspólne dla pięciu z sześciu funkcji bazy. */
function rpcArgs(data: WindowInput) {
  return {
    p_since: data.sinceIso,
    p_until: data.untilIso,
    p_prev_since: data.prevSinceIso,
    p_prev_until: data.prevUntilIso,
    p_bucket: data.bucket,
    p_offset_minutes: data.offsetMinutes,
  };
}

export const getDashboardTraffic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => windowInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<DashboardRead<TrafficReport>> => {
    const { data: rows, error } = await context.supabase.rpc("admin_dashboard_traffic", {
      ...rpcArgs(data),
      p_limit: 12,
    });
    return read(rows, error, parseTrafficReport);
  });

export const getDashboardCrm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => windowInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<DashboardRead<CrmReport>> => {
    const { data: rows, error } = await context.supabase.rpc("admin_dashboard_crm", rpcArgs(data));
    return read(rows, error, parseCrmReport);
  });

export const getDashboardMarketing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => windowInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<DashboardRead<MarketingReport>> => {
    const { data: rows, error } = await context.supabase.rpc(
      "admin_dashboard_marketing",
      rpcArgs(data),
    );
    return read(rows, error, parseMarketingReport);
  });

export const getDashboardAudience = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => windowInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<DashboardRead<AudienceReport>> => {
    const { data: rows, error } = await context.supabase.rpc(
      "admin_dashboard_audience",
      rpcArgs(data),
    );
    return read(rows, error, parseAudienceReport);
  });

const contentInput = windowInput.extend({ lang: z.string().min(2).max(8).default("pl") });

export const getDashboardContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => contentInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<DashboardRead<ContentReport>> => {
    const { data: rows, error } = await context.supabase.rpc("admin_dashboard_content", {
      p_since: data.sinceIso,
      p_until: data.untilIso,
      p_prev_since: data.prevSinceIso,
      p_prev_until: data.prevUntilIso,
      p_lang: data.lang,
    });
    return read(rows, error, parseContentReport);
  });

/**
 * Podgląd na żywo. Osobne wejście i osobne, MAŁE argumenty: pulpit odpytuje tę
 * funkcję co kilkanaście sekund, więc nie wolno jej przy okazji liczyć lejka
 * sprzedaży. Okna nie podaje klient - "teraz" musi pochodzić z zegara BAZY,
 * bo zegar przeglądarki bywa przestawiony, a wtedy "aktywni w ostatnich pięciu
 * minutach" liczyłoby pięć minut cudzego czasu.
 */
const realtimeInput = z.object({
  activeMinutes: z.number().int().min(1).max(60).default(5),
  windowMinutes: z.number().int().min(5).max(360).default(30),
});

export const getDashboardRealtime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => realtimeInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<DashboardRead<RealtimeReport>> => {
    const { data: rows, error } = await context.supabase.rpc("admin_dashboard_realtime", {
      p_active_minutes: data.activeMinutes,
      p_window_minutes: data.windowMinutes,
    });
    return read(rows, error, parseRealtimeReport);
  });
