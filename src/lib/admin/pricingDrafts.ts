// Szkice edycyjne panelu Cennika 2.0 - kształt formularza i warunki zapisu.
//
// Reguły, nie prezentacja. Każdy `draftFrom*` mówi, co redakcja WIDZI po
// wczytaniu wiersza z bazy (w tym jak schodzą wartości puste: `null` w bazie to
// pusty input, nie napis "null"), a każdy `*Valid` mówi, kiedy wolno zapisać.
// Warunek zapisu to najdroższa reguła w tym panelu: pusta nazwa segmentu albo
// pytanie FAQ bez odpowiedzi po angielsku trafiłyby na stronę, na której klient
// wybiera plan.
//
// Wyniesione z pliku trasy `/admin/pricing`, gdzie 1821 linii wymuszało
// renderowanie całego panelu, żeby sprawdzić pojedynczy warunek.
import { slugKeyValid } from "@/lib/keyFormat";
import { parseTierBenefits, type MembershipTierRow, type TierBenefit } from "@/lib/billing/tiers";
import type { PricingAudienceRow, PricingFaqItemRow } from "@/lib/pricing/queries";
import type { RetentionReasonRow, RetentionSettingsRow } from "@/lib/retention/queries";

// --- Segmenty odbiorców -----------------------------------------------------

/** Ikony dostępne dla segmentu - zbiór wspólny ze stroną publiczną. */
export const ICON_OPTIONS = [
  "user",
  "users",
  "building-2",
  "graduation-cap",
  "landmark",
  "sparkles",
] as const;

export interface AudienceDraft {
  name_pl: string;
  name_en: string;
  tagline_pl: string;
  tagline_en: string;
  trust_pl: string;
  trust_en: string;
  icon: string;
  active: boolean;
}

export function draftFromAudience(row: PricingAudienceRow): AudienceDraft {
  return {
    name_pl: row.name_pl,
    name_en: row.name_en,
    tagline_pl: row.tagline_pl ?? "",
    tagline_en: row.tagline_en ?? "",
    trust_pl: row.trust_pl ?? "",
    trust_en: row.trust_en ?? "",
    icon: row.icon,
    active: row.active,
  };
}

/** Segment bez nazwy w OBU językach nie może trafić na stronę cennika. */
export function audienceDraftValid(draft: AudienceDraft): boolean {
  return draft.name_pl.trim().length > 0 && draft.name_en.trim().length > 0;
}

/**
 * Nowy klucz segmentu: format wspólny z kluczami warstw (`slugKeyValid`) i brak
 * kolizji z istniejącym segmentem.
 */
export function audienceKeyValid(key: string, existingKeys: readonly string[]): boolean {
  return slugKeyValid(key, existingKeys);
}

// --- Marketing warstw -------------------------------------------------------

/** Wartość selecta oznaczająca „warstwa nieprzypisana do segmentu". */
export const NO_AUDIENCE = "none";

/** Tryby przycisku zakupu: automatyczny, kontakt z działem, brak przycisku. */
export const CTA_MODES = ["auto", "contact", "none"] as const;

export interface TierMarketingDraft {
  audience_key: string;
  badge_pl: string;
  badge_en: string;
  highlight: boolean;
  contact_url: string;
  cta_mode: string;
  per_seat: boolean;
  price_note_pl: string;
  price_note_en: string;
  benefits: TierBenefit[];
}

export function draftFromTier(tier: MembershipTierRow): TierMarketingDraft {
  return {
    audience_key: tier.audience_key ?? NO_AUDIENCE,
    badge_pl: tier.badge_pl ?? "",
    badge_en: tier.badge_en ?? "",
    highlight: tier.highlight,
    contact_url: tier.contact_url ?? "",
    // Nieznany tryb z bazy schodzi na „auto": panel nie może zablokować
    // przycisku zakupu tylko dlatego, że ktoś dopisał wartość ręcznie w SQL.
    cta_mode: CTA_MODES.includes(tier.cta_mode as (typeof CTA_MODES)[number])
      ? tier.cta_mode
      : "auto",
    per_seat: tier.per_seat,
    price_note_pl: tier.price_note_pl ?? "",
    price_note_en: tier.price_note_en ?? "",
    benefits: parseTierBenefits(tier.benefits),
  };
}

// --- FAQ cennika ------------------------------------------------------------

/** Wartość selecta oznaczająca pytanie wspólne dla wszystkich segmentów. */
export const GLOBAL_FAQ = "global";

export interface FaqDraft {
  question_pl: string;
  question_en: string;
  answer_pl: string;
  answer_en: string;
  audience_key: string;
  active: boolean;
}

export function draftFromFaq(row: PricingFaqItemRow): FaqDraft {
  return {
    question_pl: row.question_pl,
    question_en: row.question_en,
    answer_pl: row.answer_pl,
    answer_en: row.answer_en,
    audience_key: row.audience_key ?? GLOBAL_FAQ,
    active: row.active,
  };
}

export const EMPTY_FAQ_DRAFT: FaqDraft = {
  question_pl: "",
  question_en: "",
  answer_pl: "",
  answer_en: "",
  audience_key: GLOBAL_FAQ,
  active: true,
};

/**
 * Pytanie FAQ wymaga PEŁNEJ pary językowej - pytania i odpowiedzi po polsku
 * i po angielsku. Połowiczne pytanie zniknęłoby w jednej z wersji strony.
 */
export function faqDraftValid(draft: FaqDraft): boolean {
  return (
    draft.question_pl.trim().length > 0 &&
    draft.question_en.trim().length > 0 &&
    draft.answer_pl.trim().length > 0 &&
    draft.answer_en.trim().length > 0
  );
}

/** Zamiana wartości selecta na kolumnę bazy: „global" to brak segmentu. */
export function faqAudienceColumn(audienceKey: string): string | null {
  return audienceKey === GLOBAL_FAQ ? null : audienceKey;
}

// --- Retencja odchodzących --------------------------------------------------

export interface RetentionSettingsDraft {
  enabled: boolean;
  discount_pct: string;
  discount_periods: string;
  coupon_valid_days: string;
}

/**
 * Domyślne 30% na 3 okresy przy kodzie ważnym 14 dni obowiązują, DOPÓKI
 * redakcja nie zapisze własnych - brak wiersza w bazie nie wyłącza kontroferty.
 */
export function settingsDraftFromRow(row: RetentionSettingsRow | null): RetentionSettingsDraft {
  return {
    enabled: row?.enabled ?? true,
    discount_pct: String(row?.discount_pct ?? 30),
    discount_periods: String(row?.discount_periods ?? 3),
    coupon_valid_days: String(row?.coupon_valid_days ?? 14),
  };
}

/**
 * Liczba z pola tekstowego przycięta do zakresu. Pilnuje pieniędzy: rabat 900%
 * albo -30% nie może wyjść z panelu do generatora kuponów.
 */
export function clampInt(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export interface ReasonDraft {
  label_pl: string;
  label_en: string;
  active: boolean;
}

export function reasonDraftFromRow(row: RetentionReasonRow): ReasonDraft {
  return { label_pl: row.label_pl, label_en: row.label_en, active: row.active };
}
