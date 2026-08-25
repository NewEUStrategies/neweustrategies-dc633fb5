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
import { clubKeys } from "@/lib/clubs/queryKeys";
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

  // Odznaka wpływa równocześnie na profil, katalog osób i ekspertów,
  // reputację oraz listę administracyjną. Nadanie tworzy też powiadomienie.
  "profile_badge.granted.v1": (_event, ctx) => profileBadgeKeys(ctx),
  "profile_badge.revoked.v1": (_event, ctx) => profileBadgeKeys(ctx),

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
  // Kluby dyskusyjne. Zdarzenie moze przyjsc BEZ aktora (wpis anonimowy) -
  // to nie zmienia niczego dla inwalidacji, bo klucze cache sa per klub
  // i per watek, a nie per autor.
  "club_thread.created.v1": (event) => clubEventKeys(event),
  "club_thread.status_changed.v1": (event) => clubEventKeys(event),
  "club_reply.created.v1": (event) => [
    ...clubEventKeys(event),
    clubKeys.repliesAll(eventPayloadText(event, "thread_id")),
  ],
  "club_reply.status_changed.v1": (event) => [
    ...clubEventKeys(event),
    clubKeys.repliesAll(eventPayloadText(event, "thread_id")),
  ],
  // Zmiana czlonkostwa rusza takze WLASNE czlonkostwa odbiorcy: lista "Moje
  // kluby" w naglowku produktu przestaje byc prawdziwa w tej samej chwili.
  "club_member.changed.v1": (event) => [...clubEventKeys(event), clubKeys.memberships()],
  // Przestrzen robocza watku: nowe zrodlo albo termin zmienia LICZNIK na belce
  // zakladek i zawartosc panelu, wiec uniewazniamy caly prefiks przestrzeni -
  // jeden klucz zamiast dwoch, bo licznik i lista i tak zmieniaja sie razem.
  "club_thread.document_added.v1": (event) => clubWorkspaceEventKeys(event),
  "club_thread.milestone_set.v1": (event) => clubWorkspaceEventKeys(event),

  // Event Builder. Kazde z tych zdarzen niesie `event_id`, wiec inwalidacja
  // schodzi do GALEZI JEDNEGO wydarzenia - organizator patrzacy na inne
  // wydarzenie nie traci swojego cache przy cudzym skanie.
  "event_meeting.invited.v1": (event) => meetingEventKeys(event),
  "event_meeting.accepted.v1": (event) => meetingEventKeys(event),
  "event_meeting.declined.v1": (event) => meetingEventKeys(event),
  "event_meeting.cancelled.v1": (event) => meetingEventKeys(event),
  "event_meeting.rescheduled.v1": (event) => meetingEventKeys(event),
  "event_meeting.arranged.v1": (event) => meetingEventKeys(event),
  "event_scanner_device.issued.v1": (event) => onsiteEventKeys(event),
  "event_scanner_device.locked.v1": (event) => onsiteEventKeys(event),
  "event_scanner_device.revoked.v1": (event) => onsiteEventKeys(event),
  "event_sponsor.published.v1": (event) => sponsorEventKeys(event),
  "event_sponsor.snapshot_refreshed.v1": (event) => sponsorEventKeys(event),
};

// KLUCZE JAKO LITERALY, NIE IMPORT FABRYK. Fabryki (`meetingKeys`,
// `onsiteKeys`, `sponsorKeys`) mieszkaja w plikach hookow, wiec import
// wciagnalby tu React Query i cala warstwe zapytan modulu - do pliku, ktory
// czyta konsument szyny zdarzen. To ten sam powod, dla ktorego literalami stoi
// `eventKeysList` nizej. Zgodnosci literalow z fabrykami pilnuje
// `__tests__/eventRealtimeKeys.test.ts`, wiec rozjazd nie przejdzie po cichu.

/**
 * Gielda spotkan ma DWIE plaszczyzny. Panel organizatora klucza po `event_id`,
 * wiec schodzimy do jego galezi. Uczestnik klucza po SLUG-u wydarzenia, ktorego
 * payload nie niesie - tam uniewazniamy cala galez, bo zawezenie wymagaloby
 * wlozenia sluga do payloadu, czyli tresci tam, gdzie maja byc identyfikatory.
 */
function meetingEventKeys(event: DomainEventRow): QueryKey[] {
  const eventId = eventPayloadText(event, "event_id");
  return [
    eventId === "" ? ["event-meetings"] : ["event-meetings", eventId],
    ["event-meetings-mine"],
  ];
}

function onsiteEventKeys(event: DomainEventRow): QueryKey[] {
  const eventId = eventPayloadText(event, "event_id");
  return [eventId === "" ? ["event-onsite"] : ["event-onsite", eventId]];
}

/**
 * Karta sponsora jest widoczna TAKZE na stronie publicznej wydarzenia, wiec
 * publikacja uniewaznia obie strony - inaczej organizator widzi zmiane, a gosc
 * nadal stara liste.
 */
function sponsorEventKeys(event: DomainEventRow): QueryKey[] {
  const eventId = eventPayloadText(event, "event_id");
  return [eventId === "" ? ["event-sponsors"] : ["event-sponsors", eventId], ["public-event"]];
}

function billingDocumentKeys(): QueryKey[] {
  return [billingKeys.myBillingDocumentsAll(), billingKeys.myOrdersAll()];
}

function profileBadgeKeys(ctx: InvalidationContext): QueryKey[] {
  return [
    ["profile-badges"],
    ["admin-badges"],
    ["contributor-leaderboard"],
    ["my-reputation"],
    ["public", "expert"],
    ["public", "experts-directory"],
    ["notifications"],
    pendingCounterKeys.user(ctx.userId),
  ];
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
// membership_grant.* - tu tylko rejestr darowizn w profilu użytkownika.
// Panel /admin/donations został wycięty (zbiórka żyje na zrzutka.pl, wpis
// w nawigacji admina to link zewnętrzny), więc nie ma klucza admina.
function donationKeys(): QueryKey[] {
  return [billingKeys.myDonationsAll()];
}

/**
 * Kluby: payload niesie club_id i thread_id, ale NIE slug - a klucze cache sa
 * budowane na slugu tam, gdzie strona zna tylko adres. Dlatego unieważniamy
 * prefiks klubu (dotyka listy tematow, karty klubu i statystyk) plus punktowo
 * watek, gdy zdarzenie go wskazuje. To ta sama argumentacja co przy kluczach
 * sieci: w chwili odbioru zdarzenia nie znamy wszystkich wspolrzednych.
 */
function clubEventKeys(event: DomainEventRow): QueryKey[] {
  const clubId = eventPayloadText(event, "club_id");
  const keys: QueryKey[] = [clubKeys.all];
  if (clubId !== "") keys.push(clubKeys.club(clubId));
  return keys;
}

/**
 * Klucze przestrzeni roboczej watku. Identyfikator watku jest AGREGATEM
 * zdarzenia (`aggregate_id`), a nie polem payloadu - te dwa emitery opisuja
 * zmiane WEWNATRZ watku, wiec agregatem jest watek, a nie dolozony wiersz.
 * Pusty agregat (teoretycznie mozliwy przy uszkodzonym wierszu) nie moze
 * zbudowac klucza `workspace("")`, bo ten trafialby w cudze zapytania.
 */
function clubWorkspaceEventKeys(event: DomainEventRow): QueryKey[] {
  const keys = clubEventKeys(event);
  const threadId = typeof event.aggregate_id === "string" ? event.aggregate_id : "";
  if (threadId !== "") keys.push(clubKeys.workspace(threadId));
  return keys;
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
