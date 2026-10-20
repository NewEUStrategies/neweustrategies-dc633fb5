// MAPA DEFEKTÓW → REGUŁY (SPEC §5.7 „defectMap.ts", §7, §9.4).
//
// Każdy defekt z tabeli SPEC §7 ma tu wpis: regułę diagnostyki, która
// pilnuje jego regresji, albo `fixed:<wycinek>` (naprawiony w kodzie wycinka,
// bez sygnału w danych, który reguła mogłaby czytać), albo `deferred`
// (odłożony świadomie - SPEC §7 koniec, §9.4). Test (`defectMap.test.ts`)
// czyta tabelę SPEC z repozytorium, więc nowy wiersz SPEC bez wpisu tutaj
// zapala CI zamiast zniknąć.
//
// BRIEFY ŹRÓDŁOWE (`brief_01..05.md`) i `proposal_dane.md` NIE ISTNIEJĄ
// w repozytorium (pakiet S7 §1.2) - mapa obejmuje dokładnie to, co widać
// w tabeli §7 i na liście odłożonych. Numery z briefów spoza tabeli (np.
// def. 1, 2, 5, 7, 8, 12, 16, 18, 19 br. 02; D2, D4, D8, D10, D15 br. 03;
// br. 04 D2-D4, D11, D12) są w raporcie jako „brak w źródle repo" - bez
// zgadywania treści.
//
// Klucze = pierwsza kolumna tabeli SPEC dosłownie (bez znaczników kodu).
import type { HubSliceId } from "@/lib/ci/hubDelivery";
import type { RevenueCheckId } from "./registry";

export type DefectTarget = RevenueCheckId | `fixed:${HubSliceId}` | "deferred";

export const DEFECT_MAP: Readonly<Record<string, DefectTarget>> = {
  P01: "retention.provider_cancel_bypasses_flow",
  P02: "retention.offer_once_discount",
  P03: "coupons.grant_tier_broken",
  P04: "coupons.campaign_sent_without_codes",
  P05: "catalog.enquiry_plan_buyable",
  P07: "catalog.price_change_without_notice",
  P08: "fixed:S3",
  P09: "checkout.display_currency_mismatch",
  // Mieszanie walut i środowisk naprawia S1/S2/I9; dokument bez środowiska
  // (źródło mieszania) pilnuje reguła jakości danych.
  P10: "data_quality.documents_env_unknown",
  P11: "fixed:S2",
  P12: "fixed:S2",
  // Pauza = `canceled` odpala przepis win-back (D13 br. 03).
  P13: "workflows.cancel_recipe_fires_on_pause",
  P14: "paywall.members_rank_no_cta",
  P15: "fixed:S3",
  P16: "funnel.signup_attribution_missing",
  P17: "funnel.signup_popup_for_members",
  P18: "paywall.measurement_silent",
  P19: "metering.rank_bypass",
  P20: "catalog.promise_without_gate",
  // Kasa przy `cta_mode=contact` - S3; wybór miejsc w kasie odłożony osobno.
  P21: "fixed:S3",
  P22: "fixed:S3",
  P23: "fixed:S4",
  P24: "crm.auto_tasks_without_assignee",
  P25: "deferred",
  "S1 / def. 3": "fixed:S1",
  "def. 4": "fixed:S1",
  "def. 6": "fixed:S1",
  "def. 9": "fixed:S1",
  "def. 10": "fixed:S1",
  "def. 11": "fixed:S1",
  "def. 13": "fixed:S1",
  "def. 14": "metering.settings_row_missing",
  "def. 15 / D2": "fixed:S4",
  "def. 17": "fixed:S1",
  D1: "workflows.newsletter_confirmed_noop",
  "D3-D6": "fixed:S4",
  "D7 (br. 03)": "sync.dead_event_types",
  D9: "fixed:S4",
  D11: "fixed:S4",
  D12: "fixed:S5",
  D14: "fixed:S6",
  "br. 04 D1": "fixed:S6",
  "br. 04 D5": "fixed:I0",
  "br. 04 D6": "fixed:I0",
  "br. 04 D7": "fixed:S4",
  "br. 04 D8": "fixed:S2",
  "br. 04 D9/D10": "fixed:S6",
  "br. 04 D13": "fixed:S6",
  email_ctr: "fixed:S6",
  // Spoza tabeli §7, ale przywołany wprost w regułach SPEC §5.7.
  "D13 (br. 03)": "workflows.cancel_recipe_fires_on_pause",
};

/** Odłożone świadomie (SPEC §7 koniec, warunki powrotu §9.4). */
export const DEFERRED_DEFECTS: Readonly<Record<string, "deferred">> = {
  P06: "deferred",
  "P21 (wybór miejsc w kasie)": "deferred",
  "P09 (currency_options)": "deferred",
  "P25 (zdarzenie formularza kontaktu)": "deferred",
  "P07 jako ścieżka (fan-out)": "deferred",
  "A/B > 2 ramion i automatyczny zwycięzca": "deferred",
  "przenoszenie zapisów między wersjami": "deferred",
  "atrybucja przychodu do maili": "deferred",
  "deale/wartości w CRM i lifecyclestage do HubSpot": "deferred",
  "UTM dla rejestracji": "deferred",
  "okna kroczące lejka": "deferred",
  "nadpisania benchmarków per najemca": "deferred",
  "sankey/funnel jako rodzaj wykresu": "deferred",
  "DOI przez kolejkę": "deferred",
  "usunięcie /admin/monetization i monetization_dashboard": "deferred",
  "backfillSubscriptionAmounts przez API operatora": "deferred",
  "skróty klawiszowe huba": "deferred",
};

/** Reguły, które pilnują regresji danego defektu (odwrotność mapy). */
export function defectsOfCheck(checkId: RevenueCheckId): string[] {
  return Object.entries(DEFECT_MAP)
    .filter(([, target]) => target === checkId)
    .map(([id]) => id);
}
