// Eksporty CSV powierzchni kuponów - dwa arkusze, jedno miejsce.
//
// SKŁADANIE ARKUSZA BYŁO W CIELE KOMPONENTU dwa razy: kody kampanii
// (`admin.coupons.campaigns.tsx`, dawne 135-143) i historia realizacji
// (`admin.coupons.redemptions.tsx`, dawne 81-89). Za każdym razem obok kodu
// tworzącego Blob, adres obiektowy i kotwicę - czyli obok rzeczy, których pod
// happy-dom nie da się zaobserwować bez trzech atrap. Dlatego wychodzi stąd
// SAM TEKST PLIKU i SAMA NAZWA PLIKU, a strona zostaje z pobraniem.
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADAMI - i to jest tu najważniejsze zdanie:
//   * pola NIE SĄ cytowane. Nazwa kuponu ze średnikiem rozsuwa kolumny w całym
//     arkuszu, a nazwa z nową linią rozbija wiersz na dwa;
//   * nazwa pliku jest tylko `replace(/\s+/g, "_")`, więc „/" i „.." z nazwy
//     kampanii trafiają żywcem do atrybutu `download`.
// Jedno i drugie zostaje NIENARUSZONE i jest zgłoszone przez `it.fails`
// w `src/lib/billing/__tests__/couponCsv.test.ts`. Refaktoryzacja i naprawa
// nie jadą w jednym kroku.
import { couponPaidCents, type CouponRedemptionAmounts } from "./couponMoney";

/** Wiersz kuponu w eksporcie kodów kampanii. */
export interface CampaignCodeCsvRow {
  readonly code: string;
  readonly name: string | null;
  readonly active: boolean;
  readonly valid_until: string | null;
  readonly max_redemptions: number | null;
  readonly redemptions_count: number;
}

/** Nagłówek arkusza kodów - kontrakt danych, nie napis interfejsu. */
export const CAMPAIGN_CODES_CSV_HEADER =
  "code;name;active;valid_until;max_redemptions;redemptions_count";

/** Treść pliku z kodami kampanii (z nagłówkiem, bez cytowania pól). */
export function campaignCodesCsv(rows: readonly CampaignCodeCsvRow[]): string {
  const body = rows
    .map(
      (r) =>
        `${r.code};${r.name ?? ""};${r.active};${r.valid_until ?? ""};${
          r.max_redemptions ?? ""
        };${r.redemptions_count}`,
    )
    .join("\n");
  return `${CAMPAIGN_CODES_CSV_HEADER}\n${body}`;
}

/** Nazwa pliku z kodami kampanii - jedyna „sanityzacja" to spacje na podkreślniki. */
export function campaignCodesCsvFileName(campaignName: string): string {
  return `coupons-${campaignName.replace(/\s+/g, "_")}.csv`;
}

/** Wiersz realizacji w eksporcie historii. */
export interface RedemptionCsvRow extends CouponRedemptionAmounts {
  readonly created_at: string;
  readonly user_id: string | null;
  readonly order_id: string | null;
  readonly currency: string;
  readonly b2b_coupons: { readonly code: string } | null;
}

/**
 * Nagłówek arkusza realizacji. Kolumny nazwane po ZNACZENIU: `discount` to
 * `applied_cents` (rabat), `paid` to `original - applied`. Poprzedni „applied"
 * sugerował kwotę zapłaconą i utrwalał inwersję w każdym arkuszu.
 */
export const REDEMPTIONS_CSV_HEADER = "date;code;user_id;order_id;original;discount;paid;currency";

/** Treść pliku z historią realizacji (z nagłówkiem, bez cytowania pól). */
export function redemptionsCsv(rows: readonly RedemptionCsvRow[]): string {
  const body = rows
    .map(
      (r) =>
        `${r.created_at};${r.b2b_coupons?.code ?? ""};${r.user_id ?? ""};${r.order_id ?? ""};${
          r.original_cents / 100
        };${r.applied_cents / 100};${couponPaidCents(r) / 100};${r.currency}`,
    )
    .join("\n");
  return `${REDEMPTIONS_CSV_HEADER}\n${body}`;
}

/** Nazwa pliku z historią realizacji - datowana dniem eksportu. */
export function redemptionsCsvFileName(now: Date): string {
  return `coupon-redemptions-${now.toISOString().slice(0, 10)}.csv`;
}
