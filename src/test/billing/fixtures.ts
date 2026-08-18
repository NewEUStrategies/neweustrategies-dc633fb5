// Atomy testowe POWIERZCHNI MONETYZACJI (checkout / subskrypcje / billing) -
// atomic design zastosowany do testów, jak w `src/test/chat/fixtures.ts`,
// `src/test/network/fixtures.ts` i `src/test/profile/fixtures.ts`.
//
// DLACZEGO TO ISTNIEJE. Audyt 18.08 pokazał w module 13 asymetrię, która
// definiuje tę pracę: KUPNO jest dowiedzione (checkout 65% linii, webhook
// 67,6%, `grant.server` na progu 100/95/100/100), a OBSŁUGA PO KUPNIE nie -
// szesnaście plików `components/billing/**` stało na okrągłym zerze, w tym
// `RetentionDialog.tsx` (ścieżka REZYGNACJI) i `SubscriptionCard.tsx`
// (0 z 39 funkcji). To ekran, na którym płacący klient zmienia plan, pobiera
// faktury i rezygnuje, więc zablokowana albo POZORNIE WYKONANA rezygnacja to
// nie usterka wizualna, a ryzyko prawne.
//
// Koszt wejścia był ten sam co przy profilu: każdy test musiałby budować
// własny plan, subskrypcję (w DWÓCH kształtach - lokalnym i operatorskim),
// zamówienie, dokument, nadanie i ustawienia retencji. Ten moduł robi to raz.
//
// ŻADEN test monetyzacji nie wykonuje realnego żądania do Stripe ani do
// dostawcy poczty - klient operatora wyłącznie przez atrapę (`stripeStub`).
//
// Świadomie BEZ JSX i bez importu komponentów: moduł jest wciągany także
// z wnętrza fabryk `vi.mock`, więc musi być tani i wolny od side-effectów.
import { vi, type Mock } from "vitest";

import type { CatalogPriceEntry } from "@/lib/billing/catalog";
import type { MembershipGrantRow } from "@/lib/billing/membership";
import type { StripeSubscriptionRow } from "@/lib/billing/subscriptionQueries";
import type {
  AccessPlan,
  BillingDocument,
  PaymentOrder,
  UserSubscriptionRow,
} from "@/lib/billing/types";
import type { RetentionReasonRow, RetentionSettingsRow } from "@/lib/retention/queries";

// Atrapa łańcucha PostgREST jest wspólna dla wszystkich powierzchni
// (`src/test/supabaseChain.ts`), atrapy warstwy reactowej też
// (`src/test/reactStubs.ts`) - re-eksport, żeby test monetyzacji miał JEDEN
// import atomów, tak jak testy czatu, sieci i profilu.
export {
  fail,
  ok,
  okCount,
  pgError,
  supabaseFromStub,
  type PostgrestErrorLike,
  type RecordedCall,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
  type TableResponder,
} from "@/test/supabaseChain";
export {
  pendingQueryStub,
  queryStub,
  radixSelectStub,
  reactI18nextStub,
  translateKey,
  type QueryStub,
} from "@/test/reactStubs";

/**
 * Identyfikatory testowe. Tenant jest JAWNY, bo izolacja tenanta jest tu
 * regułą pieniężną, nie kosmetyką: faktura innego tenanta nie może się
 * pokazać (bazy pilnuje `tenant_isolation_billing_storage_test.sql`, strony
 * TS - testy tego modułu).
 */
export const BILLING_IDS = {
  me: "user-me",
  other: "user-other",
  tenant: "tenant-alfa",
  foreignTenant: "tenant-beta",
  subscription: "sub-1",
  order: "order-1",
} as const;

/**
 * Stabilny znacznik czasu bazowy - testy liczą OD NIEGO, nie od `Date.now()`.
 * Reguły okresu rozliczeniowego porównują daty z „teraz", więc data na sztywno
 * w teście oznacza test, który pęknie sam z siebie po pewnym czasie.
 */
export const BASE_NOW = Date.parse("2026-08-18T10:00:00.000Z");

/** ISO przesunięte o `days` względem `BASE_NOW` (ujemne = w przeszłość). */
export function isoFromBase(days: number): string {
  return new Date(BASE_NOW + days * 86_400_000).toISOString();
}

