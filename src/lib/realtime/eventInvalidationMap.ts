// JEDNO miejsce mapujące zdarzenie domenowe -> klucze React Query do
// inwalidacji. Moduły nie zaszywają już tej wiedzy w swoich hookach
// realtime - konsument (useModuleRealtime / useDomainEventInvalidation)
// czyta regułę stąd. Test jednostkowy pilnuje, żeby każdy typ zdarzenia
// z katalogu miał regułę.
//
// RDZEŃ I ROZSZERZENIA. Ta mapa jedzie w chunku szyny, który ładuje każdy
// zalogowany (także czytelnik na stronie publicznej), więc trzyma wyłącznie
// klucze modułów. Klucze panelu huba przychodu (`["admin-revenue", …]`,
// `["admin", "journeys", …]`) dokłada rozszerzenie rejestrowane przez układ
// `/admin` (`eventInvalidationMap.admin.ts`) - nie trafiają do bundla `public`,
// a `invalidationKeysFor` zwraca sumę obu.
//
// FABRYKI ZAMIAST LITERAŁÓW tam, gdzie fabryka jest liściem bez importów
// runtime (`crmKeys`, `newsletterKeys`, `accessKeys`…): klucz ekranu i klucz
// reguły to wtedy jedno wywołanie, a nie dwa napisy, które rozjeżdżają się
// po cichu (bramka `queryKeyLiterals.gate.test.ts`).
import type { QueryKey } from "@tanstack/react-query";
import { accessKeys, checkoutKeys, meteringKeys } from "@/lib/access/keys";
import { couponKeys } from "@/lib/admin/couponKeys";
import { workflowKeys } from "@/lib/admin/workflowKeys";
import { analyticsCouponsPrefixKey } from "@/lib/analytics/queryKeys";
import { billingKeys } from "@/lib/billing/keys";
import { chatKeys } from "@/lib/chat/keys";
import { pendingCounterKeys } from "@/lib/counters/keys";
import { crmKeys } from "@/lib/crm/keys";
import { linkedItemsKeys } from "@/lib/links/keys";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { newsletterKeys } from "@/lib/newsletter/keys";
import { retentionKeys } from "@/lib/retention/keys";
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

  // Lead CRM. Każda zmiana leada przesuwa też lejek CRM (D8): liczności
  // etapów (`funnelAll`) i kafle konwersji (`funnelStats`) liczą się z tych
  // samych wierszy, więc bez tych kluczy lejek w drugiej karcie stał do
  // końca `staleTime`. Zmiana etapu i cyklu życia dopisuje wiersz historii.
  "crm_lead.created.v1": (event) => [
    ...crmLeadKeys(event),
    ...crmFunnelKeys(),
    pendingCounterKeys.tenant(),
  ],
  "crm_lead.stage_changed.v1": (event) => [
    ...crmLeadKeys(event),
    crmKeys.leadStageHistory(event.aggregate_id),
    ...crmFunnelKeys(),
    pendingCounterKeys.tenant(),
  ],
  "crm_lead.updated.v1": (event) => [...crmLeadKeys(event), ...crmFunnelKeys()],
  // Oś marketingowa (`lifecycle_stage`) nie rusza etapu sprzedaży, więc nie
  // zmienia licznika nowych leadów - tylko listę, kartę, historię i lejek.
  "crm_lead.lifecycle_changed.v1": (event) => [
    ...crmLeadKeys(event),
    crmKeys.leadStageHistory(event.aggregate_id),
    ...crmFunnelKeys(),
  ],
  "crm_note.created.v1": (event) => [
    crmKeys.lead(eventPayloadText(event, "lead_id")),
    linkedItemsKeys.all,
  ],
  // Follow-upy CRM: lista zadań leada + panel "do zrobienia" + skrzynka
  // (follow_up_at na leadzie utrzymuje trigger, więc odświeżamy też leady).
  // Kafel „zaległe zadania" w statystykach lejka (D8) liczy te same wiersze.
  "crm_task.created.v1": (event) => [
    crmKeys.tasksAll(),
    crmKeys.lead(eventPayloadText(event, "lead_id")),
    crmKeys.leadsAll(),
    crmKeys.funnelStats(),
  ],
  "crm_task.completed.v1": (event) => [
    crmKeys.tasksAll(),
    crmKeys.lead(eventPayloadText(event, "lead_id")),
    crmKeys.leadsAll(),
    crmKeys.funnelStats(),
  ],
  "crm_task.due.v1": (event, ctx) => [
    crmKeys.tasksAll(),
    crmKeys.lead(eventPayloadText(event, "lead_id")),
    ["notifications"],
    pendingCounterKeys.user(ctx.userId),
    crmKeys.funnelStats(),
  ],

  // Subskrybent newslettera zasila lejek CRM (D8): przepis „confirmed → lead"
  // i sync `newsletter_status` zmieniają listę leadów, a każde przejście -
  // górę lejka. Powrót po wypisie (`resubscribed`) to ta sama powierzchnia.
  "newsletter_subscriber.subscribed.v1": () => newsletterSubscriberKeys(),
  "newsletter_subscriber.confirmed.v1": () => newsletterSubscriberKeys(),
  "newsletter_subscriber.unsubscribed.v1": () => newsletterSubscriberKeys(),
  "newsletter_subscriber.resubscribed.v1": () => newsletterSubscriberKeys(),

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
  //
  // Warstwę czytają też ekrany, które dotąd nie słuchały szyny (S1): katalog
  // warstw formularza kuponu, kolumny macierzy uprawnień, wybór warstwy przy
  // domenach weryfikacji, katalog członków (nazwa warstwy w wierszu) i kluby
  // (próg rangi dostępu). Dwa z tych kluczy nie mają fabryki-liścia, więc
  // stoją literałem przypiętym w `revenueInvalidation.test.ts`:
  //   * `["authz", "permission-matrix", "tiers"]` - prefiks
  //     `permissionMatrixKeys.tenantTiers` (plik hooków - import wciągnąłby
  //     React Query i klienta Supabase do chunku szyny);
  //   * `["admin-membership-tiers"]` - zapytanie `VerificationDomainsCard`.
  "membership_tier.changed.v1": () => [
    billingKeys.membershipTiers(),
    billingKeys.admin.membershipTiers(),
    billingKeys.currentTierAll(),
    billingKeys.crmLeadMembershipAll(),
    couponKeys.tiers(),
    ["authz", "permission-matrix", "tiers"],
    ["admin-membership-tiers"],
    billingKeys.admin.members(),
    clubKeys.all,
  ],
  // Plan czytają także: wspólna lista planów paywalla i huba (`plansAll`,
  // S1), katalog planów formularza kuponu i plany testowe diagnostyki płatności.
  "access_plan.changed.v1": () => [
    billingKeys.plansActive(),
    billingKeys.admin.plans(),
    billingKeys.admin.monetization(),
    billingKeys.mySubscriptionAll(),
    billingKeys.admin.plansAll(),
    couponKeys.plans(),
    billingKeys.admin.testPlans(),
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
  "subscription.renewed.v1": () => subscriptionKeys(),
  "subscription.expired.v1": () => subscriptionKeys(),

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
  // WLASNA odpowiedz (aktor = zalogowany) trafia tu ~250 ms po mutacji, ktora
  // juz odswiezyla to, czego potrzebuje: `useReplyFromFeed` celowo NIE
  // uniewaznia poddrzewa klubu (licznik poprawia w miejscu), bo odswiezona
  // lista „goracych" przestawialaby karty pod kursorem autora. Szyna dostarcza
  // zdarzenie wlasnie aktorowi, wiec bez tego wyjatku cofalaby te decyzje.
  // Zostaja odpowiedzi watku - tanie i aktualne takze w innych kartach autora.
  "club_reply.created.v1": (event, ctx) => {
    const repliesKey = clubKeys.repliesAll(eventPayloadText(event, "thread_id"));
    return isOwnEvent(event, ctx) ? [repliesKey] : [...clubEventKeys(event), repliesKey];
  },
  "club_reply.status_changed.v1": (event) => [
    ...clubEventKeys(event),
    clubKeys.repliesAll(eventPayloadText(event, "thread_id")),
  ],
  // Komentarz pod wpisem: WYLACZNIE komentarze tego wpisu. Nie sciana - jej
  // przeladowanie wypycha z pierwszej strony karte, pod ktora czytelnik pisze
  // (patrz `postCommentKeys`), a licznik w karcie poprawia mutacja w miejscu.
  // Uszkodzony payload degraduje do szerszego klucza (klub, potem caly modul),
  // ale nie przy wlasnym zdarzeniu - wtedy mutacja juz odswiezyla swoje.
  "club_post_comment.created.v1": (event, ctx) => {
    const clubId = eventPayloadText(event, "club_id");
    const postId = eventPayloadText(event, "post_id");
    if (clubId !== "" && postId !== "") return [clubKeys.postComments(clubId, postId)];
    if (isOwnEvent(event, ctx)) return [];
    return clubId === "" ? [clubKeys.all] : [clubKeys.club(clubId)];
  },
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
  "event_scanner_device.roster_downloaded.v1": (event) => onsiteEventKeys(event),
  "event_scanner_device.offline_changed.v1": (event) => onsiteEventKeys(event),
  "event_sponsor.published.v1": (event) => sponsorEventKeys(event),
  "event_sponsor.snapshot_refreshed.v1": (event) => sponsorEventKeys(event),
  "event_sponsor_report_link.issued.v1": (event) => sponsorReportLinkKeys(event),
  "event_sponsor_report_link.revoked.v1": (event) => sponsorReportLinkKeys(event),

  // Zgloszenia na wydarzenie. Kazde z tych zdarzen zmienia TRZY powierzchnie
  // naraz: liste i liczniki w panelu organizatora, "moje zgloszenia" w profilu
  // uczestnika oraz skrot w menu konta. Brak reguly oznaczal ciche milczenie
  // - ekran wygladal poprawnie, tylko nie odswiezal sie po decyzji, zapisie
  // ani awansie z listy rezerwowej.
  // Kazde z nich zmienia TAKZE ekran faktur: nowy albo zmieniony zapis (rodzaj
  // biletu) to inny kandydat do zafakturowania, decyzja i awans z kolejki -
  // plakietka wplaty bez miejsca, odwolanie i wplata (zaplata albo zwrot
  // z karty) - kwota i podpowiedz korekty wystawionej faktury, a w profilu
  // kupujacego to, o co moze poprosic.
  "event.registration.created.v1": (event) => registrationInvoiceEventKeys(event),
  "event.registration.updated.v1": (event) => registrationInvoiceEventKeys(event),
  "event.registration.decided.v1": (event) => registrationInvoiceEventKeys(event),
  "event.registration.cancelled.v1": (event) => registrationInvoiceEventKeys(event),
  "event.registration.promoted.v1": (event) => registrationInvoiceEventKeys(event),
  // Wpłata za bilet to TAKŻE przychód (D5): pulpit monetyzacji, lista zamówień
  // biletowych w /admin/billing (`AdminTicketOrdersPanel` - zapytania w pliku
  // komponentu, stąd literał przypięty testem) i lejek reklam wydarzenia,
  // który liczy przychód netto z tych samych zamówień.
  "event.registration.payment.v1": (event) => [
    ...registrationInvoiceEventKeys(event),
    billingKeys.admin.monetization(),
    ["admin", "ticket-orders"],
    eventScopedKey("event-ads-funnel", event),
  ],
  // Obecność zmienia listę zgłoszeń (plakietka „był") i moduł na miejscu
  // (licznik wejść) - faktury i pieniądze zostają bez zmian.
  "event.registration.attended.v1": (event) => [
    ...registrationEventKeys(event),
    ...onsiteEventKeys(event),
  ],
  // Uniewaznienie kodu zmienia stan identyfikatora w module na miejscu.
  "event.registration.code_invalidated.v1": (event) => onsiteEventKeys(event),

  // Nabor prelegentow: lista, liczniki i szczegol w panelu organizatora
  // (galaz `["event-cfp", eventId]`) oraz "moje zgloszenia", panel prelegenta
  // i kolejka recenzenta (`["event-cfp-me"]` - klucz uczestnika jest po slugu,
  // ktorego payload nie niesie, wiec uniewazniamy cala galez).
  // Decyzja (cofniecie przyjecia), rezygnacja i potwierdzenie prelegenta
  // zmieniaja TEZ liste prelegentow wydarzenia: potwierdzenie wpisuje osobe
  // do rejestru, rezygnacja i cofniecie ja zdejmuja (razem z obsada sesji).
  // Bez tego organizator w studiu i kazdy zalogowany na otwartej stronie
  // wydarzenia widzieli stara liste do konca `staleTime`.
  "event_cfp_submission.submitted.v1": (event) => cfpEventKeys(event),
  "event_cfp_submission.decided.v1": (event) => cfpRosterEventKeys(event),
  "event_cfp_submission.withdrawn.v1": (event) => cfpRosterEventKeys(event),
  "event_cfp_submission.confirmed.v1": (event) => cfpRosterEventKeys(event),
  "event_cfp_review.saved.v1": (event) => cfpEventKeys(event),
  // Faktury organizatora: ekran faktur studia (galaz wydarzenia) i karta
  // "Faktury za wydarzenia" w profilu kupujacego.
  "event_invoice.issued.v1": (event) => invoiceEventKeys(event),
  "event_invoice.cancelled.v1": (event) => invoiceEventKeys(event),
  // Plan sali: przydzial i zwolnienie zmieniaja obsade planu ORAZ plakietke
  // miejsca na liscie zgloszen; zmiana ukladu planu - tylko sam plan (lookup
  // miejsc listy zgloszen siedzi w tej samej galezi `event-seating`). Kazda z
  // trzech zmian moze tez zmienic karte miejsca uczestnika (numer, sektor).
  "event_seat.assigned.v1": (event) => seatingEventKeys(event, true),
  "event_seat.released.v1": (event) => seatingEventKeys(event, true),
  "event_seat_map.changed.v1": (event) => seatingEventKeys(event, false),
  // Ustawienia funkcji uczestnika (spec B.9): panel organizatora tego
  // wydarzenia i publiczne flagi `event_participant_options` (wszystkie slugi -
  // payload niesie id wydarzenia, nie slug).
  "event.participant_settings.updated.v1": (event) => participantSettingsEventKeys(event),

  // Tor B: oferty z listy rezerwowej, przekazanie biletu, zwrot samoobsługowy.
  // Te same trzy powierzchnie co zwykłe zgłoszenie + znaczniki pieniędzy
  // w panelu organizatora. Przekazanie zmienia też panel „moje wydarzenie"
  // (plan, zapisy na sesje, certyfikat) - dotychczasowy posiadacz traci go,
  // nowy zyskuje, a klucz uczestnika jest po slugu, którego payload nie niesie.
  "event.registration.offered.v1": (event) => registrationMoneyEventKeys(event),
  "event.registration.offer_closed.v1": (event) => registrationMoneyEventKeys(event),
  "event.registration.transfer_requested.v1": (event) => registrationMoneyEventKeys(event),
  "event.registration.transfer_cancelled.v1": (event) => registrationMoneyEventKeys(event),
  "event.registration.transferred.v1": (event) => [
    ...registrationMoneyEventKeys(event),
    ["event-me"],
  ],
  "event.registration.refund_requested.v1": (event) => registrationMoneyEventKeys(event),
  "event.registration.refund_failed.v1": (event) => registrationMoneyEventKeys(event),

  // Tor C: certyfikaty i ankieta po wydarzeniu.
  "event.certificate.issued.v1": (event) => certificateEventKeys(event),
  "event.certificate.revoked.v1": (event) => certificateEventKeys(event),
  "event.survey.submitted.v1": (event) => [
    eventScopedKey("admin-event-survey-results", event),
    eventScopedKey("admin-event-follow-up-stats", event),
  ],
  "event.survey.questions_changed.v1": (event) => [
    eventScopedKey("admin-event-survey-questions", event),
    ["event-follow-up"],
  ],
  // Klon edycji: nowy wiersz na liscie wydarzen i nowa pozycja na liscie
  // edycji zrodla.
  "event.cloned.v1": (event) => cloneEventKeys(event),

  // ── HUB „PRZYCHÓD I LEJEK" - rdzeń (klucze modułów) ─────────────────────
  // Klucze panelu huba dla tych samych typów dokłada `ADMIN_HUB_INVALIDATION`.

  // Rejestracja konta: nowy wiersz w katalogu członków, nowy lead (sync
  // profilu → CRM) i góra lejka.
  "account.registered.v1": () => [
    billingKeys.admin.members(),
    crmKeys.leadsAll(),
    crmKeys.funnelStats(),
  ],
  // Paywall i limit: karta zużycia limitu przy leadzie CRM (`MeteringUsageCard`).
  "paywall.hit.v1": () => [crmKeys.leadMeteringAll()],
  "metering.quota_exhausted.v1": () => [crmKeys.leadMeteringAll()],
  // Kasa: historia zamówień kupującego i lista zamówień w /admin/billing.
  "checkout.started.v1": () => checkoutOrderKeys(),
  "checkout.completed.v1": () => checkoutOrderKeys(),
  "checkout.failed.v1": () => checkoutOrderKeys(),
  "checkout.abandoned.v1": () => checkoutOrderKeys(),
  // Subskrypcja u operatora: panel subskrypcji (/admin/billing), karta
  // subskrypcji w profilu właściciela i członkostwo przy leadzie CRM.
  "billing_subscription.status_changed.v1": () => providerSubscriptionKeys(),
  "billing_subscription.payment_failed.v1": () => providerSubscriptionKeys(),
  "billing_subscription.payment_recovered.v1": () => providerSubscriptionKeys(),
  "billing_subscription.trial_ending.v1": () => providerSubscriptionKeys(),
  // Przepływ anulowania: odpowiedzi ankiety w zakładce Retencja cennika.
  "retention_flow.started.v1": () => [retentionKeys.admin.feedback()],
  "retention_flow.completed.v1": () => [retentionKeys.admin.feedback()],
  // Zgłoszenie do klubu: skrzynka zgłoszeń (`applicationInboxKeys.all`),
  // kluby (licznik zgłoszeń), historia własnych zgłoszeń na /club/apply
  // i lead CRM (`club_application_crm_sync`). Inbox i historia mają klucze
  // w plikach z logiką (inbox) albo w trasie, więc stoją literałem przypiętym
  // w `revenueInvalidation.test.ts`.
  // Wiadomość z formularza kontaktowego (I9, Z-S5-01): lead powstał albo
  // dostał aktywność w tej samej transakcji (listy CRM), a skrzynka kolejek
  // personelu liczy nieprzeczytane wiadomości.
  "contact_message.submitted.v1": () => [crmKeys.leadsAll(), pendingCounterKeys.tenant()],
  "club_application.submitted.v1": () => clubApplicationKeys(),
  "club_application.decided.v1": () => clubApplicationKeys(),

  // Ustawienia modułów źródłowych (S1). Zapis w jednej karcie odświeża
  // edytory w pozostałych i to, co z ustawień wynika dla czytelnika
  // (`["public", "resolved"]` - rozstrzygnięty dostęp do treści).
  "metering_settings.changed.v1": () => [
    meteringKeys.settings(),
    meteringKeys.impactPreviewAll(),
    crmKeys.leadMeteringAll(),
    ["public", "resolved"],
  ],
  "checkout_settings.changed.v1": () => [checkoutKeys.settings(), billingKeys.admin.monetization()],
  "content_access.changed.v1": (event) => contentAccessKeys(event),
  // `settings()` jest prefiksem projekcji formularzy inline (`settingsInline`).
  "newsletter_settings.changed.v1": () => [newsletterKeys.settings()],
  "retention_settings.changed.v1": () => retentionSettingsKeys(),
  "retention_reason.changed.v1": () => retentionSettingsKeys(),
  // Kupony: lista panelu z katalogami, kampanie i analityka kuponów najemcy
  // - ta sama para co `invalidateCouponQueries`, tylko dla innych kart.
  "coupon.changed.v1": (event) => couponEventKeys(event),
  "coupon_campaign.changed.v1": (event) => couponEventKeys(event),
  "coupon.redeemed.v1": (event) => [...couponEventKeys(event), couponKeys.redemptionsAll()],
  "workflow_definition.changed.v1": () => [workflowKeys.definitions(), workflowKeys.templates()],

  // TYPY CZYSTO PANELOWE: ich jedynymi czytelnikami są ekrany huba, więc
  // rdzeń (bundle `public`) nie ma dla nich ani jednego klucza - całą regułę
  // niesie rozszerzenie panelu. Wpis zostaje, bo katalog i mapa muszą być
  // kompletne (`hubEventCatalog.test.ts`).
  "journey.changed.v1": () => [],
  "journey.stats_changed.v1": () => [],
  "revenue_input.changed.v1": () => [],
  "revenue_diagnostic.snoozed.v1": () => [],
  "data_retention.changed.v1": () => [],
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

/**
 * Wystawienie albo anulowanie dokumentu zmienia liste kandydatow, liste
 * dokumentow i szczegoly w galezi wydarzenia oraz to, co widzi kupujacy
 * w profilu (`event-invoices-me` nie zna wydarzenia - cala galaz).
 */
function invoiceEventKeys(event: DomainEventRow): QueryKey[] {
  const eventId = eventPayloadText(event, "event_id");
  return [eventId === "" ? ["event-invoices"] : ["event-invoices", eventId], ["event-invoices-me"]];
}

/**
 * Plan sali klucza po `event_id` (panel organizatora). Bez identyfikatora
 * w payloadzie uniewazniamy caly korzen - lepiej odswiezyc za duzo niz
 * zostawic stary plan. Karty miejsc uczestnika (`["event-me", slug, "seats"]`
 * w panelu "Moje" i `["event-ticket-seats", slug]` na bilecie) klucza SLUG,
 * ktorego payload nie niesie - jak przy gieldzie spotkan uniewazniamy cale
 * galezie uczestnika (odswiezaja sie tylko zamontowane zapytania).
 */
function seatingEventKeys(event: DomainEventRow, registrations: boolean): QueryKey[] {
  const eventId = eventPayloadText(event, "event_id");
  const branch = (root: string): QueryKey => (eventId === "" ? [root] : [root, eventId]);
  const participant: QueryKey[] = [["event-me"], ["event-ticket-seats"]];
  return registrations
    ? [branch("event-seating"), branch("event-registrations"), ...participant]
    : [branch("event-seating"), ...participant];
}

/**
 * Link raportu sponsora zmienia WYŁĄCZNIE panel: liste linkow i licznik
 * aktywnych linkow w raporcie (galaz `["event-sponsors", eventId]`) oraz
 * historie sponsoringu na karcie firmy (`["event-sponsors", "company"]`).
 * Strona publiczna wydarzenia sie nie zmienia, wiec jej nie ruszamy.
 */
function sponsorReportLinkKeys(event: DomainEventRow): QueryKey[] {
  const eventId = eventPayloadText(event, "event_id");
  return [
    eventId === "" ? ["event-sponsors"] : ["event-sponsors", eventId],
    ["event-sponsors", "company"],
  ];
}

/**
 * Dokument rozliczeniowy: profil kupującego i pulpit monetyzacji (S2) -
 * prefiks `monetization()` obejmuje rejestr `monetizationLedger(env)`.
 */
function billingDocumentKeys(): QueryKey[] {
  return [
    billingKeys.myBillingDocumentsAll(),
    billingKeys.myOrdersAll(),
    billingKeys.admin.monetization(),
  ];
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
// monetyzacji i podsumowanie członkostwa przy leadzie CRM. Od D6 także panel
// subskrypcji operatora, katalog członków (warstwa w wierszu) i kluby -
// dostęp do klubu wynika z warstwy, więc wygaśnięcie zamyka go w tej chwili.
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
    billingKeys.admin.stripeSubscriptions(),
    billingKeys.admin.members(),
    clubKeys.all,
  ];
}

