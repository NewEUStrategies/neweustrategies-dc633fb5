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
  // Follow-upy CRM (migracja 20260721120000): created/completed z triggerów,
  // due ze skanera przypomnień run_crm_task_reminders.
  "crm_task.created.v1",
  "crm_task.completed.v1",
  "crm_task.due.v1",
  "newsletter_subscriber.subscribed.v1",
  "newsletter_subscriber.confirmed.v1",
  "newsletter_subscriber.unsubscribed.v1",
  "mention.created.v1",
  // Events module (migracja 20260713093000) + EU policy tracker (20260713096000).
  "event.published.v1",
  "event.cancelled.v1",
  "policy.updated.v1",
  // Odznaki profilowe: odbiorca jest aktorem zdarzenia, staff widzi całość
  // tenantu. Payload zawiera wyłącznie user_id, badge i grant_source.
  "profile_badge.granted.v1",
  "profile_badge.revoked.v1",
  // Monetyzacja (migracja 20260723120000): katalog cennika (warstwy/plany/
  // segmenty/FAQ - zdarzenie "changed" z op w payloadzie) oraz cykl życia
  // uprawnień (subskrypcje/nadania/organizacje/miejsca/darowizny). Aktorem
  // zdarzeń cyklu życia jest właściciel wiersza, więc kupujący dostaje
  // inwalidację cache w czasie rzeczywistym, gdy webhook Stripe nada dostęp.
  "membership_tier.changed.v1",
  "access_plan.changed.v1",
  "pricing_audience.changed.v1",
  "pricing_faq.changed.v1",
  "subscription.started.v1",
  "subscription.status_changed.v1",
  "subscription.updated.v1",
  "membership_grant.granted.v1",
  "membership_grant.revoked.v1",
  "organization.updated.v1",
  "org_seat.changed.v1",
  "donation.recorded.v1",
  "donation.refunded.v1",
  // Rejestr dokumentów rozliczeniowych (migracja 20260723151000): faktury z
  // checkoutu i odnowień oraz paragony; updated = zmiana statusu (refund).
  "billing_document.issued.v1",
  "billing_document.updated.v1",
  // Kluby dyskusyjne (migracja 20260808140000). Zdarzenia sa emitowane
  // z triggerow, a nie z RPC, bo watek powstaje dwiema sciezkami
  // (produktowa i administracyjna), a odpowiedz trzema. Payload niesie
  // WYLACZNIE identyfikatory: domain_events czyta caly staff tenantu, a
  // czlonkostwo w klubie to inna bramka niz rola redakcyjna. Wpis anonimowy
  // albo w trybie chatham emituje sie BEZ aktora, a klub 'secret' nie emituje
  // w ogole - inaczej szyna zdarzen bylaby obejsciem reguly Chatham House.
  "club_thread.created.v1",
  "club_thread.status_changed.v1",
  "club_reply.created.v1",
  "club_reply.status_changed.v1",
  "club_member.changed.v1",
  // Przestrzen robocza watku (migracja 20260808300000). Zrodlo i termin sa
  // TRESCIA PLATFORMY, nie prywatna notatka watku: strona aktu prawnego pyta
  // graf powiazan o "omawiane w klubie X, ze zrodlami", a nie modul klubow.
  // Payload niesie identyfikatory i rodzaj - bez tytulu i bez adresu, bo
  // domain_events czyta caly staff tenantu.
  "club_thread.document_added.v1",
  "club_thread.milestone_set.v1",
  // Event Builder: gielda spotkan 1-1 (20260823190000), obsluga na miejscu
  // (20260823180000) i sponsorzy (20260823160000). Payload kazdego z nich
  // niesie `event_id`, wiec regula inwalidacji trafia w GALAZ JEDNEGO
  // wydarzenia, a nie w caly modul.
  //
  // Spotkania emituja z RPC, nie z triggera, bo ta sama zmiana stanu ma dwie
  // sciezki (decyzja uczestnika i przestawienie przez organizatora), a payload
  // niesie WYLACZNIE identyfikatory - `domain_events` czyta caly staff tenantu,
  // a temat spotkania jest tresria prywatna dwoch stron.
  "event_meeting.invited.v1",
  "event_meeting.accepted.v1",
  "event_meeting.declined.v1",
  "event_meeting.cancelled.v1",
  "event_meeting.rescheduled.v1",
  "event_meeting.arranged.v1",
  // Urzadzenia skanujace: wydanie, zablokowanie i uniewaznienie. Payload
  // niesie `token_prefix`, nigdy calego tokenu - ten wraca wylacznie
  // z wywolania, ktore go tworzy.
  "event_scanner_device.issued.v1",
  "event_scanner_device.locked.v1",
  "event_scanner_device.revoked.v1",
  // Sponsorzy: publikacja karty i odswiezenie migawki z CRM firm.
  "event_sponsor.published.v1",
  "event_sponsor.snapshot_refreshed.v1",
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
  "crm_task",
  "newsletter_subscriber",
  "event",
  "policy",
  "profile_badge",
  "membership_tier",
  "access_plan",
  "pricing_audience",
  "pricing_faq",
  "subscription",
  "membership_grant",
  "organization",
  "org_seat",
  "donation",
  "billing_document",
  "club_thread",
  "club_reply",
  "club_member",
  "event_meeting",
  "event_scanner_device",
  "event_sponsor",
] as const;

export type DomainAggregateType = (typeof DOMAIN_AGGREGATE_TYPES)[number];