/** Znacznik w przyszłości względem PRAWDZIWEGO „teraz" - opłacony okres trwa. */
export function isoFuture(days = 30): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** Znacznik w przeszłości względem PRAWDZIWEGO „teraz" - okres wygasł. */
export function isoPast(days = 30): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Wzorzec kwoty NIEZALEŻNY OD WERSJI ICU. Asercja na gotowym napisie z `Intl`
 * (`"49,00 zł"`) pęka przy zmianie wersji ICU w środowisku - a zmienia się
 * i separator dziesiętny, i odstęp przed symbolem waluty (bywa NBSP albo
 * U+202F). Test ma dowodzić, że kwota pochodzi z WŁAŚCIWEGO ŹRÓDŁA, nie
 * odtwarzać formatowania, więc dopasowujemy same cyfry z dowolnym separatorem.
 *
 * Samo formatowanie waluty jest sprawdzane w regułach (`types.test.ts`,
 * `displayCurrencyApprox.test.ts`), nie tutaj.
 */
export function moneyPattern(amountCents: number): RegExp {
  const whole = Math.trunc(Math.abs(amountCents) / 100);
  const fraction = String(Math.abs(amountCents) % 100).padStart(2, "0");
  // Separator tysięcy też jest zależny od ICU (spacja, NBSP, kropka).
  const groupedWhole = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, "[\\s.,  ]?");
  return new RegExp(`${groupedWhole}[.,]${fraction}`);
}

// --- katalog i plany --------------------------------------------------------

/**
 * Plan z `access_plans`. Domyślnie MIESIĘCZNY plan `member`, który ma
 * odpowiednik w `BILLING_CATALOG` (`plus_monthly`, ranga 30) - bez wpisu
 * w katalogu plan nie pojawi się ani w tablicy zmiany planu, ani w karcie
 * subskrypcji, więc domyślny fixture MUSI być planem katalogowym.
 */
export function accessPlan(overrides: Partial<AccessPlan> = {}): AccessPlan {
  return {
    id: "plan-member-monthly",
    tenant_id: BILLING_IDS.tenant,
    name_pl: "Członek",
    name_en: "Member",
    description_pl: "Dostęp do analiz",
    description_en: "Access to analyses",
    price_cents: 4900,
    currency: "PLN",
    interval: "month",
    active: true,
    sort_order: 30,
    features_pl: ["Analizy"],
    features_en: ["Analyses"],
    badge_pl: null,
    badge_en: null,
    highlighted: false,
    trial_days: 0,
    tier_key: "member",
    ...overrides,
  };
}

/** Skrót: zestaw planów pokrywający ścieżkę w górę i w dół od `member`. */
export function planLadder(): AccessPlan[] {
  return [
    accessPlan({
      id: "plan-student-monthly",
      tier_key: "student",
      name_pl: "Student",
      name_en: "Student",
      price_cents: 1900,
      sort_order: 10,
    }),
    accessPlan(),
    accessPlan({
      id: "plan-pro-monthly",
      tier_key: "pro",
      name_pl: "Pro",
      name_en: "Pro",
      price_cents: 9900,
      sort_order: 40,
    }),
    accessPlan({
      id: "plan-pro-annual",
      tier_key: "pro",
      interval: "year",
      name_pl: "Pro rocznie",
      name_en: "Pro yearly",
      price_cents: 99900,
      sort_order: 41,
    }),
  ];
}

/** Wpis katalogu cen operatora - do testów rangi i rozliczenia za miejsce. */
export function catalogEntry(overrides: Partial<CatalogPriceEntry> = {}): CatalogPriceEntry {
  return {
    priceId: "plus_monthly",
    productId: "plan_plus",
    tierKey: "member",
    interval: "month",
    rank: 30,
    ...overrides,
  };
}

// --- subskrypcje ------------------------------------------------------------

/**
 * Wiersz LOKALNY (`user_subscriptions`) - to on stoi za kartą na
 * /profile/subscription, gdy subskrypcja nie pochodzi z bramki płatności.
 * Domyślnie AKTYWNA, z trwającym opłaconym okresem i dołączonym planem
 * (bez `plan` karta pokazuje „brak subskrypcji", co jest innym przypadkiem).
 */
export function userSubscription(
  overrides: Partial<UserSubscriptionRow> = {},
): UserSubscriptionRow {
  return {
    id: BILLING_IDS.subscription,
    user_id: BILLING_IDS.me,
    plan_id: "plan-member-monthly",
    status: "active",
    started_at: isoPast(30),
    current_period_end: isoFuture(30),
    canceled_at: null,
    plan: accessPlan(),
    ...overrides,
  };
}