// Nadanie warstwy (D6): oprócz profilu i panelu członkostwa - katalog
// członków z rozwinięciem płatności, rejestr monetyzacji i kluby.
function membershipGrantKeys(): QueryKey[] {
  return [
    billingKeys.myGrantsAll(),
    billingKeys.currentTierAll(),
    billingKeys.admin.membershipGrants(),
    billingKeys.crmLeadMembershipAll(),
    billingKeys.admin.members(),
    billingKeys.admin.memberBillingAll(),
    billingKeys.admin.monetization(),
    clubKeys.all,
  ];
}

/** Lead CRM: listy (każdy filtr) i karta tego leada. */
function crmLeadKeys(event: DomainEventRow): QueryKey[] {
  return [crmKeys.leadsAll(), crmKeys.lead(event.aggregate_id)];
}

/** Lejek CRM: liczności etapów (każdy filtr) i kafle konwersji. */
function crmFunnelKeys(): QueryKey[] {
  return [crmKeys.funnelAll(), crmKeys.funnelStats()];
}

function newsletterSubscriberKeys(): QueryKey[] {
  return [
    newsletterKeys.subscribersAll(),
    newsletterKeys.kpis(),
    crmKeys.leadsAll(),
    ...crmFunnelKeys(),
  ];
}

function checkoutOrderKeys(): QueryKey[] {
  return [billingKeys.myOrdersAll(), billingKeys.admin.paymentOrders()];
}

