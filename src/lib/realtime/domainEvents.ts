// Typy szyny zdarzeń domenowych (public.domain_events). Katalog typów zdarzeń
// jest zamknięty i wersjonowany (`<agregat>.<czasownik>.v<n>`); emitery żyją
// w triggerach DB (migracja 20260711200000), więc frontend traktuje tę listę
// jako kontrakt - mapa inwalidacji (eventInvalidationMap) pokrywa każdy wpis,
// czego pilnuje test jednostkowy.
import type { Database } from "@/integrations/supabase/types";

export type DomainEventRow = Database["public"]["Tables"]["domain_events"]["Row"];

export const DOMAIN_EVENT_TYPES = [
  "post.created.v1",
  "post.published.v1",
  "post.status_changed.v1",
  "post.deleted.v1",
  "comment.created.v1",
  "comment.status_changed.v1",
  "message.sent.v1",
  "crm_lead.created.v1",
  "crm_lead.stage_changed.v1",
  "crm_lead.updated.v1",
  "crm_note.created.v1",
  "newsletter_subscriber.subscribed.v1",
  "newsletter_subscriber.confirmed.v1",
  "newsletter_subscriber.unsubscribed.v1",
  "mention.created.v1",
  // Events module (migracja 20260713093000) + EU policy tracker (20260713096000).
  "event.published.v1",
  "event.cancelled.v1",
  "policy.updated.v1",
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export function isKnownDomainEventType(value: string): value is DomainEventType {
  return (DOMAIN_EVENT_TYPES as readonly string[]).includes(value);
}

/** Payload zdarzenia jako obiekt (kolumna jsonb jest typowana jako Json). */
export function eventPayload(event: DomainEventRow): Record<string, unknown> {
  const p = event.payload;
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

/** Tekstowa wartość z payloadu zdarzenia ("" gdy brak / nie-string). */
export function eventPayloadText(event: DomainEventRow, key: string): string {
  const value = eventPayload(event)[key];
  return typeof value === "string" ? value : "";
}

/** Typy agregatów emitowane przez triggery - do filtrów strumieni per moduł. */
export const DOMAIN_AGGREGATE_TYPES = [
  "post",
  "comment",
  "message",
  "crm_lead",
  "crm_note",
  "newsletter_subscriber",
  "event",
  "policy",
] as const;

export type DomainAggregateType = (typeof DOMAIN_AGGREGATE_TYPES)[number];
