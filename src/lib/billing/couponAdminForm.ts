// Formularz „Nowy kupon B2B" - REGUŁY wyjęte z ciała `CouponCreateDialog`
// (`src/routes/admin.coupons.index.tsx`, linie 363-401 przed ekstrakcją).
//
// CO TU JEST REGUŁĄ, A NIE UKŁADEM.
//
//   1. TRZY BRAMKI PRZED ZAPISEM. Kod po normalizacji nie może być pusty,
//      procent musi mieścić się w 1-100, kwota musi być dodatnia. To nie jest
//      jedyna linia obrony - `b2b_coupons` ma własne CHECK-i (`discount_percent
//      BETWEEN 1 AND 100`, `discount_cents > 0`, `max_redemptions > 0` i XOR
//      `b2b_coupons_discount_shape`) - ale to JEDYNA linia, która potrafi
//      powiedzieć redaktorowi po polsku, KTÓRE pole poprawić. Bez niej panel
//      wysyła ładunek skazany na odmowę i pokazuje surowy komunikat Postgresa.
//   2. KSZTAŁT ŁADUNKU. Dokładnie jedno z pól `discount_percent` /
//      `discount_cents` jest niepuste, bo oba liczą się z BIEŻĄCEGO `kind` -
//      wartość porzucona w stanie po przełączeniu typu nie wychodzi na zewnątrz.
//      `currency` jedzie wyłącznie przy rabacie kwotowym.
//   3. KONWERSJE POLI TEKSTOWYCH. `max_redemptions` i `grants_duration_days`
//      przychodzą z inputów jako STRING i są przepuszczane przez `Number(...)`
//      dopiero tutaj, z bramką na pusty string (pusty = „bez limitu" = null).
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADAMI. Ekstrakcja nie jest naprawą:
//   * `percent`/`cents` przychodzą jako `number`, bo takie są w stanie dialogu
//     (`useState<number>` zasilany `Number(e.target.value)`). `NaN` przechodzi
//     obie bramki zakresu (`NaN < 1` i `NaN > 100` są fałszem) i ląduje
//     w ładunku - to defekt zgłoszony testem, nie coś do cichego zaciśnięcia.
//   * `maxRedemptions: "12abc"` daje `NaN`, a `JSON.stringify` zamienia `NaN`
//     na `null`, czyli kupon BEZ LIMITU zamiast błędu.
//   * `grants_duration_days` NIE jest bramkowane przez `grants_tier_key`
//     (odwrotnie niż w kampaniach) - sierota wychodzi do bazy.
//   * `validFrom`/`validUntil` przechodzą przez `toISOString()`, który dla
//     `Invalid Date` RZUCA `RangeError` - `buildCouponInsert` rzuca razem z nim.
//
// GRANICA WARSTW: zero Reacta, zero i18n, zero klienta Supabase. Wychodzą stąd
// KLUCZE i18n, nigdy gotowy tekst.
import { normalizeCouponCode, type CouponDiscountKind } from "./coupons";

/** Klucz komunikatu odmowy - tłumaczy go dopiero warstwa widoku. */
export type CouponFormErrorKey =
  "adminCoupons.enterCode" | "adminCoupons.percent1100" | "adminCoupons.amount0";

/** Stan formularza dokładnie w tych typach, w jakich trzyma go dialog. */
export interface CouponFormInput {
  code: string;
  name: string;
  description: string;
  kind: CouponDiscountKind;
  /** `number`, bo input liczbowy przechodzi przez `Number(...)` już w `onChange`. */
  percent: number;
  cents: number;
  currency: string;
  /** STRING - pusty oznacza „bez limitu". */
  maxRedemptions: string;
  validFrom: Date | undefined;
  validUntil: Date | undefined;
  planIds: string[];
  grantsTierKey: string;
  /** STRING - pusty oznacza „bezterminowo". */
  grantsDurationDays: string;
}

/** Wiersz wstawiany do `b2b_coupons` - kolumny w kolejności z formularza. */
export interface CouponInsert {
  code: string;
  name: string | null;
  description: string | null;
  discount_kind: CouponDiscountKind;
  discount_percent: number | null;
  discount_cents: number | null;
  currency: string | null;
  max_redemptions: number | null;
  valid_from: string | null;
  valid_until: string | null;
  plan_ids: string[];
  grants_tier_key: string | null;
  grants_duration_days: number | null;
}

/** Wynik walidacji: zgoda albo KLUCZ komunikatu, nigdy gotowy napis. */
export type CouponFormValidation = { ok: true } | { ok: false; errorKey: CouponFormErrorKey };

/**
 * Trzy bramki przed wysłaniem, w tej samej kolejności, co w dialogu: pusty kod
 * wygrywa z zakresem procentu, a zakres procentu z kwotą (bo zależą od `kind`).
 */
export function validateCouponForm(form: CouponFormInput): CouponFormValidation {
  const norm = normalizeCouponCode(form.code);
  if (!norm) {
    return { ok: false, errorKey: "adminCoupons.enterCode" };
  }
  if (form.kind === "percent" && (form.percent < 1 || form.percent > 100)) {
    return { ok: false, errorKey: "adminCoupons.percent1100" };
  }
  if (form.kind === "fixed" && form.cents <= 0) {
    return { ok: false, errorKey: "adminCoupons.amount0" };
  }
  return { ok: true };
}

/**
 * Ładunek `insert` dla `b2b_coupons`.
 *
 * RZUCA `RangeError` dla nieparsowalnej daty (`toISOString`) - tak samo, jak
 * robił to dialog przed ekstrakcją. To zachowanie jest przedmiotem zgłoszenia
 * (`it.fails`), a nie ciche do poprawienia przy przenoszeniu.
 */
export function buildCouponInsert(form: CouponFormInput): CouponInsert {
  return {
    code: normalizeCouponCode(form.code),
    name: form.name.trim() || null,
    description: form.description.trim() || null,
    discount_kind: form.kind,
    discount_percent: form.kind === "percent" ? form.percent : null,
    discount_cents: form.kind === "fixed" ? form.cents : null,
    currency: form.kind === "fixed" ? form.currency.toUpperCase() : null,
    max_redemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
    valid_from: form.validFrom ? form.validFrom.toISOString() : null,
    valid_until: form.validUntil ? form.validUntil.toISOString() : null,
    plan_ids: form.planIds,
    grants_tier_key: form.grantsTierKey || null,
    grants_duration_days: form.grantsDurationDays ? Number(form.grantsDurationDays) : null,
  };
}
