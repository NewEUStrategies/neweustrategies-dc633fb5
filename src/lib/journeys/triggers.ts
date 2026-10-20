// WYZWALACZE ŚCIEŻEK - katalog zdarzeń szyny, na które ścieżka może czekać
// (wejście, cel, wyjście, `wait.until_event`), z polami warunku.
//
// Warunek wyzwalacza to `payload @> condition` (trasa i skrzynka w SQL), więc
// pole warunku MUSI być kluczem ładunku emitera, a wartość - wartością, którą
// emiter tam wpisuje. Literówka w kluczu nie daje błędu, tylko ścieżkę, która
// nigdy nikogo nie zapisze - dlatego katalog niesie klucze ładunku z kontraktu
// emiterów (SPEC §4.5, migracje S1-S4) i test `triggers.test.ts` sprawdza, że
// każde pole warunku jest jednym z nich, a każdy wyzwalacz - typem z
// `DOMAIN_EVENT_TYPES`.
//
// `identity` mówi, skąd silnik weźmie kontakt (`journey_resolve_lead`):
// konto, osoba wydarzeń, lead albo subskrybent.
import { SIGNUP_SOURCES } from "@/lib/revenue/funnel/funnelStages";
import {
  PAYWALL_ENTITY_TYPES,
  PAYWALL_HIT_REASONS,
  RETENTION_OUTCOMES,
} from "@/lib/revenue/limits";
import { LIFECYCLE_STAGES } from "@/lib/crm/lifecycle";
import type { DomainEventType } from "@/lib/realtime/domainEvents";
import { CRM_STAGES } from "./predicates";

export type TriggerFieldType = "enum" | "boolean" | "string";

export interface TriggerConditionField {
  /** Klucz ładunku zdarzenia (`payload ->> key`). */
  key: string;
  type: TriggerFieldType;
  options?: readonly string[];
}

export type TriggerIdentity = "user" | "person" | "lead" | "subscriber";

export type TriggerGroup =
  "account" | "funnel" | "billing" | "retention" | "events" | "community" | "crm" | "newsletter";

export interface JourneyTriggerDef {
  eventType: DomainEventType;
  group: TriggerGroup;
  identity: TriggerIdentity;
  /** Klucze ładunku z kontraktu emitera (bez PII). */
  payloadKeys: readonly string[];
  conditionFields: readonly TriggerConditionField[];
  /**
   * Maile zakazane przy tym wyzwalaczu: windykacja należy do
   * `dunning.server.ts` - ścieżka może tylko zadania i etapy CRM.
   */
  emailForbidden?: boolean;
}

const BOOL = (key: string): TriggerConditionField => ({ key, type: "boolean" });
const ENUM = (key: string, options: readonly string[]): TriggerConditionField => ({
  key,
  type: "enum",
  options,
});

const CHECKOUT_KEYS = [
  "order_id",
  "user_id",
  "kind",
  "plan_id",
  "tier_key",
  "event_id",
  "amount_minor",
  "currency",
  "has_coupon",
] as const;
const CHECKOUT_FIELDS = [
  ENUM("kind", ["subscription", "one_time"]),
  { key: "tier_key", type: "string" },
  BOOL("has_coupon"),
] as const satisfies readonly TriggerConditionField[];
const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
];

