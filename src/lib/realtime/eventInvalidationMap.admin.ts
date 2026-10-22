// ROZSZERZENIE MAPY INWALIDACJI DLA PANELU: klucze huba „Przychód i lejek".
//
// DLACZEGO OSOBNY MODUŁ. Rdzeń mapy (`eventInvalidationMap.ts`) jedzie
// w chunku szyny, który ładuje każdy zalogowany - także czytelnik, który
// panelu nigdy nie otworzy. Reguły huba są potrzebne wyłącznie tam, gdzie
// istnieją zapytania huba, czyli w panelu, więc ten plik importuje tylko
// `routes/admin.tsx` (rejestracja po hydratacji i sesji). Nic stąd nie trafia
// do bundla `public`.
//
// WYŁĄCZNIE PREFIKSY PANELU: `["admin-revenue", …]` (agregaty huba),
// `["admin", "journeys", …]` (ścieżki komunikacji) i `["admin",
// "data-retention", …]` (karta retencji danych, I9c-X2). Klucze modułów, które hub
// czyta wspólnie z nimi, należą do rdzenia - inaczej druga karta modułu nie
// odświeżyłaby się bez otwartego panelu. Pilnuje tego
// `invalidationExtension.test.ts`.
//
// PREFIKS DZIEDZINY Z NAJEMCĄ, nigdy pełny klucz zapytania: zdarzenie mówi,
// CO się zmieniło, ale nie zna okna ani filtrów, które admin ma otwarte.
// `revenueKeys.domainTenant` trafia w każde zapamiętane okno dziedziny tego
// najemcy i w nic poza nią. Te klucze idą WOLNYM pasem (5 s, patrz
// `isSlowInvalidationKey`) - agregat przeliczany po każdej ramce realtime to
// koszt bazy bez zysku dla czytelnika wykresu.
import type { QueryKey } from "@tanstack/react-query";
import { journeyKeys } from "@/lib/journeys/keys";
import { dataRetentionKeys } from "@/lib/privacy/keys";
import { revenueKeys, type RevenueDomain } from "@/lib/revenue/keys";
import type { DomainEventRow, DomainEventType } from "./domainEvents";
import type { InvalidationExtension } from "./eventInvalidationMap";

/**
 * Typy, których jedynymi czytelnikami są ekrany huba: rdzeń ma dla nich regułę
 * pustą, a cała inwalidacja żyje tutaj (`eventInvalidationMap.test.ts`).
 */
export const PANEL_ONLY_EVENT_TYPES = [
  "journey.changed.v1",
  "journey.stats_changed.v1",
  "revenue_input.changed.v1",
  "revenue_diagnostic.snoozed.v1",
  "data_retention.changed.v1",
] as const satisfies readonly DomainEventType[];

/** `rev(d)`: dziedzina huba najemcy zdarzenia. */
function rev(domain: RevenueDomain, event: DomainEventRow): QueryKey {
  return revenueKeys.domainTenant(domain, event.tenant_id);
}

/** Wszystko, co liczy się z księgi MRR (ruchy, odejścia, kohorty, windykacja, kokpit). */
function mrrK(event: DomainEventRow): QueryKey[] {
  return [
    rev("mrr", event),
    rev("churn", event),
    rev("cohorts", event),
    rev("dunning", event),
    rev("snapshot", event),
  ];
}

/**
 * Ruch subskrypcji u operatora: księga MRR, ekonomika liczona z księgi
 * i Lejek (konwersja okresu próbnego).
 */
function subK(event: DomainEventRow): QueryKey[] {
  return [...mrrK(event), rev("economics", event), rev("funnel", event)];
}

/** Lejek huba i kokpit, który pokazuje jego górę. */
function funK(event: DomainEventRow): QueryKey[] {
  return [rev("funnel", event), rev("snapshot", event)];
}

/** Diagnostyka - prefiks obejmuje też fakty i wyciszenia najemcy. */
function diagK(event: DomainEventRow): QueryKey[] {
  return [rev("diagnostics", event)];
}

