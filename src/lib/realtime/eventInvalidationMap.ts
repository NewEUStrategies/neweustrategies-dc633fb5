// JEDNO miejsce mapujące zdarzenie domenowe -> klucze React Query do
// inwalidacji. Moduły nie zaszywają już tej wiedzy w swoich hookach
// realtime - konsument (useModuleRealtime / useDomainEventInvalidation)
// czyta regułę stąd. Test jednostkowy pilnuje, żeby każdy typ zdarzenia
// z katalogu miał regułę.
import type { QueryKey } from "@tanstack/react-query";
import { billingKeys } from "@/lib/billing/keys";
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
  // Follow-upy CRM: lista zadań leada + panel "do zrobienia" + skrzynka
  // (follow_up_at na leadzie utrzymuje trigger, więc odświeżamy też leady).
  "crm_task.created.v1": (event) => [
    ["crm-tasks"],
    ["crm-lead", eventPayloadText(event, "lead_id")],
    ["crm-leads"],
  ],
  "crm_task.completed.v1": (event) => [
    ["crm-tasks"],
    ["crm-lead", eventPayloadText(event, "lead_id")],
    ["crm-leads"],
  ],
  "crm_task.due.v1": (event, ctx) => [
    ["crm-tasks"],
    ["crm-lead", eventPayloadText(event, "lead_id")],
    ["notifications"],
    pendingCounterKeys.user(ctx.userId),
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

  // Events module: publish/cancel odświeża publiczne listy + panel admina.
  "event.published.v1": () => eventKeys(),
  "event.cancelled.v1": () => eventKeys(),

  // EU policy tracker: aktualizacja dossier odświeża listy i oś czasu trackera.
  "policy.updated.v1": () => [
    ["tracker", "items"],
    ["tracker", "item"],
    ["tracker", "updates"],
  ],

  // Monetyzacja - katalog cennika: edycja w panelu odświeża publiczny
  // /pricing i panele we WSZYSTKICH kartach staffu (nie tylko tej, która
  // zapisała). Zmiana warstwy dotyka też rozstrzygniętej warstwy użytkowników
  // (rank/features/nazwa) i podsumowań członkostwa przy leadach CRM.
  "membership_tier.changed.v1": () => [
    billingKeys.membershipTiers(),
    billingKeys.admin.membershipTiers(),
    billingKeys.currentTierAll(),
    billingKeys.crmLeadMembershipAll(),
  ],
  "access_plan.changed.v1": () => [
    billingKeys.plansActive(),
    billingKeys.admin.plans(),
    billingKeys.admin.monetization(),
    billingKeys.mySubscriptionAll(),
  ],
  "pricing_audience.changed.v1": () => [
    billingKeys.pricingAudiences(),
    billingKeys.admin.pricingAudiences(),
  ],
  "pricing_faq.changed.v1": () => [billingKeys.pricingFaq(), billingKeys.admin.pricingFaq()],

  // Monetyzacja - cykl życia uprawnień. Aktorem jest właściciel, więc jego
  // otwarta karta odblokowuje treści w czasie rzeczywistym po webhooku
  // Stripe; staff widzi te same zdarzenia w listach użytkowników, pulpicie
  // monetyzacji i podsumowaniu członkostwa leada CRM.
  "subscription.started.v1": () => subscriptionKeys(),
  "subscription.status_changed.v1": () => subscriptionKeys(),
  "subscription.updated.v1": () => subscriptionKeys(),

  "membership_grant.granted.v1": () => membershipGrantKeys(),
  "membership_grant.revoked.v1": () => membershipGrantKeys(),

  "organization.updated.v1": () => [
    billingKeys.myOrganizationAll(),
    billingKeys.currentTierAll(),
    billingKeys.admin.memberOrgs(),
    billingKeys.admin.memberOrgAll(),
    billingKeys.admin.crmCompanyMemberOrgsAll(),
    billingKeys.crmLeadMembershipAll(),
  ],
  "org_seat.changed.v1": () => [
    billingKeys.orgSeatsAll(),
    billingKeys.myOrganizationAll(),
    billingKeys.currentTierAll(),
    billingKeys.admin.memberOrgAll(),
    billingKeys.admin.orgSeatsAll(),
    billingKeys.crmLeadMembershipAll(),
  ],

  "donation.recorded.v1": () => donationKeys(),
  "donation.refunded.v1": () => donationKeys(),

  // Rejestr dokumentów rozliczeniowych: webhook wystawia dokument (aktor =
  // właściciel), profil odświeża listę i historię zamówień bez F5.
  "billing_document.issued.v1": () => billingDocumentKeys(),
  "billing_document.updated.v1": () => billingDocumentKeys(),
};

function billingDocumentKeys(): QueryKey[] {
  return [billingKeys.myBillingDocumentsAll(), billingKeys.myOrdersAll()];
}

// Subskrypcja zmienia: warstwę i paywall właściciela, jego profilowe widoki
// (subskrypcja/zamówienia), listę subskrypcji w /admin/users, pulpit
// monetyzacji i podsumowanie członkostwa przy leadzie CRM.
function subscriptionKeys(): QueryKey[] {
  return [
    billingKeys.mySubscriptionAll(),
    billingKeys.currentTierAll(),
    billingKeys.myOrdersAll(),
    ["public", "resolved"],
    ["unlocked-body"],
    billingKeys.admin.allUserSubscriptions(),
    billingKeys.admin.monetization(),
    billingKeys.crmLeadMembershipAll(),
  ];
}

function membershipGrantKeys(): QueryKey[] {
  return [
    billingKeys.myGrantsAll(),
    billingKeys.currentTierAll(),
    billingKeys.admin.membershipGrants(),
    billingKeys.crmLeadMembershipAll(),
  ];
}

// Darowizna nadaje status wspierającego przez osobne zdarzenie
// membership_grant.* - tu tylko rejestry darowizn (profil + panel).
function donationKeys(): QueryKey[] {
  return [billingKeys.myDonationsAll(), billingKeys.admin.donations()];
}

const eventKeysList: QueryKey[] = [
  ["public-events"],
  ["public-event"],
  ["event-rsvp-counts"],
  ["admin-community-events"],
  ["admin-community-stats"],
];
function eventKeys(): QueryKey[] {
  return eventKeysList;
}

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
