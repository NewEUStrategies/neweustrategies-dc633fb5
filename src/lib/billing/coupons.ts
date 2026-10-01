// Współdzielone typy i pomocnicze funkcje dla kuponów B2B - używane przez
// klienta (walidacja live), serwer (checkout) oraz panel admina.

import { uiLocale } from "@/lib/i18n/format";

export type CouponDiscountKind = "percent" | "fixed";

export interface B2bCouponRow {
  id: string;
  code: string;
  name: string | null;
  description: string | null;
  discount_kind: CouponDiscountKind;
  discount_percent: number | null;
  discount_cents: number | null;
  currency: string | null;
  active: boolean;
  max_redemptions: number | null;
  redemptions_count: number;
  valid_from: string | null;
  valid_until: string | null;
  plan_ids: string[];
  organization_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ValidateCouponResult {
  ok: boolean;
  /**
   * Powód odmowy. Wszystkie warianty poza `technical_error` i `rate_limited`
   * są ORZECZENIEM O KUPONIE i pochodzą z RPC `validate_b2b_coupon`.
   *
   * `technical_error` jest inny z zasady: to brak orzeczenia. Zerwana sieć,
   * odmowa uprawnień do funkcji i awaria bazy NIE mówią nic o kodzie, który
   * klient wpisał, a wcześniej wszystkie mapowały się na `not_found` - czyli
   * na nieprawdziwe zdanie o pieniądzach („tego kuponu nie ma"), po którym
   * klient płaci pełną cenę albo rezygnuje.
   *
   * `rate_limited` to TEŻ brak orzeczenia: limit prób kodów (po IP i po
   * koncie, patrz `codeProbeLimit.server.ts` i `_coupon_probe_guard` w bazie)
   * odmawia ZANIM ktokolwiek spojrzy na kod. Pokazanie go jako „nie ma takiego
   * kodu" kłamałoby o ważnym kuponie tak samo jak dawne `not_found` z awarii.
   *
   * `per_user_limit_reached` i `no_discount` baza zwracała od dawna, ale typ
   * ich nie znał - ekran nie miał dla nich klucza i nie mówił NIC, czyli
   * inaczej niż przy pudle. Od 20261001100000 kod przypięty do wydarzeń,
   * nieaktywny albo z innego najemcy to zwykłe `not_found`; `inactive` zostaje
   * w typie tylko dla bazy sprzed tej migracji (kod idzie przed migracją).
   */
  error:
    | null
    | "empty_code"
    | "invalid_amount"
    | "not_found"
    | "inactive"
    | "not_yet_valid"
    | "expired"
    | "limit_reached"
    | "per_user_limit_reached"
    | "plan_not_eligible"
    | "no_discount"
    | "currency_mismatch"
    | "rate_limited"
    | "technical_error";
  coupon_id: string | null;
  discount_cents: number;
  final_cents: number;
  label: string | null;
  discount_kind: CouponDiscountKind | null;
  discount_percent: number | null;
}

/** Znormalizowany kod (upper, trim) - używamy go w kluczach cache i w wysyłce. */
export function normalizeCouponCode(input: string): string {
  return input.trim().toUpperCase();
}

/** Krótka etykieta rabatu do tooltipów: "-20%" lub "-50,00 PLN". */
export function formatDiscountLabel(
  kind: CouponDiscountKind | null,
  percent: number | null,
  cents: number | null,
  currency: string | null,
  locale: string,
): string {
  if (kind === "percent" && percent != null) return `-${percent}%`;
  if (kind === "fixed" && cents != null) {
    const value = cents / 100;
    const fmt = new Intl.NumberFormat(uiLocale(locale), {
      style: "currency",
      currency: (currency || "PLN").toUpperCase(),
      maximumFractionDigits: 2,
    });
    return `-${fmt.format(value)}`;
  }
  return "";
}

export const COUPON_ERROR_I18N_KEY: Record<NonNullable<ValidateCouponResult["error"]>, string> = {
  empty_code: "coupon.error.emptyCode",
  invalid_amount: "coupon.error.invalidAmount",
  not_found: "coupon.error.notFound",
  inactive: "coupon.error.inactive",
  not_yet_valid: "coupon.error.notYetValid",
  expired: "coupon.error.expired",
  limit_reached: "coupon.error.limitReached",
  per_user_limit_reached: "coupon.error.perUserLimitReached",
  plan_not_eligible: "coupon.error.planNotEligible",
  no_discount: "coupon.error.noDiscount",
  currency_mismatch: "coupon.error.currencyMismatch",
  rate_limited: "coupon.error.rateLimited",
  technical_error: "coupon.error.technicalError",
};

/**
 * Głowa komunikatu odmowy limitu prób kodów. Tę samą głowę rzuca baza
 * (`_coupon_probe_guard`: `rate_limited: too many code attempts, ...`) i ten
 * sam napis niesie `Error`, którym serwer przekazuje odmowę do przeglądarki.
 */
export const CODE_PROBE_RATE_LIMITED = "rate_limited";

const CODE_PROBE_RATE_LIMITED_MESSAGE = `${CODE_PROBE_RATE_LIMITED}: too many code attempts, try again later`;

function errorMessageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return typeof error.message === "string" ? error.message : "";
  }
  return "";
}

