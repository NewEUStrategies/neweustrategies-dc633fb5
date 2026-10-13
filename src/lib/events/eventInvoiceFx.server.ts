// Kursy NBP do faktur wydarzen w walucie obcej (INV-06, art. 31a ustawy o VAT).
//
// DLACZEGO SERWER, A NIE PANEL. Kurs na fakturze jest elementem dokumentu VAT:
// panel nie moze go podac (ani "poprawic"), bo administrator zadeklarowalby
// wtedy dowolna liczbe. Baza przyjmuje kurs WYLACZNIE z tabeli
// `nbp_exchange_rates`, ktora pisze tylko `service_role`, a ten modul - po
// pobraniu tabeli A prosto z api.nbp.pl. Ktore dni sa potrzebne, mowi baza
// (`admin_event_invoice_fx_needs`, klientem UZYTKOWNIKA - bramka
// `assert_event_admin_tenant()`), wiec funkcja serwerowa nie liczy regul
// obowiazku podatkowego drugi raz.
//
// WIERSZ = DZIEN KALENDARZOWY. Kurs "z ostatniego dnia roboczego
// poprzedzajacego dzien X" to ostatnia tabela opublikowana W DNIU X - 1 albo
// wczesniej - swieta i weekendy rozstrzyga sama NBP (zakres zapytania zaczyna
// sie 10 dni wczesniej, wiec najdluzsza przerwa swiateczna sie miesci).
//
// Bledy sieci NIE pozwalaja wystawic dokumentu: brak kursu = odmowa bazy
// (`fx_rate_required`), a nie przeliczenie po kursie z pamieci podrecznej -
// stary albo zastepczy kurs na fakturze to blad podatkowy (por. `fxRate.ts`,
// gdzie fallback jest dopuszczalny, bo dotyczy tylko prezentacji cen).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { jsonBool, jsonList, jsonRecord, jsonText } from "@/lib/events/eventInvoiceJson";

export interface FxNeed {
  currency: string;
  /** Dzien kalendarzowy RRRR-MM-DD, dla ktorego baza potrzebuje kursu. */
  rateDate: string;
  loaded: boolean;
}

export interface NbpRate {
  /** Numer tabeli, np. "195/A/NBP/2026". */
  no: string;
  effectiveDate: string;
  mid: number;
}

export interface NbpRateRow {
  currency: string;
  rate_date: string;
  effective_date: string;
  table_no: string;
  mid: number;
}

export interface FxPrepareResult {
  needed: number;
  loaded: number;
  /** Dni, ktorych NBP nie oddal (przerwa w API) - wystawienie sie nie uda. */
  missing: FxNeed[];
}

/** Zakres zapytania NBP: najwyzej 93 dni (limit API), zapas 10 dni przed dniem. */
const NBP_MAX_RANGE_DAYS = 93;
const LOOKBACK_DAYS = 10;
const TABLE_NO = /^[0-9]{1,3}\/A\/NBP\/[0-9]{4}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseFxNeeds(value: Json | null): FxNeed[] {
  return jsonList(value ?? undefined).flatMap((item) => {
    const row = jsonRecord(item);
    const currency = jsonText(row.currency);
    const rateDate = jsonText(row.rate_date);
    if (!/^[A-Z]{3}$/.test(currency) || !DAY.test(rateDate)) return [];
    return [{ currency, rateDate, loaded: jsonBool(row.loaded) }];
  });
}

/** Przesuniecie dnia RRRR-MM-DD o `days` (kalendarz UTC - bez stref i DST). */
export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Zakresy [od, do] po najwyzej 93 dni pokrywajace dni + 10 dni wstecz. */
export function nbpRanges(days: readonly string[]): Array<[string, string]> {
  const sorted = [...new Set(days)].sort();
  const ranges: Array<[string, string]> = [];
  for (const day of sorted) {
    const from = shiftDay(day, -LOOKBACK_DAYS);
    const last = ranges[ranges.length - 1];
    if (
      last !== undefined &&
      from <= shiftDay(last[1], 1) &&
      shiftDay(last[0], NBP_MAX_RANGE_DAYS - 1) >= day
    ) {
      last[1] = day;
    } else {
      ranges.push([from, day]);
    }
  }
  return ranges;
}

/**
 * Kurs obowiazujacy w dniu: ostatnia tabela z `effectiveDate <= dzien`, nie
 * starsza niz 10 dni (dluzsza przerwa = brak danych, nie "wez cokolwiek").
 */