/**
 * Wiersz OPERATORSKI (`subscriptions`). Osobny kształt od lokalnego i to nie
 * przypadek: gdy istnieje, `SubscriptionManagerSection` oddaje całą obsługę
 * karcie dostawcy, więc te dwa fixture'y prowadzą do DWÓCH różnych ekranów.
 */
export function providerSubscription(
  overrides: Partial<StripeSubscriptionRow> = {},
): StripeSubscriptionRow {
  return {
    id: BILLING_IDS.subscription,
    provider_subscription_id: "sub_stripe_1",
    provider_customer_id: "cus_stripe_1",
    product_id: "plan_plus",
    price_id: "plus_monthly",
    status: "active",
    quantity: 1,
    current_period_start: isoPast(1),
    current_period_end: isoFuture(30),
    cancel_at_period_end: false,
    environment: "sandbox",
    created_at: isoPast(30),
    ...overrides,
  };
}

// --- zamówienia i dokumenty -------------------------------------------------

/** Zamówienie z `payment_orders`. Kwoty i waluty SYNTETYCZNE. */
export function paymentOrder(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: BILLING_IDS.order,
    tenant_id: BILLING_IDS.tenant,
    user_id: BILLING_IDS.me,
    kind: "subscription",
    status: "paid",
    amount_cents: 4900,
    currency: "PLN",
    plan_id: "plan-member-monthly",
    entity_type: null,
    entity_id: null,
    provider: "stripe",
    provider_session_id: "cs_test_1",
    provider_intent_id: "pi_test_1",
    invoice_url: null,
    receipt_email: "syntetyczny@example.test",
    metadata: {},
    paid_at: isoPast(1),
    created_at: isoPast(1),
    updated_at: isoPast(1),
    ...overrides,
  };
}

/** Dokument rozliczeniowy (faktura/paragon) z rejestru `billing_documents`. */
export function billingDocument(overrides: Partial<BillingDocument> = {}): BillingDocument {
  return {
    id: "doc-1",
    tenant_id: BILLING_IDS.tenant,
    user_id: BILLING_IDS.me,
    subscription_id: BILLING_IDS.subscription,
    order_id: BILLING_IDS.order,
    kind: "invoice",
    status: "paid",
    provider: "stripe",
    provider_document_id: "in_test_1",
    number: "FV/2026/08/0001",
    amount_cents: 4900,
    currency: "PLN",
    hosted_url: "https://invoice.example.test/in_test_1",
    pdf_url: "https://invoice.example.test/in_test_1.pdf",
    issued_at: isoPast(1),
    created_at: isoPast(1),
    updated_at: isoPast(1),
    ...overrides,
  };
}

// --- członkostwo ------------------------------------------------------------

/**
 * Nadanie warstwy poza planem (`membership_grants`). Domyślnie DOŻYWOTNIE
 * (`expires_at: null`) - to główny przypadek produkcyjny (VIP eksperta NES),
 * a jednocześnie ten, którego plan subskrypcyjny nie potrafi wyrazić.
 */
export function membershipGrant(overrides: Partial<MembershipGrantRow> = {}): MembershipGrantRow {
  return {
    id: "grant-1",
    tier_key: "member",
    source: "manual",
    note: null,
    starts_at: isoPast(30),
    expires_at: null,
    revoked_at: null,
    created_at: isoPast(30),
    ...overrides,
  };
}

// --- retencja (ścieżka rezygnacji) ------------------------------------------

/**
 * Ustawienia kontrofertki retencyjnej. Domyślnie WŁĄCZONE z niezerowym
 * rabatem, bo to jedyna konfiguracja, przy której dialog w ogóle pokazuje
 * krok oferty (`offerAvailable`); wyłączenie oferty to osobny przypadek
 * testowy, w którym rezygnacja idzie od razu.
 */
export function retentionSettings(
  overrides: Partial<RetentionSettingsRow> = {},
): RetentionSettingsRow {
  return {
    tenant_id: BILLING_IDS.tenant,
    enabled: true,
    discount_pct: 30,
    discount_periods: 3,
    coupon_valid_days: 14,
    updated_at: isoPast(7),
    updated_by: null,
    ...overrides,
  };
}

