// MANIFEST SYNCHRONIZACJI HUBA „PRZYCHÓD I LEJEK" (SPEC §3.1-3.2, DANE §3).
//
// PO CO. Hub nie ma własnych danych - czyta byty modułów (warstwy, plany,
// kupony, leady, ścieżki…). Każdy z nich ma JEDNO źródło prawdy, jednego
// kanonicznego pisarza i ekran-właściciela, a jego zmiana musi dotrzeć do
// każdej otwartej karty. Ta tabela zapisuje tę wiedzę raz, jako dane:
// diagnostyka huba rysuje z niej „Mapę systemu", nagłówki źródeł (S6) biorą
// z niej ekran-właściciela, a `syncManifest.test.ts` sprawdza ją z kodem
// w obie strony - tabele z `types.ts`, trasy z `routeTree.gen.ts`, zdarzenia
// z katalogu szyny i klucze z mapy inwalidacji.
//
// CZYSTY MODUŁ: bez hooków i I/O. Klucze pochodzą z fabryk-liści (jedno
// wywołanie zamiast drugiego napisu); literał stoi tylko tam, gdzie fabryka
// mieszka w pliku hooków albo logiki modułu - z komentarzem i przypięciem
// w teście.
//
// STAN DOCELOWY, NIE DZISIEJSZY. Pisarze to mutatory i RPC z kontraktu SPEC;
// część z nich powstaje w wycinkach S1-S7. Test przepuszcza pisarza, którego
// jeszcze nie ma, wyłącznie wtedy, gdy jego plik albo funkcja SQL należy do
// manifestu wycinka (`hubDelivery.ts`) - literówka nie przejdzie.
import type { QueryKey } from "@tanstack/react-query";
import type { Database } from "@/integrations/supabase/types";
import type { MetricGroup, MetricId } from "@/lib/analytics/semantic/metrics";
import type { DomainEventType } from "@/lib/realtime/domainEvents";
import type { RevenueTabId } from "@/lib/revenue/search";
import { accessKeys, checkoutKeys, meteringKeys } from "@/lib/access/keys";
import { couponKeys } from "@/lib/admin/couponKeys";
import { workflowKeys } from "@/lib/admin/workflowKeys";
import { billingKeys } from "@/lib/billing/keys";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { crmKeys } from "@/lib/crm/keys";
import { journeyKeys } from "@/lib/journeys/keys";
import { newsletterKeys } from "@/lib/newsletter/keys";
import { retentionKeys } from "@/lib/retention/keys";
import { revenueKeys, type RevenueDomain } from "@/lib/revenue/keys";

/**
 * Byty synchronizowane przez hub - po jednym na wiersz SPEC §3.2. Pominięte
 * są byty statyczne (para katalogowa ceny, benchmarki): żyją w kodzie, nie
 * mają tabeli, zdarzenia ani pisarza w czasie działania, więc nie ma czego
 * synchronizować.
 */
export const HUB_ENTITY_IDS = [
  "membership_tier",
  "access_plan",
  "content_access",
  "metering",
  "checkout_settings",
  "coupon",
  "coupon_campaign",
  "retention_settings",
  "retention_flow",
  "provider_subscription",
  "entitlement",
  "membership_grant",
  "billing_document",
  "payment_order",
  "account",
  "paywall_hit",
  "crm_lead",
  "crm_task",
  "newsletter_subscriber",
  "newsletter_settings",
  "workflow",
  "journey",
  "journey_run",
  "event_registration",
  "club_application",
  "club_member",
  "revenue_input",
  "revenue_diagnostic",
] as const;
export type HubEntityId = (typeof HUB_ENTITY_IDS)[number];

/**
 * Rodzaj pisarza. `mutator` to zapis z klienta przez moduł (hak z patchem
 * jawnych kolumn i współbieżnością optymistyczną albo formularz modułu, który
 * S1 przenosi do haka), `server_fn` - funkcja serwerowa,
 * `webhook` - obsługa zdarzeń operatora płatności, `rpc` - funkcja SQL
 * (RPC panelu albo funkcja wewnętrzna), `trigger` - funkcja triggera.
 */
