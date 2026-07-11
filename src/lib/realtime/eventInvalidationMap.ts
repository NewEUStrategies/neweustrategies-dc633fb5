// JEDNO miejsce mapujące zdarzenie domenowe -> klucze React Query do
// inwalidacji. Moduły nie zaszywają już tej wiedzy w swoich hookach
// realtime - konsument (useModuleRealtime / useDomainEventInvalidation)
// czyta regułę stąd. Test jednostkowy pilnuje, żeby każdy typ zdarzenia
// z katalogu miał regułę.
import type { QueryKey } from "@tanstack/react-query";
import { chatKeys } from "@/lib/chat/keys";
import { pendingCounterKeys } from "@/lib/counters/keys";
import { linkedItemsKeys } from "@/lib/links/keys";
import { eventPayloadText, type DomainEventRow, type DomainEventType } from "./domainEvents";

export interface InvalidationContext {
  /** Zalogowany użytkownik - klucze per-user (czat, notyfikacje, liczniki). */
  userId: string | undefined;
}

export type InvalidationRule = (event: DomainEventRow, ctx: InvalidationContext) => QueryKey[];

const contentKeys = (): QueryKey[] => [["public"], ["admin-posts"], ["post-by-slug"]];

export const eventInvalidationMap: Record<DomainEventType, InvalidationRule> = {
  "post.created.v1": () => [["admin-posts"]],
  "post.published.v1": () => contentKeys(),
  "post.status_changed.v1": () => contentKeys(),
  "post.deleted.v1": () => contentKeys(),

  "comment.created.v1": (event) => [
    ["comments", eventPayloadText(event, "post_id")],
    pendingCounterKeys.tenant(),
  ],
  "comment.status_changed.v1": (event) => [
    ["comments", eventPayloadText(event, "post_id")],
    pendingCounterKeys.tenant(),
  ],

  "message.sent.v1": (_event, ctx) => [
    chatKeys.conversations(ctx.userId),
    pendingCounterKeys.user(ctx.userId),
  ],

  "crm_lead.created.v1": (event) => [
    ["crm-leads"],
    ["crm-lead", event.aggregate_id],
    pendingCounterKeys.tenant(),
  ],
  "crm_lead.stage_changed.v1": (event) => [
    ["crm-leads"],
    ["crm-lead", event.aggregate_id],
    pendingCounterKeys.tenant(),
  ],
  "crm_lead.updated.v1": (event) => [["crm-leads"], ["crm-lead", event.aggregate_id]],
  "crm_note.created.v1": (event) => [
    ["crm-lead", eventPayloadText(event, "lead_id")],
    linkedItemsKeys.all,
  ],

  "newsletter_subscriber.subscribed.v1": () => [["newsletter-subscribers"], ["newsletter-kpis"]],
  "newsletter_subscriber.confirmed.v1": () => [
    ["newsletter-subscribers"],
    ["newsletter-kpis"],
    // Przepis workflow "confirmed -> lead CRM" zmienia też listę leadów.
    ["crm-leads"],
  ],
  "newsletter_subscriber.unsubscribed.v1": () => [["newsletter-subscribers"], ["newsletter-kpis"]],

  "mention.created.v1": (_event, ctx) => [
    ["notifications"],
    pendingCounterKeys.user(ctx.userId),
    linkedItemsKeys.all,
  ],
};

/**
 * Klucze do inwalidacji dla zdarzenia; nieznany typ (nowszy backend, starszy
 * bundle) nie wywraca konsumenta - zwracamy pustą listę.
 */
export function invalidationKeysFor(event: DomainEventRow, ctx: InvalidationContext): QueryKey[] {
  const rule = (eventInvalidationMap as Partial<Record<string, InvalidationRule>>)[
    event.event_type
  ];
  return rule ? rule(event, ctx) : [];
}