/** Powód odejścia z katalogu panelu admina. */
export function retentionReason(overrides: Partial<RetentionReasonRow> = {}): RetentionReasonRow {
  return {
    id: "reason-price",
    tenant_id: BILLING_IDS.tenant,
    label_pl: "Za drogo",
    label_en: "Too expensive",
    active: true,
    sort_order: 10,
    created_at: isoPast(30),
    updated_at: isoPast(30),
    ...overrides,
  };
}

/** Dwa powody - dość, żeby dowieść wyboru i kolejności, bez zbędnego szumu. */
export function retentionReasons(): RetentionReasonRow[] {
  return [
    retentionReason(),
    retentionReason({
      id: "reason-unused",
      label_pl: "Nie korzystam",
      label_en: "Not using it",
      sort_order: 20,
    }),
  ];
}

// --- dziennik zdarzeń operatora (panel admina) ------------------------------

/**
 * Wiersz dziennika `payment_webhook_events` w kształcie, jaki czyta panel
 * administratora. Domyślnie zdarzenie PRZETWORZONE - stany wyjątkowe
 * (`failed`, `received`) test ustawia jawnie, bo to one są przedmiotem
 * diagnozy.
 */
export function webhookEvent(overrides: Partial<WebhookEventRow> = {}): WebhookEventRow {
  return {
    id: "evt-row-1",
    event_id: "evt_1SyntetyczneZdarzenie",
    event_type: "checkout.session.completed",
    status: "processed",
    environment: "sandbox",
    error: null,
    subscription_id: null,
    customer_id: "cus_stripe_1",
    user_id: BILLING_IDS.me,
    occurred_at: isoPast(1),
    created_at: isoPast(1),
    processed_at: isoPast(1),
    duration_ms: 120,
    retry_count: 0,
    last_retried_at: null,
    payload: { id: "evt_1SyntetyczneZdarzenie", type: "checkout.session.completed" },
    ...overrides,
  };
}

/** Kształt wiersza dziennika czytany przez panel (podzbiór kolumn tabeli). */
export interface WebhookEventRow {
  id: string;
  event_id: string;
  event_type: string;
  status: string;
  environment: string;
  error: string | null;
  subscription_id: string | null;
  customer_id: string | null;
  user_id: string | null;
  occurred_at: string | null;
  created_at: string;
  processed_at: string | null;
  duration_ms: number | null;
  retry_count: number;
  last_retried_at: string | null;
  payload: unknown;
}

// --- atrapa operatora płatności ---------------------------------------------

export interface StripeStub {
  /** Wywołania per metoda - test pyta, CZY i Z CZYM poszło żądanie. */
  readonly calls: { method: string; args: unknown[] }[];
  billingPortal: { sessions: { create: Mock } };
  invoices: { retrieve: Mock };
  checkout: { sessions: { retrieve: Mock } };
  paymentIntents: { retrieve: Mock };
  subscriptions: { update: Mock; retrieve: Mock };
}

/**
 * Atrapa klienta Stripe. Istnieje po to, żeby ŻADEN test monetyzacji nie
 * wyszedł do sieci - także z kluczami testowymi. Domyślne odpowiedzi są
 * „szczęśliwą ścieżką"; test podmienia pojedynczą metodę przez
 * `stub.invoices.retrieve.mockResolvedValue(...)` albo `mockRejectedValue`.
 */
export function stripeStub(): StripeStub {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string, result: unknown) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return Promise.resolve(result);
    };

  return {
    calls,
    billingPortal: {
      sessions: {
        create: vi.fn(
          record("billingPortal.sessions.create", {
            url: "https://portal.example.test/session",
          }),
        ),
      },
    },
    invoices: {
      retrieve: vi.fn(
        record("invoices.retrieve", {
          hosted_invoice_url: "https://invoice.example.test/hosted",
          invoice_pdf: "https://invoice.example.test/pdf",
        }),
      ),
    },
    checkout: {
      sessions: {
        retrieve: vi.fn(
          record("checkout.sessions.retrieve", {
            invoice: "in_test_1",
            payment_intent: null,
          }),
        ),
      },
    },
    paymentIntents: {
      retrieve: vi.fn(
        record("paymentIntents.retrieve", {
          latest_charge: { receipt_url: "https://receipt.example.test/charge" },
        }),
      ),
    },
    subscriptions: {
      update: vi.fn(record("subscriptions.update", { id: "sub_stripe_1" })),
      retrieve: vi.fn(record("subscriptions.retrieve", { id: "sub_stripe_1" })),
    },
  };
}