export type HubWriterKind = "mutator" | "server_fn" | "webhook" | "rpc" | "trigger";

export interface HubWriter {
  readonly kind: HubWriterKind;
  /** `ścieżka` albo `ścieżka#eksport` (mutator, server_fn, webhook); nazwa funkcji SQL (rpc, trigger). */
  readonly ref: string;
}

export interface HubOwner {
  /** Pełna ścieżka trasy z `routeTree.gen.ts` (parametry jako `$nazwa`). */
  readonly to: string;
  readonly params?: Readonly<Record<string, string>>;
  /** Kontrakt deep linku (SPEC §2.6) - zakładka albo filtr ekranu. */
  readonly search?: Readonly<Record<string, string>>;
  /**
   * Kolumny, które pisze WYŁĄCZNIE ten ekran. Dwa ekrany tego samego bytu
   * mają zbiory rozłączne (jeden właściciel kolumny); brak pola = ekran
   * edytuje wiersze w całości (np. reguła dostępu innej encji).
   */
  readonly columns?: readonly string[];
}

/** Tabela schematu `public` z typów generowanych. */
export type HubTableName = keyof Database["public"]["Tables"];

export interface HubEntity {
  readonly id: HubEntityId;
  /** Literalne nazwy tabel `public` (kompilator i test sprawdzają je z `types.ts`). */
  readonly tables: readonly HubTableName[];
  readonly writers: readonly HubWriter[];
  /** Ekrany-właściciele; pusta lista = pisze wyłącznie system (trigger, silnik). */
  readonly owners: readonly HubOwner[];
  /** Prefiksy kluczy, spod których moduł i hub czytają ten byt. */
  readonly keys: readonly QueryKey[];
  readonly events: readonly DomainEventType[];
  /** Zakładki huba, które pokazują byt - każde jego zdarzenie musi je odświeżać. */
  readonly hubTabs: readonly RevenueTabId[];
  /**
   * Wskaźniki huba (`HUB_METRIC_IDS`, rejestr S6), które ten byt zasila.
   * TRYB ŚCISŁY (I9): każde zdarzenie bytu unieważnia dziedzinę każdego jego
   * wskaźnika (`METRIC_GROUP_DOMAINS`) - inaczej kafel wskaźnika w otwartej
   * karcie pokazuje liczbę sprzed zmiany, którą moduł właśnie zapisał.
   */
  readonly metrics: readonly MetricId[];
}

/**
 * Nazwy tabel przez funkcję, nie literał tablicowy. Dwa powody: kompilator
 * odrzuca tabelę spoza `types.ts`, a `["content_access"]` (tabela o tej
 * samej nazwie co korzeń `accessKeys.ruleAll()`) bramka literałów kluczy
 * brałaby za klucz React Query zapisany obok fabryki.
 */
function dbTables(...names: HubTableName[]): readonly HubTableName[] {
  return names;
}

const BILLING_WEBHOOK: HubWriter = {
  kind: "webhook",
  ref: "src/lib/billing/webhookDispatch.server.ts",
};

const SUBSCRIPTION_EVENTS = [
  "subscription.started.v1",
  "subscription.status_changed.v1",
  "subscription.updated.v1",
  "subscription.renewed.v1",
  "subscription.expired.v1",
] as const satisfies readonly DomainEventType[];

/**
 * Dziedziny huba, pod którymi żyją wskaźniki grupy rejestru S6 - prefiks
 * `["admin-revenue", dziedzina, najemca]`, który unieważnia reguła szyny
 * (`rev(d)` w `eventInvalidationMap.admin.ts`). Grupa ma kilka dziedzin, bo
 * ten sam wskaźnik pokazuje kilka zakładek: NRR liczy most MRR, ale widać go
 * też w Retencji (churn) i Kokpicie (snapshot). CRM liczy tor sprzedaży
 * Lejka (`?track=sales`), więc jego dziedziną jest `funnel`. Ruch (`traffic`)
 * nie należy do huba - pusta lista.
 */