/**
 * Czy błąd to odmowa LIMITU PRÓB kodów - z bazy (obiekt błędu PostgREST,
 * zwykły obiekt `{ message }`) albo z serwera aplikacji (`Error`).
 *
 * Czytamy głowę komunikatu, bo tylko ona jest kontraktem: plpgsql dokleja po
 * dwukropku zdanie po angielsku, a PostgREST oddaje błąd jako zwykły obiekt,
 * nie `Error`.
 */
export function isCodeProbeRateLimited(error: unknown): boolean {
  return errorMessageOf(error).trim().toLowerCase().startsWith(CODE_PROBE_RATE_LIMITED);
}

/**
 * Błąd RPC kodu przygotowany do rzucenia z funkcji serwerowej.
 *
 * Odmowę limitu z bazy zamieniamy na zwykły `Error` z JEDNĄ stałą treścią
 * (`rate_limited: ...`): przeglądarka czyta ją jednym słownikiem
 * (`ticketCheckoutRefusal`, `isCodeProbeRateLimited`) i nie dostaje pól
 * `hint`/`details` błędu PostgREST. Dzięki temu odmowa limitu nigdy nie
 * wygląda jak odmowa KODU (ekran kasy zdejmowałby wtedy kod z pamięci
 * i płacił pełną cenę) ani jak „płatności nieskonfigurowane". Każdy inny błąd
 * wraca BEZ ZMIAN - ta funkcja nie zmienia zachowania żadnej innej awarii.
 */
export function codeProbeRpcError(error: unknown): unknown {
  return isCodeProbeRateLimited(error) ? new Error(CODE_PROBE_RATE_LIMITED_MESSAGE) : error;
}

/** Werdykt walidatora kodu po stronie serwera: sukces niesie kod, odmowa - wyłącznie powód. */
export type CouponVerdict =
  | {
      ok: true;
      error: null;
      coupon_id: string;
      discount_cents: number;
      final_cents: number;
      label: string | null;
      discount_kind: string | null;
      discount_percent: number | null;
    }
  | {
      ok: false;
      error: string | null;
      coupon_id: null;
      discount_cents: 0;
      final_cents: number;
      label: null;
      discount_kind: null;
      discount_percent: null;
    };

function field(source: object, key: string): unknown {
  return Object.hasOwn(source, key) ? Reflect.get(source, key) : undefined;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Werdykt `validate_b2b_coupon` / `validate_event_ticket_coupon` z odpowiedzi RPC.
 *
 * DWA KSZTAŁTY NA OKNO WDROŻENIA. Od migracji 20261001210000 walidator oddaje
 * JEDEN obiekt jsonb (wynik skalarny - PostgREST nie przefiltruje go i nie wycofa
 * zapisu pudła zależnie od odpowiedzi); wcześniej oddawał zbiór wierszy. Kod
 * aplikacji idzie razem z migracją albo przed nią, więc czyta oba.
 *
 * SUKCES BEZ `coupon_id` ALBO KWOTY KOŃCOWEJ TO BRAK WERDYKTU (`null`), a nie
 * rabat: wołający traktuje go jak „nie ma takiego kodu", czyli bez obniżki ceny.
 * Brak samej kwoty rabatu to rabat zero - też bez obniżki.
 */
export function parseCouponVerdict(data: unknown): CouponVerdict | null {
  const raw: unknown = Array.isArray(data) ? data[0] : data;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  if (field(raw, "ok") !== true) {
    return {
      ok: false,
      error: textOrNull(field(raw, "error")),
      coupon_id: null,
      discount_cents: 0,
      final_cents: finiteNumber(field(raw, "final_cents")) ?? 0,
      label: null,
      discount_kind: null,
      discount_percent: null,
    };
  }
  const couponId = textOrNull(field(raw, "coupon_id"));
  const finalCents = finiteNumber(field(raw, "final_cents"));
  if (couponId === null || finalCents === null) return null;
  return {
    ok: true,
    error: null,
    coupon_id: couponId,
    discount_cents: finiteNumber(field(raw, "discount_cents")) ?? 0,
    final_cents: finalCents,
    label: textOrNull(field(raw, "label")),
    discount_kind: textOrNull(field(raw, "discount_kind")),
    discount_percent: finiteNumber(field(raw, "discount_percent")),
  };
}