function providerSubscriptionKeys(): QueryKey[] {
  return [
    billingKeys.admin.stripeSubscriptions(),
    billingKeys.myStripeSubscriptionAll(),
    billingKeys.crmLeadMembershipAll(),
  ];
}

function clubApplicationKeys(): QueryKey[] {
  return [
    ["admin", "club-applications"],
    clubKeys.all,
    ["club-applications", "mine"],
    crmKeys.leadsAll(),
  ];
}

/**
 * Reguła dostępu jednej encji: edytor wpisu czyta `accessKeys.rule(typ, id)`.
 * Brak któregokolwiek pola w payloadzie (uszkodzony wiersz, starszy emiter)
 * degraduje do WSZYSTKICH reguł - `rule("", "")` nie trafiłby w nic, a szersza
 * inwalidacja jest tańsza niż edytor ze starą regułą.
 */
function contentAccessKeys(event: DomainEventRow): QueryKey[] {
  const entityType = eventPayloadText(event, "entity_type");
  const entityId = eventPayloadText(event, "entity_id");
  return [
    entityType === "" || entityId === ""
      ? accessKeys.ruleAll()
      : accessKeys.rule(entityType, entityId),
    accessKeys.overrides(),
    ["public", "resolved"],
    ["unlocked-body"],
  ];
}