export const METRIC_GROUP_DOMAINS = {
  traffic: [],
  revenue: ["mrr", "realized", "snapshot", "offer"],
  retention: ["churn", "retention", "cohorts", "dunning"],
  funnel: ["funnel"],
  economics: ["economics", "inputs"],
  email: ["email"],
  community: ["events", "clubs"],
  crm: ["funnel"],
} as const satisfies Readonly<Record<MetricGroup, readonly RevenueDomain[]>>;

/**
 * Wskaźniki ścieżek (grupa `email` rejestru S6) liczy karta statystyk
 * ścieżki - żyją pod `journeyKeys.root()`, nie pod dziedziną huba, więc
 * zdarzenie statystyk ścieżki odświeża je przez klucze ścieżek.
 */
export const JOURNEY_STATS_METRICS = [
  "journey_open_rate",
  "journey_click_rate",
  "journey_goal_rate",
] as const satisfies readonly MetricId[];

/**
 * Wskaźniki huba BEZ bytu w manifeście - świadomie, z powodem. Test
 * pokrycia wymaga, żeby każdy wskaźnik huba był albo zasilany bytem, albo
 * stał tutaj (nowy wskaźnik nie zniknie po cichu z mapy synchronizacji).
 *   * odczyty treści (DAU/MAU, WAU/MAU) i aktywność w klubach - zdarzenia
 *     czytelnika, nie byty z pisarzem w panelu;
 *   * konwersja strony cennika - sesje analityki pierwszej strony;
 *   * zaangażowanie kampanii (otwarcia, kliknięcia, odbicia, skargi,
 *     zniechęcenie) - zdarzenia odbiorców kampanii newslettera, których hub
 *     nie synchronizuje jako bytu (karta Zdrowie poczty czyta je okresowo).
 */
export const HUB_METRICS_WITHOUT_ENTITY = [
  "pricing_page_conversion_rate",
  "email_open_rate",
  "email_ctr_delivered",
  "email_hard_bounce_rate",
  "email_soft_bounce_rate",
  "email_spam_complaint_rate",
  "email_disaffection_rate",
  "club_contributor_rate",
  "dau_mau",
  "wau_mau",
] as const satisfies readonly MetricId[];

