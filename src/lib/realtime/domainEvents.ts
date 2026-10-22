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
  // Komentarz pod wpisem sciany (migracja 20261007100100) - emitowany
  // z triggera, payload: club_id, post_id, status; w chatham bez aktora.
  "club_post_comment.created.v1",
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
  // Lista offline skanera (20260926150000): pobranie pelnej listy (audyt,
  // aktor NULL - plaszczyzna urzadzenia) i zmiana zgody administratora.
  "event_scanner_device.roster_downloaded.v1",
  "event_scanner_device.offline_changed.v1",
  // Zgloszenia na wydarzenie (migracje 20260823150000 i pozniejsze). NAZWA
  // JEST TRZYCZLONOWA (`event.registration.<czasownik>.v1`) - agregatem jest
  // zgloszenie, a payload niesie `event_id`, wiec inwalidacja schodzi do
  // galezi jednego wydarzenia.
  "event.registration.created.v1",
  "event.registration.updated.v1",
  "event.registration.decided.v1",
  "event.registration.cancelled.v1",
  "event.registration.promoted.v1",
  "event.registration.payment.v1",
  // Jawne uniewaznienie zgubionego biletu albo identyfikatora (20261013110900,
  // OPS-04). Payload: event_id, registration_id, credential (ticket|badge) -
  // bez kodu; nowa wartosc jawna wraca wylacznie z wywolania.
  "event.registration.code_invalidated.v1",
  // Sponsorzy: publikacja karty i odswiezenie migawki z CRM firm.
  "event_sponsor.published.v1",
  "event_sponsor.snapshot_refreshed.v1",
  // Nabor prelegentow (20260927000100_event_cfp.sql, f1). Wyslanie, decyzja
  // organizatora (takze przyjecie), wycofanie i odpowiedz prelegenta na
  // przyjecie (`confirmed.v1` niesie `status`: confirmed albo declined) oraz
  // zapis oceny recenzenta. Payload WYLACZNIE z identyfikatorami i `event_id`
  // - tytul i ocena to tresc, a `domain_events` czyta caly staff tenantu.
  "event_cfp_submission.submitted.v1",
  "event_cfp_submission.decided.v1",
  "event_cfp_submission.withdrawn.v1",
  "event_cfp_submission.confirmed.v1",
  "event_cfp_review.saved.v1",
  // Faktury organizatora (migracja 20260927000200): wystawienie i anulowanie
  // dokumentu. Payload niesie wylacznie identyfikatory (`event_id`,
  // `invoice_id`, `kind`) - bez danych nabywcy.
  "event_invoice.issued.v1",
  "event_invoice.cancelled.v1",
  // Plan sali (20260927000400): przydzial, zwolnienie (takze triggerem po
  // zmianie statusu zgloszenia) i zmiana ukladu/rezerwacji/publikacji planu.
  // Payload niesie `event_id`, `map_id` i liczby - bez nazwisk i firm.
  "event_seat.assigned.v1",
  "event_seat.released.v1",
  "event_seat_map.changed.v1",
  // Raport dla sponsora: wydanie i odwolanie linku bez logowania
  // (migracja 20260927000500). Payload: event_id, sponsor_id, link_id.
  "event_sponsor_report_link.issued.v1",
  "event_sponsor_report_link.revoked.v1",
  // Funkcje uczestnika F1-F5 (spec B.9): zapis ustawien organizatora
  // (`admin_event_participant_settings_save`, 20260926153100). Agregatem jest
  // `event_participant_settings`, identyfikatorem - id wydarzenia; payload
  // `{event_id, keys}` niesie wylacznie identyfikator i nazwy zmienionych pol.
  "event.participant_settings.updated.v1",
  // Tor B (F4 oferty z listy rezerwowej, F3 przekazanie i zwrot samoobslugowy).
  // Agregatem jest ZGLOSZENIE (`event_registration`), payload niesie
  // `event_id` i identyfikatory oferty/przekazania/prosby o zwrot - nigdy
  // adresu e-mail, imienia ani tokenu przekazania.
  "event.registration.offered.v1",
  "event.registration.offer_closed.v1",
  "event.registration.transfer_requested.v1",
  "event.registration.transfer_cancelled.v1",
  "event.registration.transferred.v1",
  "event.registration.refund_requested.v1",
  "event.registration.refund_failed.v1",
  // Tor C (F5): certyfikat (agregat `event_certificate`, id certyfikatu)
  // i ankieta (agregat `event_survey`, id = ID WYDARZENIA - zawsze, takze
  // przy odpowiedzi imiennej, zeby strumien nie zdradzal, kto odpowiedzial;
  // aktor NULL przy ankiecie anonimowej).
  "event.certificate.issued.v1",
  "event.certificate.revoked.v1",
  "event.survey.submitted.v1",
  "event.survey.questions_changed.v1",
  // Klon edycji (migracja 20260927000800): nowe wydarzenie z konfiguracji
  // poprzedniej edycji. Payload: event_id (kopia) i source_event_id (zrodlo).
  "event.cloned.v1",

  // ── HUB „PRZYCHÓD I LEJEK" (SPEC §4.5) - 34 typy zamrożone w I0 ──────────
  //
  // KATALOG WYPRZEDZA EMITERY. Triggery i RPC, które te zdarzenia emitują,
  // wchodzą w wycinkach S1-S7, a wycinki pracują równolegle. Gdyby każdy
  // dopisywał tu swoje typy sam, lista byłaby plikiem współdzielonym siedmiu
  // gałęzi naraz - dlatego I0 deklaruje wszystkie z góry, a
  // `hubEventCatalog.test.ts` pilnuje, że żaden literał nie zniknie ani nie
  // zmieni nazwy przed scaleniem emitera. Bramka `domainEventCatalog.test.ts`
  // patrzy w drugą stronę (emiter w migracji → wpis tutaj).
  //
  // Payload każdego z nich niesie WYŁĄCZNIE identyfikatory i enumy (kwoty
  // tylko w zdarzeniach rozliczeniowych, w jednostkach minor): `domain_events`
  // czyta cały staff najemcy, a e-mail czy notatka nie są jego sprawą.

  // Konto i lejek czytelnika (S3): AFTER INSERT ON profiles,
  // `record_paywall_hit` (pierwsze uderzenie użytkownika w dobie UTC) i
  // `_metered_view_consume` (wyczerpanie limitu - raz na użytkownika w miesiącu).
  "account.registered.v1",
  "paywall.hit.v1",
  "metering.quota_exhausted.v1",
  // Kasa (S3): AFTER INSERT / UPDATE OF status ON payment_orders, tylko `live`
  // i nigdy `mock` - inaczej zamówienia testowe pompowałyby lejek.
  // `abandoned` = anulowanie z `cancel_reason = 'session_expired'`.
  "checkout.started.v1",
  "checkout.completed.v1",
  "checkout.failed.v1",
  "checkout.abandoned.v1",
  // Subskrypcja u operatora (S2): `tg_subscriptions_revenue_history` (status,
  // pauza, `cancel_at_period_end`, licznik nieudanych płatności) i skaner
  // `run_revenue_lifecycle_scanner()` (koniec triala za 3 dni). Agregat
  // `billing_subscription`, a nie `subscription`, bo tamten nazywa UPRAWNIENIE
  // (`user_subscriptions`), a ten - pieniądze (`subscriptions`).
  "billing_subscription.status_changed.v1",
  "billing_subscription.payment_failed.v1",
  "billing_subscription.payment_recovered.v1",
  "billing_subscription.trial_ending.v1",
  // Uprawnienie subskrypcyjne (S2): odnowienie z AFTER INSERT ON
  // billing_documents (opłacona faktura bez zamówienia), wygaśnięcie ze
  // skanera. `expired` niesie `reason` - pauza nie jest odejściem (D13).
  "subscription.renewed.v1",
  "subscription.expired.v1",
  // Przepływ anulowania (S2): INSERT / UPDATE OF outcome ON retention_feedback.
  "retention_flow.started.v1",
  "retention_flow.completed.v1",
  // Dane wejściowe planu i kosztów (S2): `admin_revenue_input_upsert`.
  "revenue_input.changed.v1",
  // Ustawienia modułów źródłowych (S1): AFTER INSERT/UPDATE z `IS DISTINCT
  // FROM`, payload `keys` = nazwy zmienionych kolumn. Bez nich hub w drugiej
  // karcie pokazywałby diagnozę sprzed naprawy wykonanej w pierwszej.
  "metering_settings.changed.v1",
  "checkout_settings.changed.v1",
  // Także oznaczenie „mój tekst obejmuje pomiar" (I9d-Y2,
  // `admin_newsletter_consent_measurement_mark`): `keys` =
  // ['consent_measurement_marks'] - ta sama reguła odświeża stan treści zgody
  // i podgląd prośby o zgodę na pomiar (klucze pod `newsletterKeys.settings()`).
  "newsletter_settings.changed.v1",
  "retention_settings.changed.v1",
  "retention_reason.changed.v1",
  // Reguła dostępu treści (S1): payload `entity_type`, `entity_id`, `mode`,
  // `metering_policy`, `op` - inwalidacja schodzi do jednej encji.
  "content_access.changed.v1",
  // Kupony B2B (S1, kontrakt nazw N2): kupon, kampania, realizacja.
  "coupon.changed.v1",
  "coupon_campaign.changed.v1",
  "coupon.redeemed.v1",
  // Newsletter (S1): `tg_newsletter_subscribers_emit_events` przy przejściu
  // `unsubscribed → subscribed|confirmed` - powrót to inny fakt niż zapis.
  "newsletter_subscriber.resubscribed.v1",
  // CRM, automatyzacje, społeczność (S4): `tg_crm_leads_stage_history`
  // (zmiana `lifecycle_stage`), AFTER INSERT/UPDATE/DELETE ON
  // workflow_definitions, zgłoszenia do klubów (bez klubów `secret`, jak
  // pozostałe zdarzenia klubowe) i obecność na wydarzeniu (`attended_at`
  // NULL → wartość; agregatem jest zgłoszenie, payload niesie `event_id`).
  "crm_lead.lifecycle_changed.v1",
  "workflow_definition.changed.v1",
  "club_application.submitted.v1",
  "club_application.decided.v1",
  "event.registration.attended.v1",
  // Ścieżki komunikacji (S5, kontrakt N3): RPC `admin_journey_*` oraz
  // `journey_tick_emit_stats` - RAZ na ścieżkę na tick, nie na kontakt
  // (wolumen realtime). Silnik ignoruje własne agregaty (zakaz pętli).
  "journey.changed.v1",
  "journey.stats_changed.v1",
  // Wyciszenie diagnozy (S7): `admin_revenue_diagnostic_snooze/unsnooze`.
  "revenue_diagnostic.snoozed.v1",
  // Retencja danych (I9c-X2): zapis kategorii, karencja, przedłużenie kontaktu
  // CRM i ręczny przebieg (`admin_data_retention_*`). Ładunek: `op`
  // i opcjonalnie `category` - bez danych osobowych. I9d-Y1: `op` obejmuje
  // też 'exclusion' (wykluczenie adresu z wygaszania newslettera i jego
  // cofnięcie, SQL 20261020162100); inwalidacja idzie po prefiksie najemcy.
  "data_retention.changed.v1",
  // Formularz kontaktowy (I9, Z-S5-01): AFTER INSERT ON contact_messages
  // (`tg_contact_messages_submitted_emit`, SQL 20261020162800) - po
  // wyzwalaczu CRM, więc ładunek niesie `lead_id`. Ładunek bez danych
  // osobowych: `message_id`, `lead_id`, `form_kind` (biała lista
  // `CONTACT_MESSAGE_FORM_KINDS`), `form_id`. Kandydaci do pracy poza szyną.
  "contact_message.submitted.v1",
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

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
  "event_registration",
  "event_cfp_submission",
  "event_cfp_review",
  "event_invoice",
  "event_seat",
  "event_seat_map",
  "event_sponsor_report_link",
  "event_participant_settings",
  "event_certificate",
  "event_survey",
  // Hub „Przychód i lejek" (SPEC §4.5): agregaty typów zamrożonych w I0.
  // Typy na istniejących agregatach (`subscription.renewed`,
  // `crm_lead.lifecycle_changed`, `newsletter_subscriber.resubscribed`,
  // `event.registration.attended` → `event_registration`) nowych nie wnoszą.
  "account",
  "paywall",
  "metering",
  "checkout",
  "billing_subscription",
  "retention_flow",
  "club_application",
  "journey",
  "revenue_input",
  "revenue_diagnostic",
  "metering_settings",
  "checkout_settings",
  "content_access",
  "newsletter_settings",
  "retention_settings",
  "retention_reason",
  "coupon",
  "coupon_campaign",
  "workflow_definition",
  // Retencja danych (I9c-X2): agregatem jest najemca.
  "data_retention",
  // Formularz kontaktowy (I9, Z-S5-01): agregatem jest wiadomość.
  "contact_message",
] as const;

export type DomainAggregateType = (typeof DOMAIN_AGGREGATE_TYPES)[number];