/**
 * Ścieżka zdarzenia. Agregatem jest ścieżka, więc identyfikator to
 * `aggregate_id`; pusty (uszkodzony wiersz) nie może zbudować `detail("")`,
 * który trafiłby w nic - wtedy reguła degraduje do całego korzenia ścieżek.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function journeyId(event: DomainEventRow): string {
  return typeof event.aggregate_id === "string" ? event.aggregate_id : "";
}

export const ADMIN_HUB_INVALIDATION: InvalidationExtension = {
  // Katalog i dostęp: macierz oferty, inwentarz paywalla i reguły diagnostyki
  // (`catalog.*`) czytają warstwy i plany; plan zmienia też wycenę księgi MRR.
  "membership_tier.changed.v1": (e) => [rev("offer", e), rev("access", e), ...diagK(e)],
  "access_plan.changed.v1": (e) => [...mrrK(e), rev("offer", e), rev("access", e), ...diagK(e)],

  // Uprawnienie subskrypcyjne: ruch MRR i przychód zrealizowany (odnowienie).
  "subscription.started.v1": (e) => [...mrrK(e), rev("realized", e)],
  "subscription.status_changed.v1": (e) => [...mrrK(e), rev("realized", e)],
  "subscription.updated.v1": (e) => [...mrrK(e), rev("realized", e)],
  "subscription.renewed.v1": (e) => [...mrrK(e), rev("realized", e)],
  "subscription.expired.v1": (e) => [...mrrK(e), rev("realized", e)],
  // Subskrypcja u operatora: windykacja, trial i stan MRR. Do tego (I9,
  // tryb ścisły `metrics` manifestu): ekonomika (LTV, LTV/CAC, zwrot CAC,
  // R40 liczą się z księgi MRR) i Lejek (konwersja okresu próbnego) - bez
  // nich Kokpit pokazywałby te wskaźniki sprzed ruchu subskrypcji.
  "billing_subscription.status_changed.v1": (e) => subK(e),
  "billing_subscription.payment_failed.v1": (e) => subK(e),
  "billing_subscription.payment_recovered.v1": (e) => subK(e),
  "billing_subscription.trial_ending.v1": (e) => subK(e),

  // Przychód zrealizowany: dokumenty i wpłaty.
  "billing_document.issued.v1": (e) => [rev("realized", e), rev("snapshot", e)],
  "billing_document.updated.v1": (e) => [rev("realized", e), rev("snapshot", e)],
  "checkout.started.v1": (e) => [...funK(e), rev("realized", e)],
  "checkout.completed.v1": (e) => [...funK(e), rev("realized", e)],
  "checkout.failed.v1": (e) => [...funK(e), rev("realized", e)],
  "checkout.abandoned.v1": (e) => [...funK(e), rev("realized", e)],

  // Społeczność: przekrój wydarzeń (zgłoszenia, wpłaty, obecność) i klubów.
  "event.registration.created.v1": (e) => [rev("events", e)],
  "event.registration.decided.v1": (e) => [rev("events", e)],
  "event.registration.cancelled.v1": (e) => [rev("events", e)],
  "event.registration.promoted.v1": (e) => [rev("events", e)],
  "event.registration.payment.v1": (e) => [rev("events", e), rev("realized", e)],
  "event.registration.attended.v1": (e) => [rev("events", e)],
  "club_member.changed.v1": (e) => [rev("clubs", e)],
  "club_application.submitted.v1": (e) => [rev("clubs", e)],
  "club_application.decided.v1": (e) => [rev("clubs", e)],

  // Lejek: konto, paywall, newsletter i CRM zasilają kolejne etapy.
  "account.registered.v1": (e) => funK(e),
  "paywall.hit.v1": (e) => [...funK(e), rev("access", e)],
  "metering.quota_exhausted.v1": (e) => [...funK(e), rev("access", e)],
  // Subskrybent newslettera zasila też kartę Zdrowie poczty (przyrost listy,
  // potwierdzenia DOI, wypisy) - dziedzina `email` (I9, tryb ścisły `metrics`).
  "newsletter_subscriber.subscribed.v1": (e) => [...funK(e), rev("email", e)],
  "newsletter_subscriber.confirmed.v1": (e) => [...funK(e), rev("email", e)],
  "newsletter_subscriber.unsubscribed.v1": (e) => [...funK(e), rev("email", e)],
  "newsletter_subscriber.resubscribed.v1": (e) => [...funK(e), rev("email", e)],
  "crm_lead.created.v1": (e) => funK(e),
  "crm_lead.stage_changed.v1": (e) => funK(e),
  "crm_lead.updated.v1": (e) => funK(e),
  "crm_lead.lifecycle_changed.v1": (e) => funK(e),

  // Retencja: odejście (lub jego uniknięcie) zmienia przepływ i churn.
  "retention_flow.started.v1": (e) => [rev("retention", e), rev("churn", e)],
  "retention_flow.completed.v1": (e) => [rev("retention", e), rev("churn", e)],

  // Diagnostyka: reguły czytają ustawienia, kupony, zadania i przepisy, więc
  // naprawa wykonana w module gasi kartę diagnozy w hubie innej karty.
  "crm_task.created.v1": (e) => diagK(e),
  "crm_task.completed.v1": (e) => diagK(e),
  "crm_task.due.v1": (e) => diagK(e),
  "metering_settings.changed.v1": (e) => [rev("access", e), ...diagK(e)],
  "checkout_settings.changed.v1": (e) => diagK(e),
  "content_access.changed.v1": (e) => [rev("access", e), ...diagK(e)],
  "newsletter_settings.changed.v1": (e) => diagK(e),
  "retention_settings.changed.v1": (e) => diagK(e),
  "retention_reason.changed.v1": (e) => diagK(e),
  "coupon.changed.v1": (e) => [rev("offer", e), ...diagK(e)],
  "coupon_campaign.changed.v1": (e) => [rev("offer", e), ...diagK(e)],
  "coupon.redeemed.v1": (e) => [rev("offer", e), ...diagK(e), rev("snapshot", e)],
  "workflow_definition.changed.v1": (e) => diagK(e),

  // Typy czysto panelowe (rdzeń: `[]`).
  "journey.changed.v1": (e) => {
    // Ustawienia silnika (S5, `admin_journey_settings_save`): agregatem jest
    // najemca, nie ścieżka - odświeżamy kartę ustawień, zdrowie silnika
    // i listę (włączenie silnika zmienia jej stan), a nie `detail(najemca)`.
    if (isRecord(e.payload) && e.payload.op === "settings") {
      return [
        journeyKeys.settings(e.tenant_id),
        journeyKeys.engineHealth(e.tenant_id),
        journeyKeys.listAll(),
      ];
    }
    const id = journeyId(e);
    if (id === "") return [journeyKeys.root(), ...diagK(e)];
    return [journeyKeys.listAll(), journeyKeys.detail(id), ...diagK(e)];
  },
  // Raz na ścieżkę na tick: statystyki (wolny pas), kontakty w ścieżce, lista
  // (liczniki) i karta leada.
  "journey.stats_changed.v1": (e) => {
    const id = journeyId(e);
    if (id === "") return [journeyKeys.root()];
    return [
      journeyKeys.statsFor(id),
      journeyKeys.enrollmentsFor(id),
      journeyKeys.listAll(),
      journeyKeys.forLeadAll(),
    ];
  },
  "revenue_input.changed.v1": (e) => [rev("inputs", e), rev("economics", e), rev("snapshot", e)],
  "revenue_diagnostic.snoozed.v1": (e) => [
    revenueKeys.facts(e.tenant_id),
    revenueKeys.snoozes(e.tenant_id),
  ],
  // Karta „Retencja danych" (I9c-X2): ustawienia, podgląd i lista „do
  // anonimizacji" najemcy zdarzenia - jeden prefiks.
  "data_retention.changed.v1": (e) => [dataRetentionKeys.tenant(e.tenant_id)],
};