export const HUB_SYNC_MANIFEST: readonly HubEntity[] = [
  {
    // Jeden byt, DWA ekrany o rozłącznych kolumnach: tożsamość, ranga i
    // egzekwowane flagi należą do członkostwa, obietnica marketingowa - do
    // cennika (koniec dwóch edytorów `benefits`, defekt 11 z briefu 02).
    id: "membership_tier",
    tables: dbTables("membership_tiers"),
    writers: [
      { kind: "mutator", ref: "src/lib/billing/tierMutations.ts#useSaveTierCore" },
      { kind: "mutator", ref: "src/lib/billing/tierMutations.ts#useSaveTierMarketing" },
    ],
    owners: [
      { to: "/admin/membership", columns: ["key", "rank", "features", "active", "is_default"] },
      {
        to: "/admin/pricing",
        search: { tab: "tiers" },
        columns: [
          "name_pl",
          "name_en",
          "description_pl",
          "description_en",
          "benefits",
          "badge_pl",
          "badge_en",
          "highlight",
          "cta_mode",
          "audience_key",
          "price_note_pl",
          "price_note_en",
          "contact_url",
          "per_seat",
          "pricing_visible",
        ],
      },
    ],
    keys: [
      billingKeys.membershipTiers(),
      billingKeys.admin.membershipTiers(),
      billingKeys.currentTierAll(),
      billingKeys.crmLeadMembershipAll(),
      couponKeys.tiers(),
    ],
    events: ["membership_tier.changed.v1"],
    hubTabs: ["offer", "access", "diagnostics"],
    metrics: [],
  },
  {
    // Cena i cykl należą do paywalla; przypięcie planu do warstwy - do
    // członkostwa (tam admin widzi, CO plan sprzedaje).
    id: "access_plan",
    tables: dbTables("access_plans"),
    writers: [{ kind: "mutator", ref: "src/lib/billing/planQueries.ts#useSaveAccessPlanPatch" }],
    owners: [
      {
        to: "/admin/paywall",
        search: { tab: "plans" },
        columns: [
          "price_cents",
          "currency",
          "interval",
          "trial_days",
          "active",
          "for_sale",
          "volume_price_cents",
          "volume_threshold_seats",
        ],
      },
      { to: "/admin/membership", columns: ["tier_key"] },
    ],
    keys: [
      billingKeys.plansActive(),
      billingKeys.admin.plans(),
      billingKeys.admin.plansAll(),
      billingKeys.admin.testPlans(),
      couponKeys.plans(),
    ],
    events: ["access_plan.changed.v1"],
    hubTabs: ["offer", "access", "mrr", "diagnostics"],
    metrics: ["price_realization"],
  },
  {
    // Reguła jednej encji: edytor wpisu i wyjątki paywalla piszą RÓŻNE wiersze
    // (różne encje), stąd brak podziału kolumn.
    id: "content_access",
    tables: dbTables("content_access"),
    writers: [
      { kind: "mutator", ref: "src/lib/access/contentAccessQueries.ts#useSaveContentAccessRule" },
    ],
    owners: [{ to: "/admin/posts/$slug" }, { to: "/admin/paywall", search: { tab: "overrides" } }],
    keys: [accessKeys.ruleAll(), accessKeys.overrides()],
    events: ["content_access.changed.v1"],
    hubTabs: ["access", "diagnostics"],
    metrics: [],
  },
  {
    id: "metering",
    tables: dbTables("metering_settings"),
    writers: [
      { kind: "mutator", ref: "src/lib/access/meteringQueries.ts#useSaveMeteringSettings" },
    ],
    owners: [{ to: "/admin/paywall", search: { tab: "metering" } }],
    keys: [meteringKeys.settings(), meteringKeys.impactPreviewAll(), crmKeys.leadMeteringAll()],
    events: ["metering_settings.changed.v1"],
    hubTabs: ["access", "diagnostics"],
    metrics: [],
  },
  {
    id: "checkout_settings",
    tables: dbTables("checkout_settings"),
    writers: [{ kind: "mutator", ref: "src/hooks/useCheckoutSettings.ts#useSaveCheckoutSettings" }],
    owners: [{ to: "/admin/paywall", search: { tab: "checkout" } }],
    keys: [checkoutKeys.settings()],
    events: ["checkout_settings.changed.v1"],
    hubTabs: ["diagnostics"],
    metrics: [],
  },
  {
    // Realizację zapisuje kasa (efekty kuponu po opłaceniu), nie panel.
    id: "coupon",
    tables: dbTables("b2b_coupons", "b2b_coupon_redemptions"),
    writers: [
      {
        kind: "mutator",
        ref: "src/components/admin/coupons/organisms/CouponCreateDialog.tsx#CouponCreateDialog",
      },
      { kind: "rpc", ref: "bulk_generate_coupons_for_campaign" },
      { kind: "server_fn", ref: "src/lib/billing/couponEffects.server.ts" },
    ],
    owners: [{ to: "/admin/coupons" }],
    keys: [couponKeys.admin(), couponKeys.redemptionsAll()],
    events: ["coupon.changed.v1", "coupon.redeemed.v1"],
    hubTabs: ["offer", "diagnostics"],
    metrics: ["coupon_redemption_rate", "average_discount"],
  },
  {
    id: "coupon_campaign",
    tables: dbTables("b2b_coupon_campaigns"),
    writers: [
      { kind: "mutator", ref: "src/lib/admin/couponQueries.ts#useSetCampaignStatus" },
      { kind: "rpc", ref: "admin_coupon_campaign_set_status" },
    ],
    owners: [{ to: "/admin/coupons/campaigns" }],
    keys: [couponKeys.campaigns()],
    events: ["coupon_campaign.changed.v1"],
    hubTabs: ["offer", "diagnostics"],
    metrics: ["coupon_redemption_rate"],
  },
  {
    id: "retention_settings",
    tables: dbTables("retention_settings", "retention_reasons"),
    writers: [{ kind: "mutator", ref: "src/lib/retention/mutations.ts#useSaveRetentionSettings" }],
    owners: [{ to: "/admin/pricing", search: { tab: "retention" } }],
    keys: [
      retentionKeys.settingsPublic(),
      retentionKeys.reasonsPublic(),
      retentionKeys.admin.settings(),
      retentionKeys.admin.reasons(),
    ],
    events: ["retention_settings.changed.v1", "retention_reason.changed.v1"],
    hubTabs: ["retention", "diagnostics"],
    metrics: [],
  },
  {
    // Przepływ anulowania pisze CZYTELNIK ze swojego profilu - panel tylko czyta.
    id: "retention_flow",
    tables: dbTables("retention_feedback"),
    writers: [
      { kind: "server_fn", ref: "src/lib/retention/functions.ts#startRetentionFlow" },
      { kind: "server_fn", ref: "src/lib/retention/functions.ts#submitRetentionFeedback" },
      { kind: "server_fn", ref: "src/lib/retention/functions.ts#acceptRetentionOffer" },
    ],
    owners: [{ to: "/profile/subscription" }],
    keys: [retentionKeys.admin.feedback()],
    events: ["retention_flow.started.v1", "retention_flow.completed.v1"],
    hubTabs: ["retention"],
    metrics: ["cancellation_save_rate"],
  },
  {
    // `subscriptions` jest autorytatywna dla PIENIĘDZY (MRR, windykacja,
    // trial); dostęp rozstrzyga `user_subscriptions` (byt `entitlement`).
    id: "provider_subscription",
    tables: dbTables("subscriptions"),
    writers: [BILLING_WEBHOOK],
    owners: [{ to: "/admin/billing", search: { tab: "subscriptions" } }],
    keys: [
      billingKeys.admin.stripeSubscriptions(),
      billingKeys.myStripeSubscriptionAll(),
      billingKeys.crmLeadMembershipAll(),
    ],
    events: [
      "billing_subscription.status_changed.v1",
      "billing_subscription.payment_failed.v1",
      "billing_subscription.payment_recovered.v1",
      "billing_subscription.trial_ending.v1",
    ],
    hubTabs: ["mrr", "retention"],
    metrics: [
      "mrr",
      "arr",
      "arpa",
      "arpu",
      "mrr_growth_mom",
      "net_new_mrr",
      "saas_quick_ratio",
      "expansion_share_new_mrr",
      "annual_plan_share",
      "gross_revenue_churn",
      "net_revenue_retention",
      "gross_revenue_retention",
      "involuntary_churn_share",
      "dunning_recovery_rate",
      "cohort_retention_m1",
      "cohort_retention_m3",
      "cohort_retention_m12",
      "trial_to_paid_rate",
      "ltv",
      "ltv_cac_ratio",
      "cac_payback_months",
      "rule_of_40",
    ],
  },
  {
    id: "entitlement",
    tables: dbTables("user_subscriptions"),
    writers: [
      { kind: "server_fn", ref: "src/lib/billing/entitlementSync.server.ts#syncEntitlementState" },
    ],
    owners: [{ to: "/admin/users" }],
    keys: [
      billingKeys.mySubscriptionAll(),
      billingKeys.currentTierAll(),
      billingKeys.admin.allUserSubscriptions(),
      billingKeys.admin.stripeSubscriptions(),
      billingKeys.admin.members(),
      clubKeys.all,
    ],
    events: SUBSCRIPTION_EVENTS,
    hubTabs: ["mrr", "overview"],
    metrics: [
      "active_subscriptions",
      "logo_churn_monthly",
      "logo_churn_annual",
      "winback_rate_12m",
      "returning_subscriber_share",
      "revenue_realized",
    ],
  },
  {
    // Jedna ścieżka zapisu (S1 scala nadanie z panelu i z darowizny). Hub
    // czyta nadania przez klucze modułu - nie liczy z nich agregatu.
    id: "membership_grant",
    tables: dbTables("membership_grants"),
    writers: [
      { kind: "rpc", ref: "admin_membership_grant_set" },
      { kind: "rpc", ref: "admin_membership_grant_revoke" },
    ],
    owners: [{ to: "/admin/membership", search: { tab: "grants" } }],
    keys: [
      billingKeys.myGrantsAll(),
      billingKeys.admin.membershipGrants(),
      billingKeys.admin.members(),
      billingKeys.admin.memberBillingAll(),
    ],
    events: ["membership_grant.granted.v1", "membership_grant.revoked.v1"],
    hubTabs: [],
    metrics: [],
  },
  {
    id: "billing_document",
    tables: dbTables("billing_documents"),
    writers: [BILLING_WEBHOOK],
    owners: [{ to: "/admin/monetization-ledger" }],
    keys: [
      billingKeys.myBillingDocumentsAll(),
      billingKeys.myOrdersAll(),
      billingKeys.admin.monetization(),
    ],
    events: ["billing_document.issued.v1", "billing_document.updated.v1"],
    hubTabs: ["mrr", "overview"],
    metrics: ["revenue_realized", "price_realization"],
  },
  {
    id: "payment_order",
    tables: dbTables("payment_orders"),
    writers: [
      {
        kind: "server_fn",
        ref: "src/lib/billing/stripeCheckout.functions.ts#createPlanCheckoutSession",
      },
      BILLING_WEBHOOK,
    ],
    owners: [{ to: "/admin/billing", search: { tab: "orders" } }],
    keys: [billingKeys.myOrdersAll(), billingKeys.admin.paymentOrders()],
    events: [
      "checkout.started.v1",
      "checkout.completed.v1",
      "checkout.failed.v1",
      "checkout.abandoned.v1",
    ],
    hubTabs: ["funnel", "mrr"],
    metrics: [
      "checkout_conversion_rate",
      "checkout_abandonment_rate",
      "registered_to_paid_rate",
      "revenue_realized",
    ],
  },
  {
    // Rejestracja: profil zakłada trigger po `auth.users` - żaden ekran.
    id: "account",
    tables: dbTables("profiles"),
    writers: [{ kind: "trigger", ref: "handle_new_user" }],
    owners: [],
    keys: [billingKeys.admin.members(), crmKeys.leadsAll(), crmKeys.funnelStats()],
    events: ["account.registered.v1"],
    hubTabs: ["funnel"],
    metrics: ["visitor_to_registration_rate", "registered_to_paid_rate"],
  },
  {
    id: "paywall_hit",
    tables: dbTables("paywall_hits", "metering_event_log"),
    writers: [
      { kind: "rpc", ref: "record_paywall_hit" },
      { kind: "rpc", ref: "record_paywall_hit_visitor" },
      { kind: "rpc", ref: "_metered_view_consume" },
    ],
    owners: [],
    keys: [crmKeys.leadMeteringAll()],
    events: ["paywall.hit.v1", "metering.quota_exhausted.v1"],
    hubTabs: ["funnel", "access"],
    metrics: ["paywall_hit_rate", "paywall_conversion_rate"],
  },
  {
    // Cykl życia przesuwają też billing i silnik ścieżek - przez RPC
    // z pierwszeństwem pisarzy (`billing > manual > journey = workflow > system`).
    id: "crm_lead",
    tables: dbTables("crm_leads", "crm_lead_stage_history"),
    writers: [
      { kind: "server_fn", ref: "src/lib/crm.functions.ts#updateCrmLead" },
      { kind: "server_fn", ref: "src/lib/crm.functions.ts#bulkUpdateCrmLeads" },
      { kind: "rpc", ref: "crm_set_lifecycle_stage" },
      { kind: "rpc", ref: "admin_crm_set_lifecycle_stage" },
    ],
    owners: [{ to: "/admin/crm" }],
    keys: [crmKeys.leadsAll(), crmKeys.funnelAll(), crmKeys.funnelStats()],
    events: [
      "crm_lead.created.v1",
      "crm_lead.stage_changed.v1",
      "crm_lead.updated.v1",
      "crm_lead.lifecycle_changed.v1",
    ],
    hubTabs: ["funnel"],
    metrics: [
      "lead_to_mql_rate",
      "mql_to_sql_rate",
      "win_rate",
      "lead_response_time",
      "sales_cycle_length",
    ],
  },
  {
    id: "crm_task",
    tables: dbTables("crm_tasks"),
    writers: [
      { kind: "server_fn", ref: "src/lib/crm-tasks.functions.ts#createCrmTask" },
      { kind: "server_fn", ref: "src/lib/crm-tasks.functions.ts#updateCrmTask" },
      // P24 (I9, Z-S7-02): SPEC §3.2 wymienia `bulkUpdateCrmTasks`, którego
      // nie ma - zbiorczym zapisem jest server fn S4 przypisania zadań bez
      // osoby (lista CRM i szybka naprawa huba wołają ten sam eksport).
      { kind: "server_fn", ref: "src/lib/crm-tasks.functions.ts#assignUnassignedCrmTasks" },
      // Akcja przepisu `create_crm_task` (z `origin_ref` - idempotencja).
      { kind: "rpc", ref: "run_workflow_step" },
    ],
    owners: [{ to: "/admin/crm" }],
    keys: [crmKeys.tasksAll(), crmKeys.funnelStats()],
    events: ["crm_task.created.v1", "crm_task.completed.v1", "crm_task.due.v1"],
    hubTabs: ["diagnostics"],
    metrics: [],
  },
  {
    id: "newsletter_subscriber",
    tables: dbTables("newsletter_subscribers"),
    writers: [
      { kind: "server_fn", ref: "src/lib/newsletter.functions.ts#subscribeToNewsletter" },
      { kind: "rpc", ref: "newsletter_subscriber_list_set" },
    ],
    owners: [{ to: "/admin/newsletter/subscribers" }],
    keys: [
      newsletterKeys.subscribersAll(),
      newsletterKeys.kpis(),
      crmKeys.funnelAll(),
      crmKeys.funnelStats(),
    ],
    events: [
      "newsletter_subscriber.subscribed.v1",
      "newsletter_subscriber.confirmed.v1",
      "newsletter_subscriber.unsubscribed.v1",
      "newsletter_subscriber.resubscribed.v1",
    ],
    hubTabs: ["funnel"],
    metrics: [
      "signup_form_conversion_rate",
      "newsletter_list_growth_rate",
      "doi_confirmation_rate",
      "email_unsubscribe_rate",
    ],
  },
  {
    // Jedno RPC z białą listą kolumn per grupa; podział kolumn między ekrany
    // ustala S1 razem z grupami (do tego czasu bez `columns`).
    id: "newsletter_settings",
    tables: dbTables("newsletter_settings"),
    writers: [{ kind: "rpc", ref: "admin_newsletter_settings_patch" }],
    owners: [{ to: "/admin/newsletter" }, { to: "/admin/popups" }],
    keys: [newsletterKeys.settings()],
    events: ["newsletter_settings.changed.v1"],
    hubTabs: ["diagnostics"],
    metrics: [],
  },
  {
    id: "workflow",
    tables: dbTables("workflow_definitions", "workflow_runs", "workflow_templates"),
    writers: [
      { kind: "server_fn", ref: "src/lib/admin/workflows.ts" },
      { kind: "mutator", ref: "src/lib/admin/workflowQueries.ts#useSetWorkflowEnabled" },
    ],
    owners: [{ to: "/admin/workflows", search: { tab: "definitions" } }],
    keys: [workflowKeys.definitions(), workflowKeys.templates()],
    events: ["workflow_definition.changed.v1"],
    hubTabs: ["diagnostics", "journeys"],
    metrics: [],
  },
  {
    // Definicja ścieżki - jedyny byt, którego ekranem-właścicielem jest hub.
    id: "journey",
    tables: dbTables("journey_definitions", "journey_versions", "journey_email_contents"),
    writers: [
      { kind: "rpc", ref: "admin_journey_create" },
      { kind: "rpc", ref: "admin_journey_save_draft" },
      { kind: "rpc", ref: "admin_journey_publish" },
      { kind: "rpc", ref: "admin_journey_set_status" },
      { kind: "rpc", ref: "admin_journey_email_content_save" },
    ],
    owners: [{ to: "/admin/revenue/$tab", params: { tab: "journeys" } }],
    keys: [journeyKeys.listAll()],
    events: ["journey.changed.v1"],
    hubTabs: ["journeys", "overview"],
    metrics: [],
  },
  {
    // Wykonanie pisze wyłącznie silnik (`service_role`); statystyki e-maili
    // pochodzą z dziennika wysyłek, do którego silnik zapisuje przez kolejkę.
    id: "journey_run",
    tables: dbTables(
      "journey_enrollments",
      "journey_step_runs",
      "journey_messages",
      "journey_message_events",
      "email_send_log",
    ),
    writers: [
      { kind: "server_fn", ref: "src/lib/server/journeysRunner.server.ts" },
      { kind: "rpc", ref: "journey_advance" },
    ],
    owners: [],
    keys: [journeyKeys.listAll(), journeyKeys.forLeadAll()],
    events: ["journey.stats_changed.v1"],
    hubTabs: ["journeys"],
    metrics: ["journey_open_rate", "journey_click_rate", "journey_goal_rate"],
  },
  {
    // `["event-registrations"]` = `registrationKeys.all` - fabryka mieszka
    // w pliku hooków modułu wydarzeń, więc literał (przypięty testem).
    id: "event_registration",
    tables: dbTables("event_registrations", "event_package_orders", "plan_ticket_claims"),
    writers: [{ kind: "server_fn", ref: "src/lib/events/eventRegistration.server.ts" }],
    owners: [{ to: "/admin/events/registrations" }],
    keys: [["event-registrations"]],
    events: [
      "event.registration.created.v1",
      "event.registration.decided.v1",
      "event.registration.cancelled.v1",
      "event.registration.promoted.v1",
      "event.registration.payment.v1",
      "event.registration.attended.v1",
    ],
    hubTabs: ["community"],
    metrics: [
      "event_ticket_revenue",
      "event_attendance_rate",
      "no_show_rate",
      "event_registration_conversion",
    ],
  },
  {
    // `["admin", "club-applications"]` = `applicationInboxKeys.all` - fabryka
    // mieszka w pliku z logiką skrzynki, więc literał (przypięty testem).
    id: "club_application",
    tables: dbTables("club_applications"),
    writers: [
      { kind: "rpc", ref: "club_apply_submit" },
      { kind: "rpc", ref: "admin_club_application_set_status" },
    ],
    owners: [{ to: "/admin/community/clubs/applications" }],
    keys: [["admin", "club-applications"], clubKeys.all],
    events: ["club_application.submitted.v1", "club_application.decided.v1"],
    hubTabs: ["community"],
    metrics: ["club_application_acceptance", "club_decision_time"],
  },
  {
    id: "club_member",
    tables: dbTables("club_members"),
    writers: [
      { kind: "rpc", ref: "club_join" },
      { kind: "rpc", ref: "admin_club_member_upsert" },
      { kind: "rpc", ref: "admin_club_member_remove" },
    ],
    owners: [{ to: "/admin/community/clubs/$clubId" }],
    keys: [clubKeys.all],
    events: ["club_member.changed.v1"],
    hubTabs: ["community"],
    metrics: ["club_active_member_rate"],
  },
  {
    id: "revenue_input",
    tables: dbTables("revenue_manual_inputs"),
    writers: [{ kind: "rpc", ref: "admin_revenue_input_upsert" }],
    owners: [{ to: "/admin/revenue/$tab", params: { tab: "inputs" } }],
    keys: [revenueKeys.domain("inputs"), revenueKeys.domain("economics")],
    events: ["revenue_input.changed.v1"],
    hubTabs: ["inputs", "metrics", "overview"],
    metrics: [
      "ltv",
      "cac",
      "new_cac_ratio",
      "ltv_cac_ratio",
      "cac_payback_months",
      "subscription_gross_margin",
      "rule_of_40",
    ],
  },
  {
    id: "revenue_diagnostic",
    tables: dbTables("revenue_diagnostic_snoozes"),
    writers: [
      { kind: "rpc", ref: "admin_revenue_diagnostic_snooze" },
      { kind: "rpc", ref: "admin_revenue_diagnostic_unsnooze" },
    ],
    owners: [{ to: "/admin/revenue/$tab", params: { tab: "diagnostics" } }],
    keys: [revenueKeys.domain("diagnostics")],
    events: ["revenue_diagnostic.snoozed.v1"],
    hubTabs: ["diagnostics"],
    metrics: [],
  },
];
