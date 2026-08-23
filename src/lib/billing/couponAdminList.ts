// Lista kuponów B2B - REGUŁY wyjęte z ciała `CouponsListPage`
// (`src/routes/admin.coupons.index.tsx`, linie 126-153 i 254-267 przed ekstrakcją).
//
// CO TU JEST REGUŁĄ, A NIE UKŁADEM.
//
//   1. DWIE DEFINICJE „WYGASŁEGO" STAŁY W JEDNYM PLIKU I SIĘ ROZJEŻDŻAŁY.
//      Filtr odrzucał wiersz warunkiem `getTime() >= now`, a kafel liczył go
//      warunkiem `getTime() < Date.now()`. Dla daty nieparsowalnej (`NaN`) OBA
//      warunki są fałszem, więc ten sam wiersz JEST na liście „Wygasłe"
//      i NIE JEST w liczniku „Wygasłe". Rozjazd zostaje przeniesiony tutaj
//      w niezmienionej postaci - jest przedmiotem zgłoszenia, nie poprawki.
//   2. FORMATOWANIE KWOTY I PROCENTU to decyzja o pieniądzach: `null` centów
//      wypisuje `0.00` (kupon wygląda na darmowy), brak waluty zostawia
//      wiszącą liczbę, a `null` procentu daje literalne `null%`. Repo ma
//      poprawny formatter z walutą (`formatDiscountLabel` w `./coupons`),
//      którego ten panel NIE używa - i to też jest tutaj widoczne wprost.
//   3. FORMATOWANIE DATY przez `toLocaleDateString(lang)` NIE rzuca dla daty
//      nieparsowalnej - oddaje napis „Invalid Date", który trafia na ekran.
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADAMI. Jedyna zmiana wobec oryginału jest
// mechaniczna: `now` wchodzi PARAMETREM zamiast być czytane z `Date.now()`
// w środku - dzięki temu test nie ściga się z zegarem, a wynik dla tej samej
// chwili jest identyczny.
//
// GRANICA WARSTW: zero Reacta, zero i18n, zero klienta Supabase.
import type { CouponDiscountKind } from "./coupons";

/** Wartość filtra statusu w pasku narzędzi listy. */
export type CouponListStatus = "all" | "active" | "inactive" | "expired";

/** Pola wiersza, których dotykają reguły listy - nic ponadto. */
export interface CouponListRow {
  code: string;
  name: string | null;
  active: boolean;
  redemptions_count: number;
  valid_until: string | null;
}

/** Stan pasków filtrowania listy. */
export interface CouponListFilter {
  search: string;
  status: CouponListStatus;
}

/** Liczby w czterech kaflach nad listą. */
export interface CouponListStats {
  total: number;
  active: number;
  redemptions: number;
  expired: number;
}

/**
 * Widoczne wiersze. Szukanie obejmuje kod I nazwę, bez rozróżniania wielkości
 * liter; `name === null` liczy się jak pusty napis, a nie jak brak dopasowania.
 */
export function filterCoupons<Row extends CouponListRow>(
  rows: readonly Row[],
  filter: CouponListFilter,
  now: number,
): Row[] {
  return rows.filter((c) => {
    if (filter.search) {
      const s = filter.search.toLowerCase();
      if (!c.code.toLowerCase().includes(s) && !(c.name ?? "").toLowerCase().includes(s)) {
        return false;
      }
    }
    if (filter.status === "active" && !c.active) return false;
    if (filter.status === "inactive" && c.active) return false;
    if (filter.status === "expired") {
      if (!c.valid_until || new Date(c.valid_until).getTime() >= now) return false;
    }
    return true;
  });
}

/**
 * Kafle liczone na PEŁNYM zbiorze (nie na przefiltrowanym) - dlatego zmiana
 * filtra nie zmienia liczb nad tabelą.
 */
export function couponListStats(rows: readonly CouponListRow[], now: number): CouponListStats {
  return {
    total: rows.length,
    active: rows.filter((c) => c.active).length,
    redemptions: rows.reduce((s, c) => s + (c.redemptions_count || 0), 0),
    expired: rows.filter((c) => c.valid_until && new Date(c.valid_until).getTime() < now).length,
  };
}

/** `10.00 PLN` - brak centów udaje zero, brak waluty zostawia wiszącą spację. */
export function formatCouponAmount(cents: number | null, currency: string | null): string {
  return `${((cents ?? 0) / 100).toFixed(2)} ${currency ?? ""}`;
}

/** Treść komórki „Rabat": procent albo kwota, zależnie od rodzaju rabatu. */
export function formatCouponDiscount(
  kind: CouponDiscountKind,
  percent: number | null,
  cents: number | null,
  currency: string | null,
): string {
  return kind === "percent" ? `${percent}%` : formatCouponAmount(cents, currency);
}

/** Data w formacie języka interfejsu; nieparsowalna oddaje „Invalid Date". */
export function formatCouponDate(iso: string, lang: string): string {
  return new Date(iso).toLocaleDateString(lang);
}