export function rateForDay(rates: readonly NbpRate[], day: string): NbpRate | null {
  let best: NbpRate | null = null;
  for (const rate of rates) {
    if (rate.effectiveDate > day || rate.effectiveDate < shiftDay(day, -LOOKBACK_DAYS)) continue;
    if (best === null || rate.effectiveDate > best.effectiveDate) best = rate;
  }
  return best;
}

function parseNbp(json: unknown): NbpRate[] {
  const rates = (json as { rates?: unknown } | null)?.rates;
  if (!Array.isArray(rates)) return [];
  return rates.flatMap((item) => {
    const row = item as { no?: unknown; effectiveDate?: unknown; mid?: unknown };
    if (
      typeof row.no !== "string" ||
      !TABLE_NO.test(row.no) ||
      typeof row.effectiveDate !== "string" ||
      !DAY.test(row.effectiveDate) ||
      typeof row.mid !== "number" ||
      !Number.isFinite(row.mid) ||
      row.mid <= 0
    ) {
      return [];
    }
    return [{ no: row.no, effectiveDate: row.effectiveDate, mid: row.mid }];
  });
}

/**
 * Tabela A NBP dla waluty w zakresie dni. 404 = brak notowan w zakresie
 * (np. same swieta) - pusta lista; inny blad sieci - wyjatek po 3 probach.
 */
export async function fetchNbpRange(
  currency: string,
  from: string,
  to: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NbpRate[]> {
  const url = `https://api.nbp.pl/api/exchangerates/rates/A/${encodeURIComponent(currency)}/${from}/${to}/?format=json`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`NBP HTTP ${res.status}`);
      return parseNbp(await res.json());
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("NBP request failed");
}

/** Wiersze `nbp_exchange_rates` dla brakujacych dni (dzien bez tabeli = brak). */
export function nbpRowsForNeeds(
  needs: readonly FxNeed[],
  ratesByCurrency: ReadonlyMap<string, readonly NbpRate[]>,
): { rows: NbpRateRow[]; missing: FxNeed[] } {
  const rows: NbpRateRow[] = [];
  const missing: FxNeed[] = [];
  for (const need of needs) {
    const rate = rateForDay(ratesByCurrency.get(need.currency) ?? [], need.rateDate);
    if (rate === null) {
      missing.push(need);
      continue;
    }
    rows.push({
      currency: need.currency,
      rate_date: need.rateDate,
      effective_date: rate.effectiveDate,
      table_no: rate.no,
      mid: rate.mid,
    });
  }
  return { rows, missing };
}

export type FxPrepareInput = { invoiceIds: string[] } | { eventId: string; pending: true };

/**
 * Pobiera z NBP kursy, ktorych baza potrzebuje do wystawienia wskazanych
 * szkicow (albo masowego wystawienia z prosb wydarzenia), i zapisuje je
 * kluczem uslugowym. `supabase` = klient UZYTKOWNIKA (bramka w RPC).
 */
export async function prepareEventInvoiceFxRates(
  supabase: SupabaseClient<Database>,
  input: FxPrepareInput,
  fetchImpl: typeof fetch = fetch,
): Promise<FxPrepareResult> {
  const payload =
    "invoiceIds" in input
      ? { invoice_ids: input.invoiceIds }
      : { event_id: input.eventId, pending: true };
  const { data, error } = await supabase.rpc("admin_event_invoice_fx_needs", {
    p_payload: payload,
  });
  if (error) throw new Error(error.message);
  const needs = parseFxNeeds(data);
  const todo = needs.filter((need) => !need.loaded);
  if (todo.length === 0) return { needed: needs.length, loaded: 0, missing: [] };

  const ratesByCurrency = new Map<string, NbpRate[]>();
  for (const currency of new Set(todo.map((need) => need.currency))) {
    const days = todo.filter((need) => need.currency === currency).map((need) => need.rateDate);
    const rates: NbpRate[] = [];
    for (const [from, to] of nbpRanges(days)) {
      rates.push(...(await fetchNbpRange(currency, from, to, fetchImpl)));
    }
    ratesByCurrency.set(currency, rates);
  }
  const { rows, missing } = nbpRowsForNeeds(todo, ratesByCurrency);
  if (rows.length > 0) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upsertError } = await supabaseAdmin
      .from("nbp_exchange_rates")
      .upsert(rows, { onConflict: "currency,rate_date" });
    if (upsertError) throw new Error(upsertError.message);
  }
  return { needed: needs.length, loaded: rows.length, missing };
}
