// Skutek finansowy rezygnacji z WŁASNEGO zgłoszenia (REG-03, decyzja D9).
//
// JEDNA REGUŁA, DWA ODCZYTY. Baza liczy skutek w jednym miejscu
// (`_event_registration_refund_assess`): podgląd przed potwierdzeniem
// (`event_registration_cancel_preview`) i sama rezygnacja dostają ten sam
// wynik, a rezygnacja opłaconego zgłoszenia wymaga, żeby przeglądarka odesłała
// skutek, który uczestnik zobaczył (`acknowledged_effect`). Inny skutek niż
// bieżący to `refund_terms_changed` - ekran pyta wtedy jeszcze raz.
//
// NIEZNANY SKUTEK TO „DECYDUJE ORGANIZATOR", NIGDY „NIC". Gdyby nowsza baza
// zwróciła wartość, której ten front nie zna, zdanie „rezygnacja nie dotyczy
// płatności" obiecałoby coś, czego nie wiemy - a „o zwrocie zdecyduje
// organizator" jest prawdą przy każdym nieznanym przypadku.
//
// Moduł czysty (bez sieci) - parsery i reguły ekranu; RPC woła
// `publicRegistrationApi.ts`.

export const CANCELLATION_EFFECTS = [
  "none",
  "included_ticket",
  "full_refund",
  "no_refund",
  "organizer_review",
] as const;
export type CancellationEffect = (typeof CANCELLATION_EFFECTS)[number];

/** Skutki, które rezygnacja musi jawnie potwierdzić (`acknowledged_effect`). */
export const ACKNOWLEDGED_EFFECTS: readonly CancellationEffect[] = [
  "full_refund",
  "no_refund",
  "organizer_review",
];

/** Powody, dla których zwrot czeka na organizatora (CHECK `event_refund_jobs_review_reason_values`). */
export const REFUND_REVIEW_REASONS = [
  "outside_refund_window",
  "refund_disabled",
  "shared_payment",
  "manual_payment",
  "organizer_waived",
  "closed_without_refund_decision",
] as const;
export type RefundReviewReason = (typeof REFUND_REVIEW_REASONS)[number];

/** Odmowy rezygnacji, które podgląd zna z góry (ekran chowa wtedy przycisk). */
export const CANCELLATION_REFUSALS = ["already_closed", "event_finished", "event_ended"] as const;
export type CancellationRefusal = (typeof CANCELLATION_REFUSALS)[number];

export interface CancellationRefund {
  effect: CancellationEffect;
  reviewReason: RefundReviewReason | null;
  /** Kwota zwrotu w groszach; `null` przy wspólnej wpłacie (gość nie poznaje sumy płatnika). */
  amountCents: number | null;
  currency: string | null;
  refundMode: "policy" | "none" | null;
  /** Termin samodzielnego zwrotu (ISO) - tylko przy zasadzie „do terminu". */
  refundDeadlineAt: string | null;
  /** Goście grupy, których rezygnacja prowadzącego odwoła razem z nim. */
  groupGuestsClosing: number;
  acknowledgementRequired: boolean;
}

export type CancellationPreview =
  | {
      kind: "ok";
      registrationId: string;
      status: string;
      canCancel: boolean;
      refusal: CancellationRefusal | null;
      refund: CancellationRefund | null;
    }
  /** Klucz nieznany, cudzy albo zgłoszenie obcego najemcy - jedno zdanie, bez wyroczni. */
  | { kind: "not_found" }
  /** Klucz wygasł z końcem wydarzenia (REG-17). */
  | { kind: "expired" }
  /** Baza sprzed migracji (PGRST202/42883) - rezygnacja działa jak dotąd, bez skutku. */
  | { kind: "unavailable" };

/** Wynik rezygnacji: stan zlecenia zwrotu (organizator widzi go w dzienniku). */
export interface CancellationRefundResult {
  effect: CancellationEffect;
  jobState: "pending" | "needs_review" | "cancelled" | null;
  reviewReason: RefundReviewReason | null;
  amountCents: number | null;
  currency: string | null;
  refundDeadlineAt: string | null;
}

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