export const JOURNEY_TRIGGERS: readonly JourneyTriggerDef[] = [
  {
    eventType: "account.registered.v1",
    group: "account",
    identity: "user",
    payloadKeys: ["user_id", "signup_source", "marketing_opt_in", "has_attribution"],
    conditionFields: [
      ENUM("signup_source", [...SIGNUP_SOURCES, "unknown"]),
      BOOL("marketing_opt_in"),
    ],
  },
  {
    eventType: "newsletter_subscriber.confirmed.v1",
    group: "newsletter",
    identity: "subscriber",
    payloadKeys: ["language", "source"],
    conditionFields: [ENUM("language", ["pl", "en"]), { key: "source", type: "string" }],
  },
  {
    eventType: "newsletter_subscriber.subscribed.v1",
    group: "newsletter",
    identity: "subscriber",
    payloadKeys: ["language", "status", "source"],
    conditionFields: [ENUM("language", ["pl", "en"]), { key: "source", type: "string" }],
  },
  {
    eventType: "paywall.hit.v1",
    group: "funnel",
    identity: "user",
    payloadKeys: ["user_id", "entity_type", "entity_id", "reason", "required_tier_key", "variant"],
    conditionFields: [
      ENUM("reason", PAYWALL_HIT_REASONS),
      ENUM("entity_type", PAYWALL_ENTITY_TYPES),
      { key: "required_tier_key", type: "string" },
    ],
  },
  {
    eventType: "metering.quota_exhausted.v1",
    group: "funnel",
    identity: "user",
    payloadKeys: ["user_id", "period_month", "limit"],
    conditionFields: [],
  },
  {
    eventType: "checkout.started.v1",
    group: "funnel",
    identity: "user",
    payloadKeys: CHECKOUT_KEYS,
    conditionFields: CHECKOUT_FIELDS,
  },
  {
    eventType: "checkout.completed.v1",
    group: "funnel",
    identity: "user",
    payloadKeys: CHECKOUT_KEYS,
    conditionFields: CHECKOUT_FIELDS,
  },
  {
    eventType: "checkout.failed.v1",
    group: "funnel",
    identity: "user",
    payloadKeys: [...CHECKOUT_KEYS, "reason"],
    conditionFields: CHECKOUT_FIELDS,
  },
  {
    eventType: "checkout.abandoned.v1",
    group: "funnel",
    identity: "user",
    payloadKeys: [...CHECKOUT_KEYS, "reason"],
    conditionFields: CHECKOUT_FIELDS,
  },
  {
    eventType: "billing_subscription.status_changed.v1",
    group: "billing",
    identity: "user",
    payloadKeys: [
      "subscription_id",
      "user_id",
      "old_status",
      "new_status",
      "paused",
      "cancel_at_period_end",
      "price_id",
    ],
    conditionFields: [
      ENUM("new_status", SUBSCRIPTION_STATUSES),
      ENUM("old_status", SUBSCRIPTION_STATUSES),
      BOOL("paused"),
      BOOL("cancel_at_period_end"),
    ],
  },
  {
    eventType: "billing_subscription.payment_failed.v1",
    group: "billing",
    identity: "user",
    payloadKeys: ["subscription_id", "user_id", "failure_count", "price_id"],
    conditionFields: [],
    emailForbidden: true,
  },
  {
    eventType: "billing_subscription.payment_recovered.v1",
    group: "billing",
    identity: "user",
    payloadKeys: ["subscription_id", "user_id", "failure_count", "price_id"],
    conditionFields: [],
  },
  {
    eventType: "billing_subscription.trial_ending.v1",
    group: "billing",
    identity: "user",
    payloadKeys: ["subscription_id", "user_id", "trial_ends_at"],
    conditionFields: [],
  },
  {
    eventType: "subscription.renewed.v1",
    group: "billing",
    identity: "user",
    payloadKeys: ["subscription_id", "user_id", "document_id"],
    conditionFields: [],
  },
  {
    eventType: "subscription.expired.v1",
    group: "billing",
    identity: "user",
    payloadKeys: ["subscription_id", "user_id", "tier_key", "reason"],
    conditionFields: [
      ENUM("reason", ["canceled", "unpaid", "ended", "paused"]),
      { key: "tier_key", type: "string" },
    ],
  },
  {
    eventType: "retention_flow.started.v1",
    group: "retention",
    identity: "user",
    payloadKeys: ["feedback_id", "user_id", "subscription_id"],
    conditionFields: [],
  },
  {
    eventType: "retention_flow.completed.v1",
    group: "retention",
    identity: "user",
    payloadKeys: [
      "feedback_id",
      "user_id",
      "subscription_id",
      "outcome",
      "reason_key",
      "offer_shown",
      "offer_accepted",
    ],
    conditionFields: [
      ENUM("outcome", RETENTION_OUTCOMES),
      { key: "reason_key", type: "string" },
      BOOL("offer_accepted"),
    ],
  },
  {
    eventType: "event.registration.created.v1",
    group: "events",
    identity: "person",
    payloadKeys: ["event_id", "person_id", "status", "ticket_type_id", "source"],
    conditionFields: [
      ENUM("status", ["pending", "approved"]),
      { key: "event_id", type: "string" },
      { key: "source", type: "string" },
    ],
  },
  {
    eventType: "event.registration.attended.v1",
    group: "events",
    identity: "person",
    payloadKeys: ["event_id", "registration_id", "person_id"],
    conditionFields: [{ key: "event_id", type: "string" }],
  },
  {
    // Wyjście ścieżek wydarzeń: ładunek nie niesie osoby - kontakt daje
    // agregat zgłoszenia (`journey_resolve_lead`).
    eventType: "event.registration.cancelled.v1",
    group: "events",
    identity: "person",
    payloadKeys: ["event_id", "by", "refund_effect"],
    conditionFields: [
      ENUM("by", ["participant", "event_cancelled"]),
      { key: "event_id", type: "string" },
    ],
  },
  {
    eventType: "club_application.submitted.v1",
    group: "community",
    identity: "user",
    payloadKeys: ["club_id", "application_id", "user_id", "specialization"],
    conditionFields: [
      { key: "club_id", type: "string" },
      { key: "specialization", type: "string" },
    ],
  },
  {
    eventType: "club_application.decided.v1",
    group: "community",
    identity: "user",
    payloadKeys: ["club_id", "application_id", "user_id", "specialization", "status"],
    // Emiter (20261020130500) wysyła wyłącznie decyzje końcowe.
    conditionFields: [
      ENUM("status", ["accepted", "rejected"]),
      { key: "club_id", type: "string" },
      { key: "specialization", type: "string" },
    ],
  },
  {
    eventType: "crm_lead.created.v1",
    group: "crm",
    identity: "lead",
    payloadKeys: ["stage", "owner_id"],
    conditionFields: [ENUM("stage", CRM_STAGES)],
  },
  {
    eventType: "crm_lead.stage_changed.v1",
    group: "crm",
    identity: "lead",
    payloadKeys: ["old_stage", "new_stage", "owner_id"],
    conditionFields: [ENUM("new_stage", CRM_STAGES), ENUM("old_stage", CRM_STAGES)],
  },
  {
    eventType: "crm_lead.lifecycle_changed.v1",
    group: "crm",
    identity: "lead",
    payloadKeys: ["lead_id", "from", "to", "source"],
    conditionFields: [ENUM("to", LIFECYCLE_STAGES), ENUM("from", LIFECYCLE_STAGES)],
  },
];

