// Warstwa danych retencji (przepływ anulowania subskrypcji): ustawienia
// kontroferty, katalog powodów odejścia i odpowiedzi ankiety. Odczyt dla
// zalogowanych (RLS); zapisy panelu idą przez `lib/retention/mutations.ts`,
// przepływ czytelnika - przez server fns (`lib/retention/functions.ts`).
//
// DWA ZAKRESY ODCZYTU (`scope`). Dialog anulowania u czytelnika czyta
// ustawienia i AKTYWNE powody najemcy strony (`public`); zakładka Retencja
// w /admin/pricing - WSZYSTKIE powody i ustawienia do edycji (`admin`).
// Klucze są różne (`retentionKeys`), bo różne są kształty list i uprawnienia;
// zapis w panelu unieważnia obie rodziny.
//
// JEDNA `queryFn` ODPOWIEDZI (def. 13). `RetentionTab` i `/admin/monetization`
// trzymały pod tym samym kluczem DWA różne zapytania - kto pierwszy wypełnił
// cache, ten decydował, co widzi drugi ekran. Teraz jeden odczyt z oknem
// czasu i filtrem „tylko odpowiedzi z powodem" PO STRONIE BAZY (Z-08): dawny
// `limit(100)` przed filtrem 90 dni liczył statystyki z próbki, a wiersze
// przepływu bez powodu (`started`/`abandoned`) wypierały z niej odpowiedzi.
//
// Moduł czyta też profil czytelnika (`RetentionDialog`, S2) - żadnych
// importów panelu, wyłącznie fabryka-liść kluczy.
import { queryOptions, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { retentionKeys } from "@/lib/retention/keys";

export type RetentionSettingsRow = Database["public"]["Tables"]["retention_settings"]["Row"];
export type RetentionReasonRow = Database["public"]["Tables"]["retention_reasons"]["Row"];
export type RetentionFeedbackRow = Database["public"]["Tables"]["retention_feedback"]["Row"];

/** `public` - dialog czytelnika; `admin` - zakładka Retencja w cenniku. */
export type RetentionScope = "public" | "admin";

/**
 * Ustawienia kontroferty albo `null` - najemca nigdy ich nie zapisał
 * (panel pokazuje wtedy stan serwera „brak konfiguracji", a nie domyślne
 * pola udające zapisany rabat).
 */
export function retentionSettingsQueryOptions(scope: RetentionScope = "public") {
  return queryOptions({
    queryKey: scope === "admin" ? retentionKeys.admin.settings() : retentionKeys.settingsPublic(),
    staleTime: 60_000,
    queryFn: async (): Promise<RetentionSettingsRow | null> => {
      const { data, error } = await supabase.from("retention_settings").select("*").maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
}

/** Powody odejścia: czytelnik widzi aktywne, panel - wszystkie (też wyłączone). */
export function retentionReasonsQueryOptions(scope: RetentionScope = "public") {
  return queryOptions({
    queryKey: scope === "admin" ? retentionKeys.admin.reasons() : retentionKeys.reasonsPublic(),
    staleTime: 60_000,
    queryFn: async (): Promise<RetentionReasonRow[]> => {
      const base = supabase.from("retention_reasons").select("*");
      // Wyłączony powód nie wraca na ekran rezygnacji - redakcja świadomie go
      // zdjęła. Panel widzi go, bo tam się go włącza z powrotem.
      const query = scope === "public" ? base.eq("active", true) : base;
      const { data, error } = await query.order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Odpowiedzi z okna - `truncated`, gdy okno ma więcej wierszy niż `limit`. */
export interface RetentionFeedbackWindow {
  rows: RetentionFeedbackRow[];
  /**
   * Okno zawiera więcej odpowiedzi niż pobrano. Statystyka z części okna to
   * nie jest statystyka okna - ekran musi to powiedzieć, a nie udawać.
   */
  truncated: boolean;
}

/**
 * Odpowiedzi ankiety anulowania z okna `[sinceIso, teraz]`, najnowsze
 * pierwsze. `sinceIso` wchodzi do klucza, więc wołający podaje granicę
 * STABILNĄ (`retentionStatsSinceIso()` z `lib/admin/retentionStats.ts`,
 * zaokrągloną do doby) - inaczej każdy render byłby nowym zapytaniem.
 * Klucz leży pod `retentionKeys.admin.feedback()`, więc reguła szyny
 * `retention_flow.*` odświeża każde okno.
 */
export function retentionFeedbackQueryOptions({
  sinceIso,
  limit,
}: {
  sinceIso: string;
  limit: number;
}) {
  const take = Number.isSafeInteger(limit) && limit > 0 ? limit : 1;
  return queryOptions({
    queryKey: [...retentionKeys.admin.feedback(), sinceIso, take] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<RetentionFeedbackWindow> => {
      // Jeden wiersz ponad limit: jedyny tani sposób, żeby odróżnić „okno ma
      // dokładnie `limit` odpowiedzi" od „okno zostało przycięte".
      const { data, error } = await supabase
        .from("retention_feedback")
        .select("*")
        .not("reason_label", "is", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(take + 1);
      if (error) throw error;
      const rows = data ?? [];
      return { rows: rows.slice(0, take), truncated: rows.length > take };
    },
  });
}

export function useRetentionSettings(
  enabled: boolean,
): UseQueryResult<RetentionSettingsRow | null> {
  return useQuery({ ...retentionSettingsQueryOptions(), enabled });
}

export function useRetentionReasons(enabled: boolean): UseQueryResult<RetentionReasonRow[]> {
  return useQuery({ ...retentionReasonsQueryOptions(), enabled });
}

export function reasonLabel(reason: RetentionReasonRow, lang: string): string {
  return lang === "en" ? reason.label_en || reason.label_pl : reason.label_pl || reason.label_en;
}