function text(source: Bag, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function int(source: Bag, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : null;
}

/** Nieznany albo brakujący skutek -> „decyduje organizator" (patrz nagłówek). */
export function cancellationEffectOf(value: unknown): CancellationEffect {
  return typeof value === "string"
    ? (oneOf(CANCELLATION_EFFECTS, value) ?? "organizer_review")
    : "organizer_review";
}

export function parseCancellationRefund(value: unknown): CancellationRefund | null {
  const source = bag(value);
  if (source === null) return null;
  const effect = cancellationEffectOf(source.effect);
  const mode = text(source, "refund_mode");
  return {
    effect,
    reviewReason: oneOf(REFUND_REVIEW_REASONS, text(source, "review_reason")),
    amountCents: int(source, "amount_cents"),
    currency: text(source, "currency"),
    refundMode: mode === "policy" || mode === "none" ? mode : null,
    refundDeadlineAt: text(source, "refund_deadline_at"),
    groupGuestsClosing: Math.max(int(source, "group_guests_closing") ?? 0, 0),
    // Flaga bazy wygrywa; bez niej liczymy z listy - stara odpowiedź nie może
    // zdjąć potwierdzenia z rezygnacji opłaconego zgłoszenia.
    acknowledgementRequired:
      source.acknowledgement_required === true || ACKNOWLEDGED_EFFECTS.includes(effect),
  };
}

export function parseCancellationPreview(value: unknown): CancellationPreview {
  const source = bag(value);
  if (source === null || source.ok !== true) {
    return source !== null && source.reason === "expired"
      ? { kind: "expired" }
      : { kind: "not_found" };
  }
  const registrationId = text(source, "registration_id");
  if (registrationId === null) return { kind: "not_found" };
  const rawRefusal = text(source, "refusal");
  const refusal = oneOf(CANCELLATION_REFUSALS, rawRefusal);
  // Odmowa, której nie znamy, nadal jest odmową (zdanie „zamknięte").
  const canCancel = source.can_cancel === true && rawRefusal === null;
  return {
    kind: "ok",
    registrationId,
    status: text(source, "status") ?? "pending",
    canCancel,
    refusal: canCancel ? null : (refusal ?? "already_closed"),
    refund: canCancel ? parseCancellationRefund(source.refund) : null,
  };
}

export function parseCancellationRefundResult(value: unknown): CancellationRefundResult | null {
  const source = bag(value);
  if (source === null) return null;
  const jobState = text(source, "job_state");
  return {
    effect: cancellationEffectOf(source.effect),
    jobState:
      jobState === "pending" || jobState === "needs_review" || jobState === "cancelled"
        ? jobState
        : null,
    reviewReason: oneOf(REFUND_REVIEW_REASONS, text(source, "review_reason")),
    amountCents: int(source, "amount_cents"),
    currency: text(source, "currency"),
    refundDeadlineAt: text(source, "refund_deadline_at"),
  };
}

/**
 * Skutek do odesłania z rezygnacją: tylko gdy baza go wymaga. Rezygnacja
 * bezpłatna jedzie bez klucza (zgodność wstecz), a podgląd niedostępny
 * (stara baza) - też bez, bo stara baza klucza nie zna.
 */
export function acknowledgedEffectFor(
  preview: CancellationPreview | null | undefined,
): CancellationEffect | undefined {
  if (preview?.kind !== "ok" || preview.refund === null) return undefined;
  return preview.refund.acknowledgementRequired ? preview.refund.effect : undefined;
}

/**
 * Czy rezygnacja może wystartować: podgląd wczytany i nie odmawia. Podgląd
 * niedostępny (stara baza) nie blokuje - rezygnacja działa wtedy jak dotąd.
 */
export function cancellationReady(preview: CancellationPreview | null | undefined): boolean {
  if (preview === null || preview === undefined) return false;
  if (preview.kind === "unavailable") return true;
  return preview.kind === "ok" && preview.canCancel;
}