const BY_TYPE: ReadonlyMap<string, JourneyTriggerDef> = new Map(
  JOURNEY_TRIGGERS.map((def) => [def.eventType, def]),
);

export function journeyTrigger(eventType: string): JourneyTriggerDef | null {
  return BY_TYPE.get(eventType) ?? null;
}

export function isJourneyTrigger(eventType: string): eventType is DomainEventType {
  return BY_TYPE.has(eventType);
}

export class TriggerConditionError extends Error {
  readonly field: string;

  constructor(field: string, reason: string) {
    super(`trigger condition ${field}: ${reason}`);
    this.name = "TriggerConditionError";
    this.field = field;
  }
}

/**
 * Warunek `payload @> condition` z wartości formularza. Puste pola znikają
 * (brak warunku = każde zdarzenie typu); pole spoza katalogu wyzwalacza albo
 * wartość spoza opcji = błąd, nie cichy warunek, który nigdy nie zadziała.
 */
export function buildTriggerCondition(
  eventType: string,
  values: Readonly<Record<string, unknown>>,
): Record<string, string | boolean> {
  const def = journeyTrigger(eventType);
  if (!def) throw new TriggerConditionError("eventType", "nieznany wyzwalacz");
  const out: Record<string, string | boolean> = {};
  for (const [key, raw] of Object.entries(values)) {
    if (raw === undefined || raw === null || raw === "") continue;
    const field = def.conditionFields.find((f) => f.key === key);
    if (!field) throw new TriggerConditionError(key, "pole spoza katalogu wyzwalacza");
    if (field.type === "boolean") {
      if (typeof raw !== "boolean") throw new TriggerConditionError(key, "oczekiwano boolean");
      out[key] = raw;
      continue;
    }
    if (typeof raw !== "string" || raw.trim().length === 0 || raw.length > 200) {
      throw new TriggerConditionError(key, "oczekiwano napisu 1-200 znaków");
    }
    if (field.type === "enum" && !field.options?.includes(raw)) {
      throw new TriggerConditionError(key, "wartość spoza opcji");
    }
    out[key] = raw.trim();
  }
  return out;
}