/** Ustawienia i powody retencji: dialog anulowania czytelnika i panel cennika. */
function retentionSettingsKeys(): QueryKey[] {
  return [
    retentionKeys.settingsPublic(),
    retentionKeys.reasonsPublic(),
    retentionKeys.admin.settings(),
    retentionKeys.admin.reasons(),
  ];
}

/** Analityka kuponów klucza po najemcy - prefiks trafia w każdy zakres dat. */
function couponEventKeys(event: DomainEventRow): QueryKey[] {
  return [couponKeys.admin(), couponKeys.campaigns(), analyticsCouponsPrefixKey(event.tenant_id)];
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
/**
 * Zdarzenie wywolane przez zalogowanego uzytkownika. Szyna dostarcza je
 * aktorowi (polityka `domain_events_actor_select`), wiec karta, ktora wlasnie
 * wykonala mutacje, dostaje echo wlasnego zapisu. Brak aktora (wpis anonimowy)
 * albo brak sesji nigdy nie jest „wlasnym" zdarzeniem.
 */
function isOwnEvent(event: DomainEventRow, ctx: InvalidationContext): boolean {
  return ctx.userId !== undefined && event.actor_id !== null && event.actor_id === ctx.userId;
}

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

/**
 * Klucze zgloszen. Payload niesie `event_id`, wiec schodzimy do galezi jednego
 * wydarzenia; jego brak (starszy backend) degraduje do CALEJ galezi modulu,
 * bo szersza inwalidacja jest tansza niz nieaktualna lista miejsc. Do tego
 * zawsze: profil uczestnika ("moje zgloszenia" i bilety), skrot w menu konta
 * oraz publiczne liczniki miejsc.
 *
 * PLAN SALI TEGO WYDARZENIA (`["event-seating", eventId]`, literal zgodny
 * z `seatingKeys.event`). Zatwierdzenie, awans z kolejki i anulowanie zmieniaja
 * zbior osob do rozsadzenia: licznik "Bez miejsca", liste uczestnikow planu
 * i gotowosc planu. Zdarzenie `event_seat.released.v1` przychodzi tylko wtedy,
 * gdy ktos TRACI miejsce - przyjecie nowej osoby nie emituje nic z planu.
 */
function registrationEventKeys(event: DomainEventRow): QueryKey[] {
  const eventId = eventPayloadText(event, "event_id");
  const branch: QueryKey =
    eventId === "" ? ["event-registrations"] : ["event-registrations", eventId];
  return [
    branch,
    ["profile", "event-registrations"],
    ["account-menu", "my-events"],
    ["event-rsvp-counts"],
    // Stan miejsc strony (`event_seat_state`) liczy takze pule zgloszen -
    // przyjecie albo anulowanie zmienia liczbe wolnych miejsc.
    eventId === "" ? ["event-seat-state"] : ["event-seat-state", eventId],
    ["public-event"],
    eventId === "" ? ["event-seating"] : ["event-seating", eventId],
  ];
}

/** Zgloszenie + ekran faktur wydarzenia i karta faktur kupujacego. */
function registrationInvoiceEventKeys(event: DomainEventRow): QueryKey[] {
  return [...registrationEventKeys(event), ...invoiceEventKeys(event)];
}

/**
 * Klucze naboru prelegentow. `event_id` w payloadzie zaweza panel do galezi
 * jednego wydarzenia; jego brak degraduje do calego korzenia modulu (szersza
 * inwalidacja jest tansza niz nieaktualna lista zgloszen). Literaly zgodne
 * z `cfpKeys` i `cfpMeKeys` - pilnuje tego `eventRealtimeKeys.test.ts`.
 */
function cfpEventKeys(event: DomainEventRow): QueryKey[] {
  const eventId = eventPayloadText(event, "event_id");
  return [eventId === "" ? ["event-cfp"] : ["event-cfp", eventId], ["event-cfp-me"]];
}

/**
 * Naboru + lista prelegentow wydarzenia: publiczna (`eventSpeakersPublicKey`
 * z `@/lib/builder/queryKeys` - obiekt wejscia dopasowywany czesciowo, wiec
 * kazdy limit tego wydarzenia, bez innych wydarzen i katalogu), rejestr
 * w studiu i jego podglad. Wystapienia prelegenta w dialogu profilu
 * (`public-speaker-engagements`) sa kluczowane po koncie, ktorego payload nie
 * niesie - stad caly korzen. Brak `event_id` degraduje do korzeni.
 */
function cfpRosterEventKeys(event: DomainEventRow): QueryKey[] {
  const eventId = eventPayloadText(event, "event_id");
  const roster: QueryKey[] =
    eventId === ""
      ? [["builder-speakers"], ["admin-event-speakers"]]
      : [
          ["builder-speakers", { source: "event", eventId }],
          ["admin-event-speakers", eventId],
          ["admin", "event", eventId, "speakers"],
        ];
  return [...cfpEventKeys(event), ...roster, ["public-speaker-engagements"]];
}

/**
 * Klucze ustawien uczestnika. Literaly (a nie fabryki z
 * `useParticipantSettings`/`useEventParticipantOptions`) z tego samego powodu
 * co wyzej: mapa nie moze wciagac hookow modulu do wspolnego chunku realtime.
 * Brak `event_id` (uszkodzony wiersz) degraduje do calego prefiksu panelu.
 */
function participantSettingsEventKeys(event: DomainEventRow): QueryKey[] {
  const eventId = eventPayloadText(event, "event_id");
  return [
    eventId === ""
      ? ["admin-event-participant-settings"]
      : ["admin-event-participant-settings", eventId],
    ["event-participant-options"],
  ];
}

/**
 * Klucz panelu jednego wydarzenia (`[prefiks, event_id]`); brak `event_id`
 * w payloadzie (uszkodzony wiersz, starszy backend) degraduje do CAŁEGO
 * prefiksu - szersza inwalidacja jest tańsza niż nieaktualny panel.
 */
function eventScopedKey(prefix: string, event: DomainEventRow): QueryKey {
  const eventId = eventPayloadText(event, "event_id");
  return eventId === "" ? [prefix] : [prefix, eventId];
}

/** Zgłoszenie + znaczniki pieniędzy (oferta, przekazanie, zwrot) w panelu organizatora. */
function registrationMoneyEventKeys(event: DomainEventRow): QueryKey[] {
  return [...registrationEventKeys(event), eventScopedKey("admin-event-registration-money", event)];
}

/** Certyfikat: lista w panelu organizatora i panel follow-up uczestnika (po slugu - cała gałąź). */
function certificateEventKeys(event: DomainEventRow): QueryKey[] {
  return [eventScopedKey("admin-event-certificates", event), ["event-follow-up"]];
}

/**
 * Klucze klonu edycji. Lista wydarzen modulu i stara lista spolecznosci
 * dostaja nowy wiersz; galaz zrodla (`["event-clone", source_event_id]`,
 * literal zgodny z `eventCloneKeys.event`) - nowa pozycje na liscie edycji.
 * Brak zrodla w payloadzie degraduje do calego korzenia klonu.
 */
function cloneEventKeys(event: DomainEventRow): QueryKey[] {
  const sourceId = eventPayloadText(event, "source_event_id");
  return [
    ["admin-module-events"],
    ["admin-community-events"],
    sourceId === "" ? ["event-clone"] : ["event-clone", sourceId],
  ];
}

const eventKeysList: QueryKey[] = [
  ["public-events"],
  ["public-event"],
  ["event-rsvp-counts"],
  ["event-seat-state"],
  ["admin-community-events"],
  ["admin-community-stats"],
];
function eventKeys(): QueryKey[] {
  return eventKeysList;
}

/* ------------------------------------------------- rejestr rozszerzeń */

/** Dodatkowe reguły warstwy, która ładuje się później niż rdzeń (panel admina). */
export type InvalidationExtension = Partial<Record<DomainEventType, InvalidationRule>>;

/**
 * Zarejestrowane rozszerzenia z licznikiem właścicieli. Licznik, a nie sam
 * zbiór: podwójny montaż efektu w StrictMode (rejestracja → sprzątanie →
 * rejestracja) i dwóch niezależnych właścicieli tego samego rozszerzenia
 * muszą dać ten sam wynik - rozszerzenie znika dopiero z ostatnim właścicielem.
 */
const extensions = new Map<InvalidationExtension, number>();

/**
 * Dokłada reguły rozszerzenia do `invalidationKeysFor`; zwraca funkcję
 * wyrejestrowania (wprost do zwrotu z `useEffect`). Wielokrotne wywołanie
 * zwróconej funkcji zdejmuje JEDNĄ rejestrację - sprzątanie wołane dwa razy
 * nie odbiera rozszerzenia innemu właścicielowi.
 */
export function registerInvalidationExtension(ext: InvalidationExtension): () => void {
  extensions.set(ext, (extensions.get(ext) ?? 0) + 1);
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    const owners = (extensions.get(ext) ?? 1) - 1;
    if (owners > 0) extensions.set(ext, owners);
    else extensions.delete(ext);
  };
}

/**
 * Klucze do inwalidacji dla zdarzenia: rdzeń ∪ zarejestrowane rozszerzenia.
 * Nieznany typ (nowszy backend, starszy bundle) nie wywraca konsumenta -
 * zwracamy pustą listę; rozszerzenie nie może „ożywić" typu spoza katalogu.
 */
export function invalidationKeysFor(event: DomainEventRow, ctx: InvalidationContext): QueryKey[] {
  const type = event.event_type as DomainEventType;
  const rule = (eventInvalidationMap as Partial<Record<string, InvalidationRule>>)[type];
  if (!rule) return [];
  const core = rule(event, ctx);
  if (extensions.size === 0) return core;
  // KOPIA, nie `push` w wynik reguły: część reguł oddaje tablicę wspólną dla
  // wszystkich wywołań (`eventKeysList`) - dopisanie do niej rozszerzałoby
  // rdzeń na stałe, także po wyrejestrowaniu.
  const keys = [...core];
  for (const ext of extensions.keys()) {
    const extra = ext[type];
    if (extra) keys.push(...extra(event, ctx));
  }
  return keys;
}
