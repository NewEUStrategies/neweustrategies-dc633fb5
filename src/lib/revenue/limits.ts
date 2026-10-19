// LIMITY I SŁOWNIKI DANYCH PRZYCHODU - lustro CHECK-ów z migracji huba
// 20261020090000 (księga przychodu), 20261020090100 (lejek i operacje)
// i 20261020090500 (dziennik błędów emiterów).
//
// PO CO LUSTRO. Te same liczby czytają schematy zod server fns, liczniki
// znaków w formularzach i komunikaty błędów. AGENTS: wartość za długa jest
// ODRZUCANA z komunikatem, nigdy przycinana - więc licznik w UI musi znać
// dokładnie ten limit, który egzekwuje baza. Rozjazd pilnuje
// `revenueLimitsParity.test.ts`, który parsuje CHECK-i z plików migracji.

export const REVENUE_LIMITS = {
  /** `revenue_event_marks.ref` - identyfikator obiektu znakowanego zdarzeniem. */
  eventMarkRefMax: 200,
  /** `paywall_hits.variant` - wariant paywalla z pomiaru. */
  paywallVariantPattern: /^[a-z0-9_-]{1,32}$/,
  /** `paywall_hits.visitor_hash` - skrót identyfikatora gościa. */
  visitorHashMin: 16,
  visitorHashMax: 128,
  /** `checkout_settings.abandon_after_minutes` - po ilu minutach kasa jest porzucona. */
  checkoutAbandonMinutesMin: 30,
  checkoutAbandonMinutesMax: 1440,
  checkoutAbandonMinutesDefault: 1440,
  /** `revenue_manual_inputs.note`. */
  inputNoteMax: 500,
  /** `revenue_manual_inputs.ratio` - udział (marża, koszt) jako ułamek. */
  inputRatioMin: -1,
  inputRatioMax: 1,
  /** `revenue_diagnostic_snoozes.check_id` - `obszar.nazwa` reguły diagnostyki. */
  checkIdPattern: /^[a-z_]+\.[a-z_]+$/,
  scopeKeyMax: 200,
  scopeHashMax: 64,
  /** Powód wyciszenia: liczony PO obcięciu białych znaków (`btrim` w SQL). */
  snoozeReasonMin: 3,
  snoozeReasonMax: 500,
  /** Wyciszenie „na dni" nie dłużej niż pół roku od utworzenia. */
  snoozeMaxDays: 180,
} as const;

/** `domain_event_emit_errors` - dziennik awarii emiterów zdarzeń (090500). */
export const EMIT_ERROR_LIMITS = {
  sourceMax: 120,
  errorMax: 2000,
} as const;

/** Rodzaj ruchu MRR (`mrr_movements.kind`). */
export const MRR_MOVEMENT_KINDS = [
  "new",
  "expansion",
  "contraction",
  "churn",
  "reactivation",
] as const;
export type MrrMovementKind = (typeof MRR_MOVEMENT_KINDS)[number];

/** Przyczyna ruchu MRR (`mrr_movements.reason`). */
export const MRR_MOVEMENT_REASONS = [
  "signup",
  "trial_converted",
  "plan_change",
  "quantity",
  "price",
  "discount",
  "canceled",
  "unpaid",
  "paused",
  "resumed",
  "currency_switch",
  "backfill",
] as const;
export type MrrMovementReason = (typeof MRR_MOVEMENT_REASONS)[number];

/** Wynik cyklu windykacji (`dunning_cycles.outcome`). */
export const DUNNING_OUTCOMES = ["open", "recovered", "lost"] as const;
export type DunningOutcome = (typeof DUNNING_OUTCOMES)[number];

/** Znaczniki jednorazowych zdarzeń skanerów (`revenue_event_marks.kind`). */
export const REVENUE_EVENT_MARK_KINDS = [
  "trial_ending",
  "expired",
  "quota",
  "retention_abandoned",
  "dunning_lost",
  "mrr_snapshot",
] as const;
export type RevenueEventMarkKind = (typeof REVENUE_EVENT_MARK_KINDS)[number];

/** Rodzaj treści za paywallem (`paywall_hits.entity_type`). */
export const PAYWALL_ENTITY_TYPES = ["post", "page", "media", "club", "event"] as const;
export type PaywallEntityType = (typeof PAYWALL_ENTITY_TYPES)[number];

/** Powód zatrzymania na paywallu (`paywall_hits.reason`). */
export const PAYWALL_HIT_REASONS = [
  "members",
  "paid",
  "tier_rank",
  "password",
  "quota",
  "registration",
] as const;
export type PaywallHitReason = (typeof PAYWALL_HIT_REASONS)[number];

/** Wynik przepływu anulowania (`retention_feedback.outcome`). */
export const RETENTION_OUTCOMES = ["started", "saved", "canceled", "abandoned"] as const;
export type RetentionOutcome = (typeof RETENTION_OUTCOMES)[number];

/** Rodzaj danych wejściowych planu i kosztów (`revenue_manual_inputs.kind`). */
export const REVENUE_INPUT_KINDS = [
  "mrr_plan",
  "new_customers_plan",
  "sales_marketing_cost",
  "cogs",
  "gross_margin_pct",
  "ebitda_margin_pct",
] as const;
export type RevenueInputKind = (typeof REVENUE_INPUT_KINDS)[number];

/** Rodzaj wyciszenia diagnozy (`revenue_diagnostic_snoozes.kind`). */
export const SNOOZE_KINDS = ["days", "intentional"] as const;
export type SnoozeKind = (typeof SNOOZE_KINDS)[number];
