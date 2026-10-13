// CYKL ŻYCIA SUBSKRYPCJI PRZEZ CAŁY DYSPOZYTOR - kryteria zakończenia audytu
// rozliczeń SUB-02, SUB-03, SUB-14 (część mapowania) i SUB-16.
//
// DLACZEGO OSOBNY PLIK I PAMIĘCIOWA BAZA. Każde z tych znalezisk jest błędem
// KOLEJNOŚCI albo POWTÓRZENIA: spóźnione `created` po `updated`, druga dostawa
// tej samej próby obciążenia, dwa bliźniacze zdarzenia o jednej zapłacie
// przetwarzane naraz. Atrapa odpowiadająca stałym wynikiem nie umie tego
// pokazać - pokazuje to dopiero tabela, która PAMIĘTA zapis i stosuje filtry
// (`eq`, `is`, `gt`, `in`, `or(last_event_at.lt...)`, `ON CONFLICT DO
// NOTHING`) tak jak PostgREST. Warunkowy UPDATE wykonuje się w atrapie
// atomowo (jeden synchroniczny krok), jak w bazie.
//
// Zdarzenia przychodzą jako SUROWE obiekty Stripe i przechodzą przez
// `normalizeStripeEvent` - test pilnuje więc także mapowania (pauza poboru,
// powód anulowania, numer próby i termin kolejnej próby faktury).
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta Supabase, SDK operatora i wysyłkę
// poczty (oraz zapis dokumentu faktury, który ma własne testy). Uprawnienia,
// efekty zakupu, windykacja i plan Zespół biegną
// prawdziwym kodem. `grantsAccess` odtwarza warunek `has_content_access()` /
// `current_membership_tier()` na `user_subscriptions` (status `active` i
// `current_period_end` pusty albo w przyszłości).
//
// Zegar zamrożony (`freezeClock`), daty liczone względem „teraz". Adresy
// syntetyczne, identyfikatory operatora zmyślone.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TxSendInput } from "@/lib/email/transactional.server";
import type { VerifiedWebhookEvent } from "@/lib/stripe.server";
import {
  PREMIUM_NEWSLETTER_CONSENT_VERSION,
  premiumNewsletterConsentMetadata,
} from "@/lib/billing/premiumNewsletter";
import {
  BILLING_IDS,
  accessPlan,
  fail,
  ok,
  planLadder,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/billing/fixtures";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { DZIEN, FIXED_NOW, SEKUNDA, freezeClock, relativeIso } from "@/test/time";

const h = vi.hoisted(() => ({
  db: { current: null as { from: (table: string) => unknown } | null },
  rpc: {
    current: null as { rpc: (name: string, args?: Record<string, unknown>) => unknown } | null,
  },
  emails: [] as unknown[],
  sentKeys: new Set<string>(),
  /**
   * Klient operatora dla przypadków, które MAJĄ prawo go wołać (remis
   * znaczników rozstrzygany żywym stanem). Domyślnie pusty - każde inne
   * wywołanie operatora kończy test jawnym błędem.
   */
  stripe: {
    current: null as {
      subscriptions: { retrieve: StripeRetrieve };
      invoices?: { retrieve: (id: string) => Promise<unknown> };
    } | null,
    /** Środowiska, dla których poproszono o klienta operatora (sandbox nie czyta produkcji). */
    envs: [] as string[],
  },
}));

type StripeRetrieve = (id: string, params?: unknown) => Promise<unknown>;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
    rpc: (name: string, args?: Record<string, unknown>) => h.rpc.current!.rpc(name, args),
  },
}));

// `environmentGrantsAccess` zostaje PRAWDZIWE (czysta funkcja bramki PAY-05,
// poza produkcją oba środowiska nadają dostęp).
vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getConnectionApiKey: () => "test_klucz_atrapy",
  getWebhookSecret: () => "test_sekret_atrapy",
  getStripeClient: async (env: string) => {
    if (!h.stripe.current) throw new Error("test: żaden przypadek nie ma prawa wołać operatora");
    h.stripe.envs.push(env);
    return h.stripe.current;
  },
  getStripeErrorMessage: (error: unknown) => String(error),
  resolveEnvironment: () => "live",
}));

// Dokument rozliczeniowy faktury ma własne testy (`billingDocuments.server`)
// i jest fail-soft - tu jest tylko szumem obok windykacji, więc go wyłączamy.
vi.mock("@/lib/billing/billingDocuments.server", () => ({
  documentInputFromTransaction: () => null,
  recordTransactionDocument: async () => "skipped",
}));

// Poczta: formatowanie dat i kwot prawdziwe, wysyłka zapisana. Log wysyłek
// odsiewa powtórzony klucz idempotencji tak jak `email_send_log` - test
// liczy PRÓBY wysyłki, więc widzi także duplikaty, które log by połknął.
vi.mock("@/lib/email/transactional.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/transactional.server")>(
    "@/lib/email/transactional.server",
  );
  return {
    ...actual,
    sendTxEmail: (message: { idempotencyKey: string }) => {
      h.emails.push(message);
      if (h.sentKeys.has(message.idempotencyKey)) {
        return Promise.resolve({ ok: true, skipped: "duplicate" });
      }
      h.sentKeys.add(message.idempotencyKey);
      return Promise.resolve({ ok: true });
    },
  };
});

const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");
const { normalizeStripeEvent } = await import("@/lib/billing/stripeEvents.server");
const { suspendTeamsPastPaymentGrace } = await import("@/lib/organizations/teamSeats.server");
const { PAYMENT_GRACE_DAYS } = await import("@/lib/billing/accessPeriod");

freezeClock();

// --- pamięciowa baza --------------------------------------------------------

type Row = Record<string, unknown>;

function cmp(a: unknown, b: unknown): number {
  const ta = typeof a === "string" ? Date.parse(a) : Number.NaN;
  const tb = typeof b === "string" ? Date.parse(b) : Number.NaN;
  if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
  return Number(a) - Number(b);
}

/** Filtr `or(...)` PostgREST: `kol.is.null,kol.lt.wartość` (wartość może mieć kropki). */
function orMatches(row: Row, expression: string): boolean {
  return expression.split(",").some((condition) => {
    const [column = "", op, ...rest] = condition.split(".");
    const value = rest.join(".");
    if (op === "is" && value === "null") return row[column] == null;
    if (row[column] == null) return false;
    if (op === "lt") return cmp(row[column], value) < 0;
    if (op === "lte") return cmp(row[column], value) <= 0;
    throw new Error(`test: nieobsługiwany warunek or(${condition})`);
  });
}

function matches(row: Row, chain: RecordedChain): boolean {
  return chain.calls.every(({ method, args }) => {
    const column = String(args[0]);
    switch (method) {
      case "eq":
        return row[column] === args[1];
      // `neq` (zapis uprawnienia omija `refunded`) i porównania czasu (próg
      // deduplikacji dzwonka `gte created_at`) - jak PostgREST.
      case "neq":
        return row[column] !== args[1];
      case "gte":
        return row[column] != null && cmp(row[column], args[1]) >= 0;
      case "lt":
        return row[column] != null && cmp(row[column], args[1]) < 0;
      case "is":
        return args[1] === null ? row[column] == null : row[column] === args[1];
      case "gt":
        return row[column] != null && cmp(row[column], args[1]) > 0;
      case "in":
        return (args[1] as unknown[]).includes(row[column]);
      case "not":
        return args[1] === "is" && args[2] === null ? row[column] != null : true;
      case "or":
        return orMatches(row, column);
      case "ilike":
        return false;
      default:
        return true;
    }
  });
}

let nextId = 1;

/** Wartości domyślne kolumn `subscriptions` (jak w bazie po migracjach). */
const SUBSCRIPTION_DEFAULTS: Row = {
  payment_failure_count: 0,
  last_dunning_transaction_id: null,
  last_payment_at: null,
  last_payment_failed_at: null,
  first_payment_failed_at: null,
  purchase_confirmed_at: null,
  last_event_at: null,
  tenant_id: BILLING_IDS.tenant,
};

/** Tabela, która pamięta zapisy i stosuje filtry łańcucha - jak PostgREST. */
function table(rows: Row[], defaults: Row = {}) {
  return (chain: RecordedChain): SupabaseResult => {
    const returning = chain.has("select");
    if (chain.has("upsert")) {
      const [row, options] = chain.argsOf("upsert") as [
        Row,
        { onConflict?: string; ignoreDuplicates?: boolean },
      ];
      const keys = (options?.onConflict ?? "id").split(",");
      const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
      if (existing) {
        // ON CONFLICT DO NOTHING - RETURNING oddaje zero wierszy.
        if (options?.ignoreDuplicates) return ok(returning ? [] : null);
        Object.assign(existing, row);
        return ok(returning ? [{ id: existing.id }] : null);
      }
      const inserted = { id: `row-${nextId++}`, ...defaults, ...row };
      rows.push(inserted);
      return ok(returning ? [{ id: inserted.id }] : null);
    }
    if (chain.has("insert")) {
      const inserted = {
        id: `row-${nextId++}`,
        ...defaults,
        ...(chain.argsOf("insert")?.[0] as Row),
      };
      rows.push(inserted);
      return ok(null);
    }
    if (chain.has("update")) {
      const patch = chain.argsOf("update")?.[0] as Row;
      const hit = rows.filter((r) => matches(r, chain));
      for (const r of hit) Object.assign(r, patch);
      return ok(returning ? hit.map((r) => ({ id: r.id })) : null);
    }
    const hit = rows.filter((r) => matches(r, chain)).map((r) => ({ ...r }));
    if (chain.has("maybeSingle") || chain.has("single")) return ok(hit[0] ?? null);
    return ok(hit);
  };
}

const SUB = "sub_1SyntetycznyCykl";
const CUSTOMER = "cus_1SyntetycznyCykl";
const ORG = "org-zespol-1";

let db: SupabaseFromStub;
let rpc: SupabaseRpcStub;
let subscriptions: Row[];
let entitlements: Row[];
let notifications: Row[];
let organizations: Row[];

beforeEach(() => {
  h.emails.length = 0;
  h.sentKeys.clear();
  subscriptions = [];
  entitlements = [];
  notifications = [];
  organizations = [];
  db = supabaseFromStub();
  rpc = supabaseRpcStub();
  h.db.current = db;
  h.rpc.current = rpc;
  rpc.setData("org_apply_subscription_seats", { linked: false });
  rpc.setData("email_filter_suppressed", []);

  h.stripe.current = null;
  h.stripe.envs.length = 0;
  db.setResponse("subscriptions", table(subscriptions, SUBSCRIPTION_DEFAULTS));
  db.setResponse("user_subscriptions", table(entitlements));
  db.setResponse("notifications", table(notifications));
  db.setResponse("member_organizations", table(organizations));
  db.setResponse("crm_leads", table([]));
  db.setResponse("newsletter_subscribers", table([]));
  db.setResponse("billing_documents", table([]));
  db.setResponse("payment_orders", table([]));
  db.setResponse(
    "access_plans",
    table([
      ...planLadder(),
      accessPlan({
        id: "plan-member-annual",
        interval: "year",
        price_cents: 49900,
        sort_order: 31,
      }),
      accessPlan({ id: "plan-team-monthly", tier_key: "team", price_cents: 19900, sort_order: 50 }),
    ] as unknown as Row[]),
  );
  db.setResponse(
    "profiles",
    table([
      {
        id: BILLING_IDS.me,
        email: "subskrybentka@example.com",
        first_name: "Anna",
        last_name: null,
        display_name: null,
        tenant_id: BILLING_IDS.tenant,
        prefs: { language: "pl" },
      },
    ]),
  );
});

// --- zdarzenia operatora ------------------------------------------------------

const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

interface SubOpts {
  status: string;
  priceKey?: string;
  periodStart: string;
  periodEnd: string;
  cancelAtPeriodEnd?: boolean;
  cancellationReason?: string;
  pauseCollection?: { behavior: string } | null;
  /** Dodatkowe metadane subskrypcji (np. zgoda z checkoutu, SUB-15). */
  metadata?: Record<string, string>;
  /** Identyfikator ceny operatora (`price_...`) - domyślnie wspólna atrapa. */
  providerPriceId?: string;
  /** Harmonogram dołączony do subskrypcji (identyfikator, jak w ładunku zdarzenia). */
  schedule?: string | null;
}

function stripeSubscription(o: SubOpts): Record<string, unknown> {
  return {
    id: SUB,
    customer: CUSTOMER,
    status: o.status,
    cancel_at_period_end: o.cancelAtPeriodEnd ?? false,
    cancellation_details: o.cancellationReason ? { reason: o.cancellationReason } : null,
    pause_collection: o.pauseCollection ?? null,
    metadata: { userId: BILLING_IDS.me, ...o.metadata },
    ...(o.schedule !== undefined ? { schedule: o.schedule } : {}),
    items: {
      data: [
        {
          quantity: 1,
          current_period_start: unix(o.periodStart),
          current_period_end: unix(o.periodEnd),
          price: {
            id: o.providerPriceId ?? "price_atrapa",
            lookup_key: o.priceKey ?? "plus_monthly",
            product: { id: "prod_atrapa", metadata: { lovable_external_id: "plan_plus" } },
          },
        },
      ],
    },
  };
}

interface InvoiceOpts {
  id?: string;
  attempt: number;
  nextAttempt?: string | null;
  amount?: number;
  /** `invoice.billing_reason` - odnowienie (`subscription_cycle`) albo dopłata za zmianę. */
  billingReason?: string;
}

function stripeInvoice(o: InvoiceOpts): Record<string, unknown> {
  return {
    id: o.id ?? "in_1SyntetycznaFaktura",
    customer: CUSTOMER,
    currency: "pln",
    total: o.amount ?? 4900,
    amount_paid: 0,
    attempt_count: o.attempt,
    next_payment_attempt: o.nextAttempt ? unix(o.nextAttempt) : null,
    billing_reason: o.billingReason ?? null,
    parent: { subscription_details: { subscription: SUB, metadata: {} } },
    lines: { data: [] },
  };
}

/**
 * Identyfikator zdarzenia operatora: ta sama treść, typ i chwila = TO SAMO
 * zdarzenie (ponowna dostawa, ponowienie z panelu), inna treść w tej samej
 * sekundzie = INNE zdarzenie. Trasa podaje dyspozytorowi `event.id`, a po
 * scaleniu z PAY-02 strażnik rozpoznaje po nim powtórkę (`replay`) - bez
 * identyfikatora każda powtórka byłaby remisem rozstrzyganym u operatora.
 */
function eventId(type: string, object: Record<string, unknown>, at: string): string {
  let hash = 0;
  for (const char of JSON.stringify(object)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `evt_${type}_${at}_${(hash >>> 0).toString(36)}`;
}

/** Surowe zdarzenie Stripe -> normalizacja -> dyspozytor (jak trasa HTTP). */
async function deliver(type: string, object: Record<string, unknown>, at: string) {
  const event = { id: eventId(type, object, at), type, created: unix(at), data: { object } };
  const normalized = normalizeStripeEvent(event as unknown as VerifiedWebhookEvent);
  if (!normalized) throw new Error(`test: zdarzenie ${type} poza zakresem integracji`);
  return dispatchWebhookEvent({
    eventId: event.id,
    eventType: normalized.eventType,
    data: normalized.data,
    environment: "live",
    occurredAt: new Date(event.created * 1000).toISOString(),
  });
}

// --- odczyty stanu -------------------------------------------------------------

const subscriptionRow = (): Row | undefined =>
  subscriptions.find((r) => r.provider_subscription_id === SUB);
const entitlement = (): Row | undefined => entitlements.find((r) => r.external_ref === SUB);

/** Warunek `has_content_access()` na wierszu `user_subscriptions`. */
function grantsAccess(row: Row | undefined, now: Date = FIXED_NOW): boolean {
  if (!row || row.status !== "active") return false;
  const end = row.current_period_end;
  return end == null || Date.parse(String(end)) > now.getTime();
}

const mails = (type: string): TxSendInput[] =>
  (h.emails as TxSendInput[]).filter((mail) => mail.type === type);
const bells = (title: string): Row[] => notifications.filter((n) => n.title_pl === title);
const crmWrites = (): RecordedChain[] =>
  db.chainsFor("crm_leads").filter((c) => c.has("insert") || c.has("update"));
const newsletterWrites = (): RecordedChain[] =>
  db.chainsFor("newsletter_subscribers").filter((c) => c.has("upsert"));

// =============================================================================

describe("SUB-02: created pod strażnikiem kolejności, potwierdzenie dopiero po zapłacie", () => {
  it("updated(active), potem SPÓŹNIONE created(incomplete): status, znacznik i dostęp zostają", async () => {
    const created = relativeIso(-10 * DZIEN);
    const activated = relativeIso(-10 * DZIEN + 5 * SEKUNDA);
    const period = { periodStart: created, periodEnd: relativeIso(20 * DZIEN) };

    await deliver(
      "customer.subscription.updated",
      stripeSubscription({ status: "active", ...period }),
      activated,
    );
    // Po scaleniu z PAY-02 spóźnione zdarzenie (`stale`) nie stosuje ładunku,
    // ale WYRÓWNUJE uprawnienie żywym stanem operatora (jego wcześniejsza próba
    // mogła zapisać uprawnienie i paść) - stąd odczyt i `processed` zamiast
    // `skipped`. Ładunek `incomplete` niczego nie cofa.
    const retrieve = stripeLive(() => stripeSubscription({ status: "active", ...period }));
    const outcome = await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "incomplete", ...period }),
      created,
    );

    expect(outcome).toBe("processed");
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(subscriptionRow()).toMatchObject({ status: "active", last_event_at: activated });
    expect(grantsAccess(entitlement())).toBe(true);
    // Zakup potwierdzony raz - przy aktywacji, a nie drugi raz przy `created`.
    expect(mails("subscription_confirmed")).toHaveLength(1);
    expect(bells("Subskrypcja aktywna")).toHaveLength(1);
  });

  it("created(incomplete): bez maila, CRM, newslettera i dzwonka - i bez dostępu", async () => {
    const at = relativeIso(-1 * DZIEN);
    await deliver(
      "customer.subscription.created",
      stripeSubscription({
        status: "incomplete",
        periodStart: at,
        periodEnd: relativeIso(29 * DZIEN),
      }),
      at,
    );

    expect(subscriptionRow()).toMatchObject({ status: "incomplete", purchase_confirmed_at: null });
    expect(grantsAccess(entitlement())).toBe(false);
    expect(h.emails).toHaveLength(0);
    expect(crmWrites()).toHaveLength(0);
    expect(newsletterWrites()).toHaveLength(0);
    expect(notifications).toHaveLength(0);
  });

  it("created(incomplete) -> updated(active) W TEJ SAMEJ SEKUNDZIE: efekty zakupu dokładnie raz", async () => {
    // Stripe stempluje zdarzenia z dokładnością do sekundy, a 3DS w checkout
    // zamyka się zwykle w tej samej sekundzie co `created`. Przy równych
    // znacznikach strażnik odrzucał `updated` - płacący zostawał bez dostępu.
    const at = relativeIso(-2 * DZIEN);
    // Zgoda na newsletter z checkoutu (SUB-15) siedzi w metadanych subskrypcji,
    // więc niesie ją KAŻDE zdarzenie - zapis listy ma być jeden, przy aktywacji.
    const period = {
      periodStart: at,
      periodEnd: relativeIso(28 * DZIEN),
      metadata: premiumNewsletterConsentMetadata({
        version: PREMIUM_NEWSLETTER_CONSENT_VERSION,
        lang: "pl",
        at: relativeIso(-2 * DZIEN - 2 * SEKUNDA),
      }),
    };

    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "incomplete", ...period }),
      at,
    );
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({ status: "active", ...period }),
      at,
    );
    // Ponowienie tej samej aktywacji (panel admina) i kolejna zmiana stanu.
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({ status: "active", ...period }),
      at,
    );
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({ status: "active", ...period }),
      relativeIso(-1 * DZIEN),
    );

    expect(subscriptionRow()?.status).toBe("active");
    expect(subscriptionRow()?.purchase_confirmed_at).toBeTruthy();
    expect(grantsAccess(entitlement())).toBe(true);
    expect(mails("subscription_confirmed")).toHaveLength(1);
    expect(bells("Subskrypcja aktywna")).toHaveLength(1);
    expect(db.chainsFor("crm_leads").filter((c) => c.has("insert"))).toHaveLength(1);
    expect(newsletterWrites()).toHaveLength(1);
  });

  it("porzucone 3DS (incomplete -> incomplete_expired): żadnego potwierdzenia ani dostępu", async () => {
    const at = relativeIso(-3 * DZIEN);
    const period = { periodStart: at, periodEnd: relativeIso(27 * DZIEN) };

    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "incomplete", ...period }),
      at,
    );
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({ status: "incomplete_expired", ...period }),
      relativeIso(-2 * DZIEN),
    );

    expect(subscriptionRow()?.status).toBe("incomplete_expired");
    expect(grantsAccess(entitlement())).toBe(false);
    expect(h.emails).toHaveLength(0);
    expect(crmWrites()).toHaveLength(0);
    expect(newsletterWrites()).toHaveLength(0);
    expect(notifications).toHaveLength(0);
  });

  it("created(active), którego zapis uprawnienia padł: ponowienie nadaje dostęp i potwierdza raz", async () => {
    // Operator ponawia zdarzenie, które padło - z TYM SAMYM znacznikiem.
    // Strażnik zajął je przed obsługą, więc bez zwolnienia zajęcia ponowienie
    // kończyło się `skipped`: płatność pobrana, uprawnienia brak.
    const entitlementTable = table(entitlements);
    let failNextInsert = true;
    db.setResponse("user_subscriptions", (chain) => {
      if (failNextInsert && chain.has("insert")) {
        failNextInsert = false;
        return fail("could not serialize access", "40001");
      }
      return entitlementTable(chain);
    });
    const at = relativeIso(-1 * DZIEN);
    const object = stripeSubscription({
      status: "active",
      periodStart: at,
      periodEnd: relativeIso(29 * DZIEN),
    });

    await expect(deliver("customer.subscription.created", object, at)).rejects.toThrow(
      /entitlement sync: insert failed/,
    );
    expect(mails("subscription_confirmed")).toHaveLength(0);
    // Po scaleniu z PAY-02 (1.2) skutki założenia idą PRZED wstawieniem
    // wiersza: porażka zostawia „brak wiersza", więc ponowienie znów idzie
    // ścieżką zakładania - potwierdzenie zakupu nie ma czego zużyć.
    expect(subscriptionRow()).toBeUndefined();

    expect(await deliver("customer.subscription.created", object, at)).toBe("processed");
    expect(grantsAccess(entitlement())).toBe(true);
    expect(mails("subscription_confirmed")).toHaveLength(1);
    expect(bells("Subskrypcja aktywna")).toHaveLength(1);

    // Powtórka po sukcesie niczego nie dubluje. Strażnik rozpoznaje TO SAMO
    // zdarzenie po identyfikatorze (`replay`) i przechodzi obsługę jeszcze raz
    // (idempotentnie) - stąd `processed`, ale potwierdzenie jest już zajęte.
    expect(await deliver("customer.subscription.created", object, at)).toBe("processed");
    expect(mails("subscription_confirmed")).toHaveLength(1);
    expect(bells("Subskrypcja aktywna")).toHaveLength(1);
  });

  it("zdarzenie stanu, którego obsługa padła, przechodzi przy ponowieniu", async () => {
    const start = relativeIso(-10 * DZIEN);
    const period = { periodStart: start, periodEnd: relativeIso(20 * DZIEN) };
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "active", ...period }),
      start,
    );
    const entitlementTable = table(entitlements);
    let failNextUpdate = true;
    db.setResponse("user_subscriptions", (chain) => {
      if (failNextUpdate && chain.has("update")) {
        failNextUpdate = false;
        return fail("could not serialize access", "40001");
      }
      return entitlementTable(chain);
    });
    const pausedAt = relativeIso(-1 * DZIEN);
    const paused = stripeSubscription({ status: "paused", ...period });

    await expect(deliver("customer.subscription.updated", paused, pausedAt)).rejects.toThrow();
    expect(await deliver("customer.subscription.updated", paused, pausedAt)).toBe("processed");

    expect(subscriptionRow()).toMatchObject({ status: "paused", last_event_at: pausedAt });
    expect(grantsAccess(entitlement())).toBe(false);
  });

  it("created(active) dostarczone dwa razy: jedno potwierdzenie i jeden dzwonek", async () => {
    const at = relativeIso(-1 * DZIEN);
    const object = stripeSubscription({
      status: "active",
      periodStart: at,
      periodEnd: relativeIso(29 * DZIEN),
    });

    expect(await deliver("customer.subscription.created", object, at)).toBe("processed");
    // Druga dostawa to `replay` (ten sam identyfikator zdarzenia, PAY-02):
    // obsługa biegnie jeszcze raz, idempotentnie - `processed`, bez duplikatów.
    expect(await deliver("customer.subscription.created", object, at)).toBe("processed");

    expect(subscriptions).toHaveLength(1);
    expect(mails("subscription_confirmed")).toHaveLength(1);
    expect(bells("Subskrypcja aktywna")).toHaveLength(1);
  });
});

describe("SUB-03: dostęp tylko za opłacony okres - karencja od pierwszej porażki", () => {
  /** Roczna subskrypcja opłacona rok temu; odnowienie `renewalAt` się nie udaje. */
  async function annualRenewalFails(renewalAt: string) {
    const yearAgo = new Date(Date.parse(renewalAt) - 365 * DZIEN).toISOString();
    const nextYear = new Date(Date.parse(renewalAt) + 365 * DZIEN).toISOString();
    await deliver(
      "customer.subscription.created",
      stripeSubscription({
        status: "active",
        priceKey: "plus_annual",
        periodStart: yearAgo,
        periodEnd: renewalAt,
      }),
      yearAgo,
    );
    // Stripe przesuwa okres o rok ZANIM obciąży kartę - i obciążenie pada.
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({
        status: "past_due",
        priceKey: "plus_annual",
        periodStart: renewalAt,
        periodEnd: nextYear,
      }),
      renewalAt,
    );
    await deliver("invoice.payment_failed", stripeInvoice({ attempt: 1 }), renewalAt);
    return { nextYear };
  }

  it("roczne past_due: dostęp do pierwszej porażki + karencja, nie do końca nowego roku", async () => {
    const renewalAt = relativeIso(-3 * DZIEN);
    const { nextYear } = await annualRenewalFails(renewalAt);
    const graceEnd = new Date(Date.parse(renewalAt) + PAYMENT_GRACE_DAYS * DZIEN).toISOString();

    expect(subscriptionRow()).toMatchObject({
      status: "past_due",
      current_period_end: nextYear,
      first_payment_failed_at: renewalAt,
    });
    expect(entitlement()?.current_period_end).toBe(graceEnd);
    expect(grantsAccess(entitlement())).toBe(true);
    // Uprawnienie gaśnie SAMO po karencji - bez kolejnego zdarzenia operatora.
    expect(grantsAccess(entitlement(), new Date(Date.parse(graceEnd) + SEKUNDA))).toBe(false);
  });

  it("roczne past_due -> deleted(payment_failed) po karencji: koniec dostępu po karencji", async () => {
    const renewalAt = relativeIso(-21 * DZIEN);
    const { nextYear } = await annualRenewalFails(renewalAt);

    await deliver(
      "customer.subscription.deleted",
      stripeSubscription({
        status: "canceled",
        priceKey: "plus_annual",
        periodStart: renewalAt,
        periodEnd: nextYear,
        cancellationReason: "payment_failed",
      }),
      relativeIso(-1 * DZIEN),
    );

    const graceEnd = new Date(Date.parse(renewalAt) + PAYMENT_GRACE_DAYS * DZIEN).toISOString();
    expect(entitlement()).toMatchObject({ status: "canceled", current_period_end: graceEnd });
    expect(grantsAccess(entitlement())).toBe(false);
  });

  it("deleted(payment_failed) w trakcie karencji: dostęp do końca karencji, nie do końca roku", async () => {
    const renewalAt = relativeIso(-5 * DZIEN);
    const { nextYear } = await annualRenewalFails(renewalAt);

    await deliver(
      "customer.subscription.deleted",
      stripeSubscription({
        status: "canceled",
        priceKey: "plus_annual",
        periodStart: renewalAt,
        periodEnd: nextYear,
        cancellationReason: "payment_disputed",
      }),
      relativeIso(-1 * DZIEN),
    );

    const graceEnd = new Date(Date.parse(renewalAt) + PAYMENT_GRACE_DAYS * DZIEN).toISOString();
    expect(entitlement()).toMatchObject({ status: "active", current_period_end: graceEnd });
    expect(grantsAccess(entitlement())).toBe(true);
    expect(grantsAccess(entitlement(), new Date(Date.parse(graceEnd) + SEKUNDA))).toBe(false);
  });

  it("rezygnacja klienta zostawia dostęp do końca OPŁACONEGO okresu", async () => {
    const start = relativeIso(-10 * DZIEN);
    const end = relativeIso(20 * DZIEN);
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "active", periodStart: start, periodEnd: end }),
      start,
    );

    await deliver(
      "customer.subscription.deleted",
      stripeSubscription({
        status: "canceled",
        periodStart: start,
        periodEnd: end,
        cancellationReason: "cancellation_requested",
      }),
      relativeIso(-1 * DZIEN),
    );

    expect(entitlement()).toMatchObject({ status: "active", current_period_end: end });
  });

  it("deleted BEZ powodu po windykacji (stara wersja API): karencja z kotwicy, nie koniec roku", async () => {
    // Kotwica w wierszu i brak zapłaty za nowy okres = koniec windykacji -
    // ten sam sygnał, po którym dobowy przebieg zespołów rozpoznaje anulowanie.
    const renewalAt = relativeIso(-5 * DZIEN);
    const { nextYear } = await annualRenewalFails(renewalAt);

    await deliver(
      "customer.subscription.deleted",
      stripeSubscription({
        status: "canceled",
        priceKey: "plus_annual",
        periodStart: renewalAt,
        periodEnd: nextYear,
      }),
      relativeIso(-1 * DZIEN),
    );

    const graceEnd = new Date(Date.parse(renewalAt) + PAYMENT_GRACE_DAYS * DZIEN).toISOString();
    expect(entitlement()).toMatchObject({ status: "active", current_period_end: graceEnd });
    expect(grantsAccess(entitlement(), new Date(Date.parse(graceEnd) + SEKUNDA))).toBe(false);
  });

  it("spóźnione zdarzenie po deleted BEZ powodu: wyrównanie stanem z API trzyma tę samą karencję", async () => {
    // Wyrównanie po wyparciu (`resyncFromProvider`) liczy dostęp tą samą
    // regułą co rezygnacja: anulowanie bez powodu z kotwicą i bez zapłaty za
    // okres to koniec windykacji, a nie rezygnacja do końca nieopłaconego roku.
    const renewalAt = relativeIso(-5 * DZIEN);
    const { nextYear } = await annualRenewalFails(renewalAt);
    const annual = { priceKey: "plus_annual", periodStart: renewalAt, periodEnd: nextYear };
    const canceled = stripeSubscription({ status: "canceled", ...annual });
    await deliver("customer.subscription.deleted", canceled, relativeIso(-1 * DZIEN));
    const graceEnd = new Date(Date.parse(renewalAt) + PAYMENT_GRACE_DAYS * DZIEN).toISOString();
    expect(entitlement()).toMatchObject({ status: "active", current_period_end: graceEnd });

    // Spóźnione `updated(past_due)` sprzed rezygnacji: ładunku nie stosuje,
    // a stan z API to anulowanie, któremu operator nie podał powodu.
    const retrieve = stripeLive(() => canceled);
    expect(
      await deliver(
        "customer.subscription.updated",
        stripeSubscription({ status: "past_due", ...annual }),
        relativeIso(-2 * DZIEN),
      ),
    ).toBe("processed");

    expect(retrieve).toHaveBeenCalled();
    expect(subscriptionRow()?.status).toBe("canceled");
    expect(entitlement()).toMatchObject({ status: "active", current_period_end: graceEnd });
  });

  it("przycięcie z uzgodnienia dawnych anulowań (dowód z faktury) przetrwa ponowne deleted bez powodu, a zapłata je znosi", async () => {
    // Stan sprzed reguły karencji: odnowienie roczne przesunęło okres, a
    // anulowanie bez powodu dało dostęp do końca nowego, nieopłaconego roku -
    // bez kotwicy w wierszu.
    const renewalAt = relativeIso(-5 * DZIEN);
    const yearAgo = new Date(Date.parse(renewalAt) - 365 * DZIEN).toISOString();
    const nextYear = new Date(Date.parse(renewalAt) + 365 * DZIEN).toISOString();
    const annual = { priceKey: "plus_annual", periodStart: renewalAt, periodEnd: nextYear };
    await deliver(
      "customer.subscription.created",
      stripeSubscription({
        status: "active",
        priceKey: "plus_annual",
        periodStart: yearAgo,
        periodEnd: renewalAt,
      }),
      yearAgo,
    );
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({ status: "active", ...annual }),
      renewalAt,
    );
    const legacyCancel = stripeSubscription({ status: "canceled", ...annual });
    await deliver("customer.subscription.deleted", legacyCancel, relativeIso(-3 * DZIEN));
    expect(subscriptionRow()?.first_payment_failed_at).toBeNull();
    expect(entitlement()?.current_period_end).toBe(nextYear);

    // Uzgodnienie: operator nie podał powodu, ostatnia faktura otwarta po
    // czterech nieudanych próbach - kotwica z pierwszej próby, dostęp do
    // kotwicy + karencja.
    const firstAttempt = new Date(Date.parse(renewalAt) + 60 * 60 * SEKUNDA).toISOString();
    // Historia opłaconych faktur okresu - pusta: odnowienie nieopłacone.
    const listInvoices = vi.fn((_params: Record<string, unknown>) => ({
      async *[Symbol.asyncIterator]() {},
    }));
    h.stripe.current = {
      invoices: { list: listInvoices },
      subscriptions: {
        retrieve: async () => ({
          ...legacyCancel,
          ended_at: unix(relativeIso(-3 * DZIEN)),
          latest_invoice: {
            id: "in_1SyntetycznaFaktura",
            status: "open",
            attempt_count: 4,
            amount_due: 49900,
            amount_paid: 0,
            billing_reason: "subscription_cycle",
            created: unix(renewalAt),
            status_transitions: { finalized_at: unix(firstAttempt), paid_at: null },
          },
        }),
      },
    } as unknown as typeof h.stripe.current;
    const { reconcileLegacyNonPaymentCancellations } =
      await import("@/lib/billing/legacyNonPaymentReconcile.server");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const report = await reconcileLegacyNonPaymentCancellations({
      environment: "live",
      mode: "apply",
    });
    const graceEnd = new Date(Date.parse(firstAttempt) + PAYMENT_GRACE_DAYS * DZIEN).toISOString();
    expect(report.rows[0]).toMatchObject({ decision: "clamp", evidence: "invoice", applied: true });
    expect(listInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ subscription: SUB, status: "paid" }),
    );
    expect(subscriptionRow()?.first_payment_failed_at).toBe(firstAttempt);
    expect(entitlement()).toMatchObject({ status: "active", current_period_end: graceEnd });

    // Klient klika „synchronizuj rozliczenia": syntetyczne deleted (bez
    // powodu) z czasem „teraz" przechodzi strażnika i trafia do rezygnacji.
    const resync = () =>
      deliver("customer.subscription.deleted", legacyCancel, relativeIso(-2 * SEKUNDA));
    expect(await resync()).toBe("processed");
    expect(entitlement()).toMatchObject({ status: "active", current_period_end: graceEnd });

    // Zaległa faktura zapłacona po anulowaniu: okres opłacony, więc kolejna
    // synchronizacja liczy dostęp jak po rezygnacji - do końca okresu.
    await deliver("invoice.paid", stripeInvoice({ attempt: 4 }), relativeIso(-1 * SEKUNDA));
    await deliver("customer.subscription.deleted", legacyCancel, FIXED_NOW.toISOString());
    expect(entitlement()).toMatchObject({ status: "active", current_period_end: nextYear });
  });

  it("przycięcie dawnego wiersza ze znacznikiem zapłaty z DOPŁATY przetrwa synchronizację klienta (Codex P1, PR #502)", async () => {
    // Dawna windykacja (porażka odnowienia zgubiona, licznik 0) zapisała
    // `last_payment_at` z opłaconej dopłaty za upgrade - w bieżącym okresie.
    // Z tym znacznikiem webhook uznawał okres za opłacony
    // (`paymentCoversPeriod`), więc pierwsze `deleted` bez powodu po
    // przycięciu oddawało rok nieopłaconego dostępu.
    const renewalAt = relativeIso(-5 * DZIEN);
    const yearAgo = new Date(Date.parse(renewalAt) - 365 * DZIEN).toISOString();
    const nextYear = new Date(Date.parse(renewalAt) + 365 * DZIEN).toISOString();
    const annual = { priceKey: "plus_annual", periodStart: renewalAt, periodEnd: nextYear };
    await deliver(
      "customer.subscription.created",
      stripeSubscription({
        status: "active",
        priceKey: "plus_annual",
        periodStart: yearAgo,
        periodEnd: renewalAt,
      }),
      yearAgo,
    );
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({ status: "active", ...annual }),
      renewalAt,
    );
    const prorationPaidAt = relativeIso(-4 * DZIEN);
    const row = subscriptionRow();
    if (row) row.last_payment_at = prorationPaidAt;
    const legacyCancel = stripeSubscription({ status: "canceled", ...annual });
    await deliver("customer.subscription.deleted", legacyCancel, relativeIso(-3 * DZIEN));
    expect(entitlement()?.current_period_end).toBe(nextYear);

    // Operator: odnowienie otwarte po czterech próbach, a w historii okresu
    // opłacona jest wyłącznie dopłata (same proraty).
    const firstAttempt = new Date(Date.parse(renewalAt) + 60 * 60 * SEKUNDA).toISOString();
    const paidProration = {
      id: "in_1SyntetycznaDoplata",
      status: "paid",
      attempt_count: 1,
      amount_due: 2500,
      amount_paid: 2500,
      billing_reason: "subscription_update",
      created: unix(prorationPaidAt),
      status_transitions: { finalized_at: unix(prorationPaidAt), paid_at: unix(prorationPaidAt) },
      lines: {
        data: [
          {
            period: { start: unix(prorationPaidAt), end: unix(nextYear) },
            parent: {
              type: "subscription_item_details",
              subscription_item_details: { proration: true, invoice_item: "ii_1Syntetyczna" },
            },
          },
        ],
      },
    };
    h.stripe.current = {
      invoices: {
        list: () => ({
          async *[Symbol.asyncIterator]() {
            yield paidProration;
          },
        }),
      },
      subscriptions: {
        retrieve: async () => ({
          ...legacyCancel,
          ended_at: unix(relativeIso(-3 * DZIEN)),
          latest_invoice: {
            id: "in_1SyntetycznaFaktura",
            status: "open",
            attempt_count: 4,
            amount_due: 49900,
            amount_paid: 0,
            billing_reason: "subscription_cycle",
            created: unix(renewalAt),
            status_transitions: { finalized_at: unix(firstAttempt), paid_at: null },
          },
        }),
      },
    } as unknown as typeof h.stripe.current;
    const { reconcileLegacyNonPaymentCancellations } =
      await import("@/lib/billing/legacyNonPaymentReconcile.server");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const report = await reconcileLegacyNonPaymentCancellations({
      environment: "live",
      mode: "apply",
    });
    const graceEnd = new Date(Date.parse(firstAttempt) + PAYMENT_GRACE_DAYS * DZIEN).toISOString();
    expect(report.rows[0]).toMatchObject({ decision: "clamp", evidence: "invoice", applied: true });
    expect(report.writes).toMatchObject({ anchors: 1, paymentMarkers: 1, entitlements: 1 });
    expect(subscriptionRow()).toMatchObject({
      first_payment_failed_at: firstAttempt,
      last_payment_at: null,
    });
    expect(entitlement()).toMatchObject({ status: "active", current_period_end: graceEnd });

    // Klient klika „synchronizuj rozliczenia": syntetyczne deleted bez powodu
    // z czasem „teraz" - przycięcie zostaje.
    expect(
      await deliver("customer.subscription.deleted", legacyCancel, relativeIso(-2 * SEKUNDA)),
    ).toBe("processed");
    expect(entitlement()).toMatchObject({ status: "active", current_period_end: graceEnd });

    // Prawdziwa zapłata odnowienia po anulowaniu nadal przywraca okres.
    await deliver(
      "invoice.paid",
      stripeInvoice({ attempt: 4, billingReason: "subscription_cycle" }),
      relativeIso(-1 * SEKUNDA),
    );
    await deliver("customer.subscription.deleted", legacyCancel, FIXED_NOW.toISOString());
    expect(entitlement()).toMatchObject({ status: "active", current_period_end: nextYear });
  });

  it("odzyskanie płatności zamyka cykl: kotwica karencji gaśnie, dostęp wraca na pełny okres", async () => {
    const renewalAt = relativeIso(-4 * DZIEN);
    const { nextYear } = await annualRenewalFails(renewalAt);

    await deliver("invoice.paid", stripeInvoice({ attempt: 2 }), relativeIso(-2 * DZIEN));
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({
        status: "active",
        priceKey: "plus_annual",
        periodStart: renewalAt,
        periodEnd: nextYear,
      }),
      relativeIso(-2 * DZIEN),
    );

    expect(subscriptionRow()).toMatchObject({
      status: "active",
      first_payment_failed_at: null,
      payment_failure_count: 0,
    });
    expect(entitlement()).toMatchObject({ status: "active", current_period_end: nextYear });
  });

  describe("plan Zespół - ta sama karencja co dla planu indywidualnego", () => {
    async function teamPastDue(failedAt: string) {
      organizations.push({
        id: ORG,
        provider_subscription_id: SUB,
        status: "active",
        tenant_id: BILLING_IDS.tenant,
      });
      const start = new Date(Date.parse(failedAt) - 30 * DZIEN).toISOString();
      await deliver(
        "customer.subscription.created",
        stripeSubscription({
          status: "active",
          priceKey: "team_monthly_seat",
          periodStart: start,
          periodEnd: failedAt,
        }),
        start,
      );
      await deliver(
        "customer.subscription.updated",
        stripeSubscription({
          status: "past_due",
          priceKey: "team_monthly_seat",
          periodStart: failedAt,
          periodEnd: new Date(Date.parse(failedAt) + 30 * DZIEN).toISOString(),
        }),
        failedAt,
      );
    }

    it("past_due w karencji zostawia zespołowi dostęp", async () => {
      await teamPastDue(relativeIso(-3 * DZIEN));
      expect(organizations[0]?.status).toBe("active");
    });

    it("past_due po karencji zawiesza zespół", async () => {
      await teamPastDue(relativeIso(-20 * DZIEN));
      expect(organizations[0]?.status).toBe("suspended");
    });

    it("dobowy przebieg zawiesza zespół, któremu karencja minęła BEZ kolejnego zdarzenia", async () => {
      await teamPastDue(relativeIso(-3 * DZIEN));
      expect(organizations[0]?.status).toBe("active");

      expect(await suspendTeamsPastPaymentGrace()).toEqual({ suspended: 0 });
      expect(organizations[0]?.status).toBe("active");

      const afterGrace = new Date(FIXED_NOW.getTime() + (PAYMENT_GRACE_DAYS - 2) * DZIEN);
      expect(await suspendTeamsPastPaymentGrace(afterGrace)).toEqual({ suspended: 1 });
      expect(organizations[0]?.status).toBe("suspended");
    });

    // Przegląd poprawek SUB-03 (#43). Ten przypadek przybijał wcześniej
    // „anulowanie za brak płatności zawiesza zespół" OD RAZU - czyli właśnie
    // rozjazd reguł: osoba z planem indywidualnym (i mail windykacji do
    // właściciela) miała dostęp do końca karencji, zespół tracił go w chwili
    // `deleted`. Teraz obie strony kończą dostęp z końcem tej samej karencji.
    it("anulowanie za brak płatności W KARENCJI: zespół do końca karencji, potem przebieg go zawiesza", async () => {
      const failedAt = relativeIso(-3 * DZIEN);
      await teamPastDue(failedAt);
      await deliver(
        "customer.subscription.deleted",
        stripeSubscription({
          status: "canceled",
          priceKey: "team_monthly_seat",
          periodStart: failedAt,
          periodEnd: relativeIso(27 * DZIEN),
          cancellationReason: "payment_failed",
        }),
        relativeIso(-1 * DZIEN),
      );
      expect(organizations[0]?.status).toBe("active");

      expect(await suspendTeamsPastPaymentGrace()).toEqual({ suspended: 0 });
      const afterGrace = new Date(Date.parse(failedAt) + PAYMENT_GRACE_DAYS * DZIEN + SEKUNDA);
      expect(await suspendTeamsPastPaymentGrace(afterGrace)).toEqual({ suspended: 1 });
      expect(organizations[0]?.status).toBe("suspended");
    });

    it("anulowanie za brak płatności PO karencji zawiesza zespół od razu", async () => {
      const failedAt = relativeIso(-20 * DZIEN);
      await teamPastDue(failedAt);
      // Przebieg dobowy nie zdążył - zrobi to samo zdarzenie końca windykacji.
      organizations[0]!.status = "active";
      await deliver(
        "customer.subscription.deleted",
        stripeSubscription({
          status: "canceled",
          priceKey: "team_monthly_seat",
          periodStart: failedAt,
          periodEnd: relativeIso(10 * DZIEN),
          cancellationReason: "payment_failed",
        }),
        relativeIso(-1 * DZIEN),
      );
      expect(organizations[0]?.status).toBe("suspended");
    });

    it("koniec windykacji bez zarejestrowanej porażki zapisuje kotwicę - przebieg domyka TĘ SAMĄ karencję", async () => {
      organizations.push({
        id: ORG,
        provider_subscription_id: SUB,
        status: "active",
        tenant_id: BILLING_IDS.tenant,
      });
      const renewedAt = relativeIso(-3 * DZIEN);
      await deliver(
        "customer.subscription.created",
        stripeSubscription({
          status: "active",
          priceKey: "team_monthly_seat",
          periodStart: renewedAt,
          periodEnd: relativeIso(27 * DZIEN),
        }),
        relativeIso(-33 * DZIEN),
      );
      // Zdarzenia windykacji zginęły - dociera tylko koniec windykacji.
      await deliver(
        "customer.subscription.deleted",
        stripeSubscription({
          status: "canceled",
          priceKey: "team_monthly_seat",
          periodStart: renewedAt,
          periodEnd: relativeIso(27 * DZIEN),
          cancellationReason: "payment_failed",
        }),
        relativeIso(-1 * DZIEN),
      );

      expect(organizations[0]?.status).toBe("active");
      expect(subscriptionRow()?.first_payment_failed_at).toBe(renewedAt);
      const afterGrace = new Date(Date.parse(renewedAt) + PAYMENT_GRACE_DAYS * DZIEN + SEKUNDA);
      expect(await suspendTeamsPastPaymentGrace(afterGrace)).toEqual({ suspended: 1 });
    });

    it("rezygnacja właściciela z planu Zespół zawiesza zespół od razu (bez karencji)", async () => {
      organizations.push({
        id: ORG,
        provider_subscription_id: SUB,
        status: "active",
        tenant_id: BILLING_IDS.tenant,
      });
      const start = relativeIso(-10 * DZIEN);
      const period = {
        priceKey: "team_monthly_seat",
        periodStart: start,
        periodEnd: relativeIso(20 * DZIEN),
      };
      await deliver(
        "customer.subscription.created",
        stripeSubscription({ status: "active", ...period }),
        start,
      );
      await deliver(
        "customer.subscription.deleted",
        stripeSubscription({
          status: "canceled",
          ...period,
          cancellationReason: "cancellation_requested",
        }),
        relativeIso(-1 * DZIEN),
      );
      expect(organizations[0]?.status).toBe("suspended");
      // Przebieg dobowy nie dotyka rezygnacji (nie ma kotwicy karencji).
      organizations[0]!.status = "active";
      expect(await suspendTeamsPastPaymentGrace()).toEqual({ suspended: 0 });
    });
  });
});

describe("SUB-16: windykacja liczy każdą próbę i podaje jej termin", () => {
  /** Subskrypcja tuż po odnowieniu: operator przesunął już okres o cały cykl. */
  async function activeSubscription() {
    const start = relativeIso(-1 * DZIEN);
    await deliver(
      "customer.subscription.created",
      stripeSubscription({
        status: "active",
        periodStart: start,
        periodEnd: relativeIso(29 * DZIEN),
      }),
      relativeIso(-30 * DZIEN),
    );
  }

  it("trzy nieudane próby jednej faktury: licznik 3 i trzy maile, każdy z terminem kolejnej próby", async () => {
    await activeSubscription();
    const attempts = [
      { at: relativeIso(-1 * DZIEN), next: relativeIso(2 * DZIEN) },
      { at: relativeIso(2 * DZIEN), next: relativeIso(5 * DZIEN) },
      { at: relativeIso(5 * DZIEN), next: relativeIso(9 * DZIEN) },
    ];
    for (const [index, attempt] of attempts.entries()) {
      await deliver(
        "invoice.payment_failed",
        stripeInvoice({ attempt: index + 1, nextAttempt: attempt.next }),
        attempt.at,
      );
    }
    // Ponowna dostawa drugiej próby nie jest czwartą próbą.
    await deliver(
      "invoice.payment_failed",
      stripeInvoice({ attempt: 2, nextAttempt: attempts[1]!.next }),
      attempts[1]!.at,
    );

    expect(subscriptionRow()?.payment_failure_count).toBe(3);
    // Kotwica karencji to PIERWSZA porażka - kolejne próby jej nie przesuwają.
    expect(subscriptionRow()?.first_payment_failed_at).toBe(attempts[0]!.at);

    const { formatDate } = await import("@/lib/email/transactional.server");
    const failed = mails("payment_failed");
    expect(failed).toHaveLength(3);
    expect(failed.map((mail) => mail.bodyVars?.retryAt)).toEqual(
      attempts.map((attempt) => formatDate(attempt.next, "pl")),
    );
    expect(new Set(failed.map((mail) => mail.idempotencyKey)).size).toBe(3);
    // Każdy mail podaje TEN SAM koniec karencji - od pierwszej porażki.
    const graceEnd = new Date(
      Date.parse(attempts[0]!.at) + PAYMENT_GRACE_DAYS * DZIEN,
    ).toISOString();
    expect(new Set(failed.map((mail) => mail.bodyVars?.accessUntil))).toEqual(
      new Set([formatDate(graceEnd, "pl")]),
    );
    expect(bells("Płatność nie powiodła się")).toHaveLength(3);
  });

  it("invoice.paid i invoice.payment_succeeded naraz: odzyskanie obsłużone RAZ", async () => {
    await activeSubscription();
    // Poprzednia, opłacona faktura - zwykłe odnowienie bez porażki.
    await deliver(
      "invoice.paid",
      stripeInvoice({ id: "in_poprzednia", attempt: 1 }),
      relativeIso(-2 * DZIEN),
    );
    await deliver("invoice.payment_failed", stripeInvoice({ attempt: 1 }), relativeIso(-1 * DZIEN));

    const paidAt = relativeIso(-1 * DZIEN + 60 * SEKUNDA);
    // Drugie zdarzenie startuje po jednym obrocie pętli zdarzeń. Start w tym
    // samym takcie trafiał w wyścig atrapy modułów vitest: równoległe
    // `import()` modułu z `vi.mock` potrafiło zwrócić PRAWDZIWY
    // `client.server` (bez zmiennych środowiskowych) - artefakt środowiska
    // testowego, bez odpowiednika w produkcji. Przy bazie w pamięci pierwsze
    // zdarzenie może się domknąć przed startem drugiego, więc test pilnuje,
    // że druga zapłata tej samej próby nie otwiera odzyskania ponownie;
    // równoległość w produkcji rozstrzyga warunkowy UPDATE w `claimRecovery`.
    const first = deliver("invoice.paid", stripeInvoice({ attempt: 2 }), paidAt);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = deliver("invoice.payment_succeeded", stripeInvoice({ attempt: 2 }), paidAt);
    await Promise.all([first, second]);

    expect(mails("payment_recovered")).toHaveLength(1);
    expect(bells("Płatność zaksięgowana")).toHaveLength(1);
    expect(subscriptionRow()).toMatchObject({
      payment_failure_count: 0,
      first_payment_failed_at: null,
    });
  });

  it("spóźniona porażka próby, po której płatność już przeszła, nie otwiera nowego cyklu", async () => {
    await activeSubscription();
    // PAY-13 (4.5): porażka sprzed ostatniej płatności jest pomijana WYŁĄCZNIE,
    // gdy TA faktura jest opłacona u operatora - windykacja pyta o nią.
    h.stripe.current = {
      subscriptions: {
        retrieve: async () => {
          throw new Error("test: ten przypadek nie ma prawa czytać subskrypcji");
        },
      },
      invoices: { retrieve: async (id: string) => ({ id, status: "paid" }) },
    };
    await deliver("invoice.payment_failed", stripeInvoice({ attempt: 1 }), relativeIso(-2 * DZIEN));
    await deliver("invoice.paid", stripeInvoice({ attempt: 2 }), relativeIso(-1 * DZIEN));
    // Ponowiona dostawa drugiej próby sprzed zapłaty.
    await deliver(
      "invoice.payment_failed",
      stripeInvoice({ attempt: 2 }),
      relativeIso(-1 * DZIEN - 60 * SEKUNDA),
    );

    expect(subscriptionRow()?.payment_failure_count).toBe(0);
    expect(mails("payment_failed")).toHaveLength(1);
  });

  it("nieudana PIERWSZA płatność (incomplete) nie jest windykacją", async () => {
    const at = relativeIso(-1 * DZIEN);
    await deliver(
      "customer.subscription.created",
      stripeSubscription({
        status: "incomplete",
        periodStart: at,
        periodEnd: relativeIso(29 * DZIEN),
      }),
      at,
    );
    await deliver("invoice.payment_failed", stripeInvoice({ attempt: 1 }), at);

    expect(subscriptionRow()?.payment_failure_count).toBe(0);
    expect(h.emails).toHaveLength(0);
    expect(notifications).toHaveLength(0);
  });
});

describe("SUB-14 (mapowanie i uprawnienie): pauza poboru i zaplanowana rezygnacja", () => {
  it("pauza poboru z panelu operatora odbiera dostęp, a jej zdjęcie go przywraca", async () => {
    const start = relativeIso(-5 * DZIEN);
    const end = relativeIso(25 * DZIEN);
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "active", periodStart: start, periodEnd: end }),
      start,
    );

    // Stripe zostawia status `active` - pauzę niesie wyłącznie `pause_collection`.
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({
        status: "active",
        periodStart: start,
        periodEnd: end,
        pauseCollection: { behavior: "void" },
      }),
      relativeIso(-2 * DZIEN),
    );
    expect(subscriptionRow()).toMatchObject({
      status: "paused",
      pause_collection_behavior: "void",
    });
    expect(grantsAccess(entitlement())).toBe(false);
    expect(bells("Subskrypcja wstrzymana")).toHaveLength(1);

    await deliver(
      "customer.subscription.updated",
      stripeSubscription({
        status: "active",
        periodStart: start,
        periodEnd: end,
        pauseCollection: null,
      }),
      relativeIso(-1 * DZIEN),
    );
    expect(subscriptionRow()).toMatchObject({ status: "active", pause_collection_behavior: null });
    expect(grantsAccess(entitlement())).toBe(true);
  });

  it("zdarzenie operatora nie kasuje i nie przestemplowuje `canceled_at` lokalnego anulowania", async () => {
    const start = relativeIso(-5 * DZIEN);
    const end = relativeIso(25 * DZIEN);
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "active", periodStart: start, periodEnd: end }),
      start,
    );
    // Lokalne `cancelSubscription` (checkout.functions) stempluje rezygnację.
    const localCancel = relativeIso(-3 * DZIEN);
    entitlement()!.canceled_at = localCancel;

    await deliver(
      "customer.subscription.updated",
      stripeSubscription({
        status: "active",
        periodStart: start,
        periodEnd: end,
        cancelAtPeriodEnd: true,
      }),
      relativeIso(-2 * DZIEN),
    );
    expect(subscriptionRow()?.cancel_at_period_end).toBe(true);
    expect(entitlement()).toMatchObject({ status: "active", canceled_at: localCancel });

    // Wznowienie u operatora (portal klienta) - rezygnacji już nie ma.
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({
        status: "active",
        periodStart: start,
        periodEnd: end,
        cancelAtPeriodEnd: false,
      }),
      relativeIso(-1 * DZIEN),
    );
    expect(entitlement()?.canceled_at).toBeNull();
  });

  it("rezygnacja zaplanowana datą `cancel_at` też jest rezygnacją zaplanowaną", async () => {
    const start = relativeIso(-5 * DZIEN);
    const end = relativeIso(25 * DZIEN);
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "active", periodStart: start, periodEnd: end }),
      start,
    );

    await deliver(
      "customer.subscription.updated",
      {
        ...stripeSubscription({ status: "active", periodStart: start, periodEnd: end }),
        cancel_at: unix(end),
      },
      relativeIso(-1 * DZIEN),
    );

    expect(subscriptionRow()?.cancel_at_period_end).toBe(true);
    expect(entitlement()?.canceled_at).toBeTruthy();
    expect(grantsAccess(entitlement())).toBe(true);
  });
});

// =============================================================================
// PRZEGLĄD POPRAWEK (adwersaryjny): przypadki, które przeszły przez SUB-02..19.
// =============================================================================

/**
 * Żywy stan subskrypcji u operatora (`subscriptions.retrieve`) - jedyne
 * miejsce, w którym dyspozytor ma prawo zapytać operatora: remis znaczników
 * z dwóch RÓŻNYCH zdarzeń z tej samej sekundy.
 */
function stripeLive(object: () => Record<string, unknown>) {
  const retrieve = vi.fn<StripeRetrieve>(async (id) => {
    if (id !== SUB) {
      throw Object.assign(new Error("No such subscription"), { code: "resource_missing" });
    }
    return object();
  });
  h.stripe.current = { subscriptions: { retrieve } };
  return retrieve;
}

/** Wiersz, który wstawia `created(incomplete)` - do wstrzyknięcia „w trakcie". */
function createdIncompleteRow(at: string, periodEnd: string): Row {
  return {
    id: `row-${nextId++}`,
    ...SUBSCRIPTION_DEFAULTS,
    user_id: BILLING_IDS.me,
    provider_subscription_id: SUB,
    provider_customer_id: CUSTOMER,
    product_id: "plan_plus",
    price_id: "plus_monthly",
    status: "incomplete",
    quantity: 1,
    current_period_start: at,
    current_period_end: periodEnd,
    trial_ends_at: null,
    cancel_at_period_end: false,
    pause_collection_behavior: null,
    environment: "live",
    last_event_at: new Date(Date.parse(at) - 1).toISOString(),
  };
}

/** Pierwszy odczyt stanu wiersza (kolumny obsługi zdarzenia) pada chwilowo. */
function failFirstStateRead() {
  const base = table(subscriptions, SUBSCRIPTION_DEFAULTS);
  let failNext = true;
  db.setResponse("subscriptions", (chain) => {
    const columns = String(chain.argsOf("select")?.[0] ?? "");
    if (failNext && chain.has("maybeSingle") && columns.includes("purchase_confirmed_at")) {
      failNext = false;
      return fail("connection reset by peer", "08006");
    }
    return base(chain);
  });
}

describe("strażnik kolejności: remis sekundy, wiersz „w trakcie” i awaria odczytu (#4, #35, #36, #37)", () => {
  it("updated(active) ścigające się z created(incomplete): wiersz wstawiony między zapytaniami strażnika NIE gubi aktywacji", async () => {
    // Warunkowy UPDATE nie trafia (wiersza jeszcze nie ma), `created` wstawia
    // go ze swoim znacznikiem, a odczyt istnienia już go widzi. Wcześniej to był
    // werdykt „stan nowszy": `skipped`, 200 dla operatora, płacący w `incomplete`.
    const at = relativeIso(-1 * DZIEN);
    const periodEnd = relativeIso(29 * DZIEN);
    const base = table(subscriptions, SUBSCRIPTION_DEFAULTS);
    let injected = false;
    db.setResponse("subscriptions", (chain) => {
      const result = base(chain);
      const missed = Array.isArray(result.data) && result.data.length === 0;
      if (!injected && chain.has("update") && chain.has("or") && missed) {
        injected = true;
        subscriptions.push(createdIncompleteRow(at, periodEnd));
      }
      return result;
    });

    const outcome = await deliver(
      "customer.subscription.updated",
      stripeSubscription({ status: "active", periodStart: at, periodEnd }),
      at,
    );

    expect(injected).toBe(true);
    expect(outcome).toBe("processed");
    expect(subscriptionRow()).toMatchObject({ status: "active", last_event_at: at });
    expect(grantsAccess(entitlement())).toBe(true);
    expect(mails("subscription_confirmed")).toHaveLength(1);
  });

  it("chwilowa awaria odczytu wiersza w obsłudze updated: wyjątek, zwolnione zajęcie, ponowienie stosuje stan", async () => {
    // PostgREST oddaje błąd w `{ error }`. Połknięty wyglądał jak „wiersza nie
    // ma": wstawienie zastawało wiersz, ponowne zajęcie WŁASNEGO znacznika
    // odbijało się od `<`, a zdarzenie kończyło się `processed` bez skutku.
    const createdAt = relativeIso(-2 * DZIEN);
    const period = { periodStart: createdAt, periodEnd: relativeIso(28 * DZIEN) };
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "incomplete", ...period }),
      createdAt,
    );
    failFirstStateRead();
    const activatedAt = relativeIso(-2 * DZIEN + 30 * SEKUNDA);
    const active = stripeSubscription({ status: "active", ...period });

    await expect(deliver("customer.subscription.updated", active, activatedAt)).rejects.toThrow(
      /subscription lookup failed/,
    );
    expect(subscriptionRow()?.status).toBe("incomplete");
    expect(grantsAccess(entitlement())).toBe(false);

    // Operator ponawia TO SAMO zdarzenie (ten sam znacznik).
    expect(await deliver("customer.subscription.updated", active, activatedAt)).toBe("processed");
    expect(subscriptionRow()).toMatchObject({ status: "active", last_event_at: activatedAt });
    expect(grantsAccess(entitlement())).toBe(true);
    expect(mails("subscription_confirmed")).toHaveLength(1);
  });

  it("chwilowa awaria odczytu wiersza przy rezygnacji: wyjątek zamiast rezygnacji bez skutku", async () => {
    const start = relativeIso(-10 * DZIEN);
    const period = { periodStart: start, periodEnd: relativeIso(20 * DZIEN) };
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "active", ...period }),
      start,
    );
    failFirstStateRead();
    const deleted = stripeSubscription({
      status: "canceled",
      ...period,
      cancellationReason: "cancellation_requested",
    });
    const at = relativeIso(-1 * DZIEN);

    await expect(deliver("customer.subscription.deleted", deleted, at)).rejects.toThrow(
      /subscription lookup failed/,
    );
    expect(await deliver("customer.subscription.deleted", deleted, at)).toBe("processed");
    expect(subscriptionRow()?.status).toBe("canceled");
    expect(mails("subscription_canceled")).toHaveLength(1);
  });

  it("upgrade z cofnięciem zaplanowanej rezygnacji: dwa updated w TEJ SAMEJ sekundzie - wygrywa żywy stan operatora", async () => {
    // changeSubscriptionPrice: najpierw nowa cena (cancel_at_period_end wciąż
    // true), potem cofnięcie rezygnacji - dwa zdarzenia z jednym `created`.
    // Ścisłe `<` odrzucało drugie: panel pokazywał „anulowanie zaplanowane"
    // dla subskrypcji, którą operator odnowi i obciąży.
    const start = relativeIso(-10 * DZIEN);
    const end = relativeIso(20 * DZIEN);
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "active", periodStart: start, periodEnd: end }),
      start,
    );
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({
        status: "active",
        periodStart: start,
        periodEnd: end,
        cancelAtPeriodEnd: true,
      }),
      relativeIso(-5 * DZIEN),
    );
    expect(entitlement()?.canceled_at).toBeTruthy();

    const upgradedAt = relativeIso(-1 * DZIEN);
    const upgraded = { priceKey: "pro_monthly", periodStart: start, periodEnd: end };
    const retrieve = stripeLive(() =>
      stripeSubscription({ status: "active", ...upgraded, cancelAtPeriodEnd: false }),
    );

    expect(
      await deliver(
        "customer.subscription.updated",
        stripeSubscription({ status: "active", ...upgraded, cancelAtPeriodEnd: true }),
        upgradedAt,
      ),
    ).toBe("processed");
    expect(retrieve).not.toHaveBeenCalled();
    expect(
      await deliver(
        "customer.subscription.updated",
        stripeSubscription({ status: "active", ...upgraded, cancelAtPeriodEnd: false }),
        upgradedAt,
      ),
    ).toBe("processed");

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve.mock.calls[0]?.[0]).toBe(SUB);
    expect(subscriptionRow()).toMatchObject({
      price_id: "pro_monthly",
      cancel_at_period_end: false,
      last_event_at: upgradedAt,
    });
    expect(entitlement()).toMatchObject({ plan_id: "plan-pro-monthly", canceled_at: null });
    expect(grantsAccess(entitlement())).toBe(true);
  });

  it("zwolnienie harmonogramu i opłacony upgrade w tej samej sekundzie (w obu kolejnościach): zostaje NOWY plan", async () => {
    for (const order of ["release-first", "upgrade-first"] as const) {
      subscriptions.length = 0;
      entitlements.length = 0;
      const start = relativeIso(-10 * DZIEN);
      const end = relativeIso(20 * DZIEN);
      await deliver(
        "customer.subscription.created",
        stripeSubscription({ status: "active", periodStart: start, periodEnd: end }),
        start,
      );
      const at = relativeIso(-1 * DZIEN);
      const released = stripeSubscription({ status: "active", periodStart: start, periodEnd: end });
      const paid = stripeSubscription({
        status: "active",
        priceKey: "pro_monthly",
        periodStart: start,
        periodEnd: end,
      });
      stripeLive(() => paid);

      const events = order === "release-first" ? [released, paid] : [paid, released];
      for (const object of events) await deliver("customer.subscription.updated", object, at);

      expect(subscriptionRow()?.price_id, order).toBe("pro_monthly");
      expect(entitlement()?.plan_id, order).toBe("plan-pro-monthly");
    }
  });

  it("remis z niedostępnym operatorem: wyjątek bez zwalniania cudzego znacznika, ponowienie rozstrzyga", async () => {
    const start = relativeIso(-10 * DZIEN);
    const end = relativeIso(20 * DZIEN);
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "active", periodStart: start, periodEnd: end }),
      start,
    );
    const at = relativeIso(-1 * DZIEN);
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({
        status: "active",
        periodStart: start,
        periodEnd: end,
        cancelAtPeriodEnd: true,
      }),
      at,
    );
    const reverted = stripeSubscription({ status: "active", periodStart: start, periodEnd: end });
    const retrieve = vi.fn<StripeRetrieve>(async () => {
      throw new Error("gateway timeout");
    });
    h.stripe.current = { subscriptions: { retrieve } };

    await expect(deliver("customer.subscription.updated", reverted, at)).rejects.toThrow(
      /gateway timeout/,
    );
    // Znacznik należy do zdarzenia, które go zajęło - nie cofamy go.
    expect(subscriptionRow()).toMatchObject({ last_event_at: at, cancel_at_period_end: true });

    stripeLive(() => reverted);
    expect(await deliver("customer.subscription.updated", reverted, at)).toBe("processed");
    expect(subscriptionRow()?.cancel_at_period_end).toBe(false);
  });

  it("powtórka zdarzenia z tej samej sekundy, które niczego nie zmienia, nie pyta operatora", async () => {
    const start = relativeIso(-10 * DZIEN);
    const object = stripeSubscription({
      status: "active",
      periodStart: start,
      periodEnd: relativeIso(20 * DZIEN),
    });
    await deliver("customer.subscription.created", object, start);
    const at = relativeIso(-1 * DZIEN);
    await deliver("customer.subscription.updated", object, at);

    // `h.stripe.current` pusty: każde wywołanie operatora wywróciłoby test.
    // Powtórkę rozpoznaje identyfikator zdarzenia (`replay`, PAY-02): obsługa
    // przechodzi jeszcze raz idempotentnie (`processed`), bez pytania operatora.
    expect(await deliver("customer.subscription.updated", object, at)).toBe("processed");
    expect(subscriptionRow()).toMatchObject({ status: "active", last_event_at: at });
  });
});

describe("potwierdzenie zakupu nie ginie po awarii (#2, #42)", () => {
  /** Uprawnienie, którego pierwszy zapis danego rodzaju pada chwilowo. */
  function failFirstEntitlement(method: "insert" | "update") {
    const entitlementTable = table(entitlements);
    let failNext = true;
    db.setResponse("user_subscriptions", (chain) => {
      if (failNext && chain.has(method)) {
        failNext = false;
        return fail("could not serialize access", "40001");
      }
      return entitlementTable(chain);
    });
  }

  const consent = () =>
    premiumNewsletterConsentMetadata({
      version: PREMIUM_NEWSLETTER_CONSENT_VERSION,
      lang: "pl",
      at: relativeIso(-2 * DZIEN - 5 * SEKUNDA),
    });

  it("updated(active) przed created, zapis uprawnienia padł: ponowienie potwierdza zakup RAZ (spóźnione created nic nie dubluje)", async () => {
    failFirstEntitlement("insert");
    const at = relativeIso(-1 * DZIEN);
    const period = { periodStart: at, periodEnd: relativeIso(29 * DZIEN), metadata: consent() };
    const active = stripeSubscription({ status: "active", ...period });

    await expect(deliver("customer.subscription.updated", active, at)).rejects.toThrow(
      /entitlement sync: insert failed/,
    );
    // PAY-02 (1.2): skutki założenia PRZED wstawieniem - po porażce wiersza nie ma.
    expect(subscriptionRow()).toBeUndefined();
    expect(mails("subscription_confirmed")).toHaveLength(0);

    // `created` z wcześniejszej sekundy dociera między porażką a ponowieniem
    // i zakłada wiersz (`incomplete`, bez potwierdzenia) - dlatego `processed`.
    expect(
      await deliver(
        "customer.subscription.created",
        stripeSubscription({ status: "incomplete", ...period }),
        relativeIso(-1 * DZIEN - 2 * SEKUNDA),
      ),
    ).toBe("processed");
    expect(mails("subscription_confirmed")).toHaveLength(0);
    // Ponowienie aktywacji jest świeższe od `created` - potwierdza zakup.
    expect(await deliver("customer.subscription.updated", active, at)).toBe("processed");

    expect(grantsAccess(entitlement())).toBe(true);
    expect(subscriptionRow()?.purchase_confirmed_at).toBeTruthy();
    expect(mails("subscription_confirmed")).toHaveLength(1);
    expect(bells("Subskrypcja aktywna")).toHaveLength(1);
    expect(newsletterWrites()).toHaveLength(1);
  });

  it("created(active) padło po wstawieniu, a NOWSZE updated wyprzedziło ponowienie: potwierdzenie wychodzi raz", async () => {
    failFirstEntitlement("insert");
    const createdAt = relativeIso(-2 * DZIEN);
    const period = {
      periodStart: createdAt,
      periodEnd: relativeIso(28 * DZIEN),
      metadata: consent(),
    };
    const created = stripeSubscription({ status: "active", ...period });

    await expect(deliver("customer.subscription.created", created, createdAt)).rejects.toThrow();
    // Np. zmiana domyślnej metody płatności godzinę później.
    expect(
      await deliver(
        "customer.subscription.updated",
        stripeSubscription({ status: "active", ...period }),
        relativeIso(-2 * DZIEN + 60 * 60 * SEKUNDA),
      ),
    ).toBe("processed");
    // Ponowienie `created` jest już starsze od zapisanego stanu (`stale`):
    // ładunku nie stosuje, uprawnienie wyrównuje żywym stanem operatora
    // (PAY-02) - `processed`, bez drugiego potwierdzenia.
    stripeLive(() => stripeSubscription({ status: "active", ...period }));
    expect(await deliver("customer.subscription.created", created, createdAt)).toBe("processed");

    expect(grantsAccess(entitlement())).toBe(true);
    expect(mails("subscription_confirmed")).toHaveLength(1);
    expect(bells("Subskrypcja aktywna")).toHaveLength(1);
    expect(newsletterWrites()).toHaveLength(1);
  });

  it("incomplete -> active, zapis uprawnienia padł PO zapisie statusu: ponowienie potwierdza i zapisuje zgodę z checkoutu", async () => {
    const createdAt = relativeIso(-2 * DZIEN);
    const period = {
      periodStart: createdAt,
      periodEnd: relativeIso(28 * DZIEN),
      metadata: consent(),
    };
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "incomplete", ...period }),
      createdAt,
    );
    failFirstEntitlement("update");
    const activatedAt = relativeIso(-2 * DZIEN + 20 * SEKUNDA);
    const active = stripeSubscription({ status: "active", ...period });

    await expect(deliver("customer.subscription.updated", active, activatedAt)).rejects.toThrow(
      /entitlement sync: update failed/,
    );
    // Po scaleniu z PAY-02 stan zapisuje się PO skutkach (zapis warunkiem na
    // zajęcie), więc wiersz zostaje `incomplete`. Wyzwalaczem potwierdzenia
    // i tak jest pusty `purchase_confirmed_at`, nie poprzedni status (SUB-02).
    expect(subscriptionRow()).toMatchObject({
      status: "incomplete",
      purchase_confirmed_at: null,
    });

    expect(await deliver("customer.subscription.updated", active, activatedAt)).toBe("processed");
    expect(grantsAccess(entitlement())).toBe(true);
    expect(mails("subscription_confirmed")).toHaveLength(1);
    expect(bells("Subskrypcja aktywna")).toHaveLength(1);
    expect(newsletterWrites()).toHaveLength(1);
    expect(db.chainsFor("crm_leads").filter((c) => c.has("insert"))).toHaveLength(1);
  });
});

describe("anulowanie subskrypcji NIGDY nieopłaconej (#1)", () => {
  it.each([["cancellation_requested"], ["payment_failed"], [undefined]])(
    "created(incomplete) -> deleted(%s): bez dostępu, maila, dzwonka i CRM",
    async (reason) => {
      organizations.push({
        id: ORG,
        provider_subscription_id: SUB,
        status: "active",
        tenant_id: BILLING_IDS.tenant,
      });
      const at = relativeIso(-1 * DZIEN);
      // Plan ROCZNY: koniec okresu ze zdarzenia to rok od porzuconego checkoutu.
      const period = {
        priceKey: "plus_annual",
        periodStart: at,
        periodEnd: relativeIso(364 * DZIEN),
      };
      await deliver(
        "customer.subscription.created",
        stripeSubscription({ status: "incomplete", ...period }),
        at,
      );
      await deliver(
        "customer.subscription.deleted",
        stripeSubscription({ status: "canceled", ...period, cancellationReason: reason }),
        relativeIso(-1 * DZIEN + 60 * 60 * SEKUNDA),
      );

      expect(subscriptionRow()?.status).toBe("canceled");
      expect(entitlement()?.status).toBe("canceled");
      expect(grantsAccess(entitlement())).toBe(false);
      expect(h.emails).toHaveLength(0);
      expect(notifications).toHaveLength(0);
      expect(crmWrites()).toHaveLength(0);
    },
  );

  it("plan Zespół nigdy nieopłacony: anulowanie zawiesza organizację", async () => {
    organizations.push({
      id: ORG,
      provider_subscription_id: SUB,
      status: "active",
      tenant_id: BILLING_IDS.tenant,
    });
    const at = relativeIso(-1 * DZIEN);
    const period = {
      priceKey: "team_monthly_seat",
      periodStart: at,
      periodEnd: relativeIso(29 * DZIEN),
    };
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "incomplete", ...period }),
      at,
    );
    await deliver(
      "customer.subscription.deleted",
      stripeSubscription({ status: "canceled", ...period, cancellationReason: "payment_failed" }),
      relativeIso(-1 * DZIEN + 60 * 60 * SEKUNDA),
    );
    expect(organizations[0]?.status).toBe("suspended");
    expect(notifications).toHaveLength(0);
  });

  it("incomplete z ZAKSIĘGOWANĄ płatnością (aktywacja w drodze): anulowanie to rezygnacja płacącego", async () => {
    const at = relativeIso(-1 * DZIEN);
    const period = { periodStart: at, periodEnd: relativeIso(29 * DZIEN) };
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "incomplete", ...period }),
      at,
    );
    await deliver(
      "invoice.paid",
      stripeInvoice({ attempt: 1, billingReason: "subscription_create" }),
      relativeIso(-1 * DZIEN + 10 * SEKUNDA),
    );
    await deliver(
      "customer.subscription.deleted",
      stripeSubscription({
        status: "canceled",
        ...period,
        cancellationReason: "cancellation_requested",
      }),
      relativeIso(-1 * DZIEN + 60 * 60 * SEKUNDA),
    );

    expect(entitlement()).toMatchObject({ status: "active", current_period_end: period.periodEnd });
    expect(mails("subscription_canceled")).toHaveLength(1);
  });
});

describe("dopłata za zmianę w trakcie okresu to nie windykacja odnowienia (#6, #13, #38)", () => {
  async function activeSubscription() {
    const start = relativeIso(-5 * DZIEN);
    await deliver(
      "customer.subscription.created",
      stripeSubscription({
        status: "active",
        periodStart: start,
        periodEnd: relativeIso(25 * DZIEN),
      }),
      start,
    );
  }

  it("odrzucona dopłata do upgrade'u przy aktywnej subskrypcji: bez licznika, kotwicy, maila i dzwonka - i bez fałszywego „odzyskano”", async () => {
    await activeSubscription();
    await deliver(
      "invoice.payment_failed",
      stripeInvoice({
        id: "in_1SyntetycznaDoplata",
        attempt: 1,
        amount: 2500,
        billingReason: "subscription_update",
      }),
      relativeIso(-2 * DZIEN),
    );

    expect(subscriptionRow()).toMatchObject({
      payment_failure_count: 0,
      first_payment_failed_at: null,
      last_dunning_transaction_id: null,
    });
    expect(mails("payment_failed")).toHaveLength(0);
    expect(bells("Płatność nie powiodła się")).toHaveLength(0);
    expect(grantsAccess(entitlement())).toBe(true);

    // Najbliższe zwykłe odnowienie.
    await deliver(
      "invoice.paid",
      stripeInvoice({
        id: "in_1SyntetyczneOdnowienie",
        attempt: 1,
        billingReason: "subscription_cycle",
      }),
      relativeIso(-1 * DZIEN),
    );
    expect(mails("payment_recovered")).toHaveLength(0);
    expect(bells("Płatność zaksięgowana")).toHaveLength(0);
  });

  it("dopłata za zmianę przy subskrypcji JUŻ zaległej to nadal windykacja", async () => {
    await activeSubscription();
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({
        status: "past_due",
        periodStart: relativeIso(-5 * DZIEN),
        periodEnd: relativeIso(25 * DZIEN),
      }),
      relativeIso(-3 * DZIEN),
    );
    await deliver(
      "invoice.payment_failed",
      stripeInvoice({ attempt: 1, billingReason: "subscription_update" }),
      relativeIso(-2 * DZIEN),
    );
    expect(subscriptionRow()?.payment_failure_count).toBe(1);
    expect(mails("payment_failed")).toHaveLength(1);
  });

  it("opłacona dopłata za zmianę nie zamyka cyklu windykacji, który otworzyło odnowienie", async () => {
    await activeSubscription();
    const renewal = { id: "in_1SyntetyczneOdnowienie", billingReason: "subscription_cycle" };
    await deliver(
      "invoice.payment_failed",
      stripeInvoice({ ...renewal, attempt: 1 }),
      relativeIso(-3 * DZIEN),
    );
    const anchor = subscriptionRow()?.first_payment_failed_at;
    expect(anchor).toBeTruthy();

    await deliver(
      "invoice.paid",
      stripeInvoice({
        id: "in_1SyntetycznaDoplata",
        attempt: 1,
        billingReason: "subscription_update",
      }),
      relativeIso(-2 * DZIEN),
    );
    expect(subscriptionRow()).toMatchObject({
      payment_failure_count: 1,
      first_payment_failed_at: anchor,
    });
    expect(mails("payment_recovered")).toHaveLength(0);

    await deliver(
      "invoice.paid",
      stripeInvoice({ ...renewal, attempt: 2 }),
      relativeIso(-1 * DZIEN),
    );
    expect(subscriptionRow()).toMatchObject({
      payment_failure_count: 0,
      first_payment_failed_at: null,
    });
    expect(mails("payment_recovered")).toHaveLength(1);
  });

  it("opłacona dopłata nie udaje zapłaty za okres: spóźniona porażka odnowienia otwiera windykację, a deleted bez powodu liczy karencję (Codex P1, PR #502)", async () => {
    // Odnowienie roczne przesunęło okres; porażka jego obciążenia dotarła
    // dopiero PO opłaconej dopłacie za upgrade. Znacznik `last_payment_at`
    // z dopłaty połykał tę porażkę (strażnik „sprzed zapłaty"), a anulowanie
    // bez powodu uznawał za opłacony okres - rok dostępu bez zapłaty.
    const renewalAt = relativeIso(-5 * DZIEN);
    const yearAgo = new Date(Date.parse(renewalAt) - 365 * DZIEN).toISOString();
    const nextYear = new Date(Date.parse(renewalAt) + 365 * DZIEN).toISOString();
    const annual = { priceKey: "plus_annual", periodStart: renewalAt, periodEnd: nextYear };
    await deliver(
      "customer.subscription.created",
      stripeSubscription({
        status: "active",
        priceKey: "plus_annual",
        periodStart: yearAgo,
        periodEnd: renewalAt,
      }),
      yearAgo,
    );
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({ status: "past_due", ...annual }),
      renewalAt,
    );
    const prorationPaidAt = relativeIso(-3 * DZIEN);
    await deliver(
      "invoice.paid",
      stripeInvoice({
        id: "in_1SyntetycznaDoplata",
        attempt: 1,
        billingReason: "subscription_update",
      }),
      prorationPaidAt,
    );
    expect(subscriptionRow()?.last_payment_at ?? null).not.toBe(prorationPaidAt);

    await deliver(
      "invoice.payment_failed",
      stripeInvoice({
        id: "in_1SyntetyczneOdnowienie",
        attempt: 1,
        billingReason: "subscription_cycle",
      }),
      renewalAt,
    );
    expect(subscriptionRow()?.payment_failure_count).toBe(1);
    expect(mails("payment_failed")).toHaveLength(1);

    await deliver(
      "customer.subscription.deleted",
      stripeSubscription({ status: "canceled", ...annual }),
      relativeIso(-1 * DZIEN),
    );
    const graceEnd = new Date(Date.parse(renewalAt) + PAYMENT_GRACE_DAYS * DZIEN).toISOString();
    expect(entitlement()).toMatchObject({ status: "active", current_period_end: graceEnd });
  });

  it("dopłata za zmianę interwału otwiera NOWY opłacony okres: przesuwa `last_payment_at`, zwykła dopłata nie (Codex P1, PR #502)", async () => {
    // Samoobsługowy upgrade z miesięcznego na roczny idzie przez
    // `always_invoice`: operator resetuje okres i fakturą `subscription_update`
    // obciąża za cały nowy rok (pozycja bez proraty od początku okresu).
    const monthStart = relativeIso(-20 * DZIEN);
    await deliver(
      "customer.subscription.created",
      stripeSubscription({
        status: "active",
        periodStart: monthStart,
        periodEnd: relativeIso(10 * DZIEN),
      }),
      monthStart,
    );
    await deliver(
      "invoice.paid",
      stripeInvoice({
        id: "in_1SyntetyczneOdnowienie",
        attempt: 1,
        billingReason: "subscription_cycle",
      }),
      monthStart,
    );
    expect(subscriptionRow()?.last_payment_at).toBe(monthStart);

    const upgradedAt = relativeIso(-2 * DZIEN);
    const yearEnd = new Date(Date.parse(upgradedAt) + 365 * DZIEN).toISOString();
    const subscriptionLine = (o: { start: string; end: string; proration: boolean }) => ({
      period: { start: unix(o.start), end: unix(o.end) },
      parent: {
        type: "subscription_item_details",
        subscription_item_details: {
          proration: o.proration,
          invoice_item: o.proration ? "ii_1Syntetyczna" : null,
        },
      },
    });
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({
        status: "active",
        priceKey: "plus_annual",
        periodStart: upgradedAt,
        periodEnd: yearEnd,
      }),
      upgradedAt,
    );
    await deliver(
      "invoice.paid",
      {
        ...stripeInvoice({
          id: "in_1SyntetycznaZmianaInterwalu",
          attempt: 1,
          billingReason: "subscription_update",
        }),
        lines: {
          data: [
            subscriptionLine({ start: upgradedAt, end: relativeIso(10 * DZIEN), proration: true }),
            subscriptionLine({ start: upgradedAt, end: yearEnd, proration: false }),
          ],
        },
      },
      upgradedAt,
    );
    expect(subscriptionRow()?.last_payment_at).toBe(upgradedAt);

    // Dopłata za miejsca w nowym okresie (same proraty) - znacznik zostaje.
    await deliver(
      "invoice.paid",
      {
        ...stripeInvoice({
          id: "in_1SyntetycznaDoplata",
          attempt: 1,
          billingReason: "subscription_update",
        }),
        lines: {
          data: [
            subscriptionLine({ start: relativeIso(-1 * DZIEN), end: yearEnd, proration: true }),
          ],
        },
      },
      relativeIso(-1 * DZIEN),
    );
    expect(subscriptionRow()?.last_payment_at).toBe(upgradedAt);
  });
});

describe("koniec windykacji to nie rezygnacja - treść dla klienta (#7)", () => {
  async function annualRenewalFailed(renewalAt: string): Promise<string> {
    const yearAgo = new Date(Date.parse(renewalAt) - 365 * DZIEN).toISOString();
    const nextYear = new Date(Date.parse(renewalAt) + 365 * DZIEN).toISOString();
    await deliver(
      "customer.subscription.created",
      stripeSubscription({
        status: "active",
        priceKey: "plus_annual",
        periodStart: yearAgo,
        periodEnd: renewalAt,
      }),
      yearAgo,
    );
    await deliver(
      "customer.subscription.updated",
      stripeSubscription({
        status: "past_due",
        priceKey: "plus_annual",
        periodStart: renewalAt,
        periodEnd: nextYear,
      }),
      renewalAt,
    );
    return nextYear;
  }

  async function endOfDunning(renewalAt: string, nextYear: string) {
    await deliver(
      "customer.subscription.deleted",
      stripeSubscription({
        status: "canceled",
        priceKey: "plus_annual",
        periodStart: renewalAt,
        periodEnd: nextYear,
        cancellationReason: "payment_failed",
      }),
      relativeIso(-1 * DZIEN),
    );
  }

  it("po karencji: bez maila „rezygnacja, dostęp do końca opłaconego okresu”, dzwonek mówi, że dostęp wygasł", async () => {
    const renewalAt = relativeIso(-21 * DZIEN);
    await endOfDunning(renewalAt, await annualRenewalFailed(renewalAt));

    expect(mails("subscription_canceled")).toHaveLength(0);
    expect(bells("Subskrypcja anulowana")).toHaveLength(0);
    const [bell] = bells("Subskrypcja zakończona");
    expect(bell?.body_pl).toMatch(/dostęp wygasł/);
    expect(String(bell?.href)).not.toContain("retention");
    expect(grantsAccess(entitlement())).toBe(false);
    // Odejście klienta i tak trafia do CRM.
    const churned = db
      .chainsFor("crm_leads")
      .filter((c) => c.has("insert") || c.has("update"))
      .map((c) => (c.argsOf("insert") ?? c.argsOf("update"))?.[0] as { tags?: string[] })
      .some((row) => row?.tags?.includes("churned"));
    expect(churned).toBe(true);
  });

  it("w karencji: dzwonek podaje, że dostęp działa do końca karencji - nie do końca okresu", async () => {
    const renewalAt = relativeIso(-5 * DZIEN);
    await endOfDunning(renewalAt, await annualRenewalFailed(renewalAt));

    expect(mails("subscription_canceled")).toHaveLength(0);
    const [bell] = bells("Subskrypcja zakończona");
    expect(bell?.body_pl).toMatch(/do końca okresu karencji/);
    expect(grantsAccess(entitlement())).toBe(true);
  });
});

// =============================================================================
// SCALENIE #495 (SUB) Z PAY-02/S1: jeden strażnik, komunikaty po zapisie stanu.
// =============================================================================

describe("S1 x SUB-03: karencja nie ożywia korekty (zwrot / spór bieżącego okresu)", () => {
  it("zaległość w NOWYM okresie i koniec windykacji po zwrocie: uprawnienie zostaje `refunded`", async () => {
    // Zwrot bieżącego okresu zapisuje `refunded` + `canceled_at` = chwila
    // korekty (S1). Stripe przesuwa okres przy odnowieniu PRZED obciążeniem,
    // więc nieudane odnowienie przychodzi jako `past_due` z okresem zaczętym po
    // korekcie, a karencja (SUB-03) dawała mu dostęp. Klient, któremu właśnie
    // zwróciliśmy pieniądze, dostawał dwa tygodnie za kolejną nieudaną płatność
    // - a koniec windykacji (`deleted`, `payment_failed`) jeszcze raz.
    const start = relativeIso(-40 * DZIEN);
    const renewalAt = relativeIso(-10 * DZIEN);
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "active", periodStart: start, periodEnd: renewalAt }),
      start,
    );
    const correctedAt = relativeIso(-20 * DZIEN);
    Object.assign(entitlement()!, { status: "refunded", canceled_at: correctedAt });

    await deliver(
      "customer.subscription.updated",
      stripeSubscription({
        status: "past_due",
        periodStart: renewalAt,
        periodEnd: relativeIso(20 * DZIEN),
      }),
      renewalAt,
    );
    expect(entitlement()).toMatchObject({ status: "refunded", canceled_at: correctedAt });

    await deliver(
      "customer.subscription.deleted",
      stripeSubscription({
        status: "canceled",
        periodStart: renewalAt,
        periodEnd: relativeIso(20 * DZIEN),
        cancellationReason: "payment_failed",
      }),
      relativeIso(-1 * DZIEN),
    );
    expect(entitlement()).toMatchObject({ status: "refunded", canceled_at: correctedAt });
    expect(grantsAccess(entitlement())).toBe(false);
  });

  it("kolejne OPŁACONE odnowienie po korekcie nadal ją ożywia", async () => {
    const start = relativeIso(-40 * DZIEN);
    const renewalAt = relativeIso(-10 * DZIEN);
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "active", periodStart: start, periodEnd: renewalAt }),
      start,
    );
    Object.assign(entitlement()!, { status: "refunded", canceled_at: relativeIso(-20 * DZIEN) });

    await deliver(
      "customer.subscription.updated",
      stripeSubscription({
        status: "active",
        periodStart: renewalAt,
        periodEnd: relativeIso(20 * DZIEN),
      }),
      renewalAt,
    );

    expect(entitlement()).toMatchObject({ status: "active", canceled_at: null });
    expect(grantsAccess(entitlement())).toBe(true);
  });
});

describe("rezygnacja nigdy nieopłaconej subskrypcji - powtórka po zapisie", () => {
  it("ponowiona rezygnacja (wiersz już `canceled`) nie daje dostępu, maila ani dzwonka", async () => {
    // Po scaleniu z PAY-02 ponowna dostawa tego samego zdarzenia to `replay`,
    // który przechodzi obsługę jeszcze raz - a wiersz ma już status
    // `canceled`, nie `incomplete`. Bez reguły „brak potwierdzenia i płatności
    // przy wierszu `canceled` = nigdy nieopłacona" druga dostawa dawała dostęp
    // do końca ROCZNEGO okresu i mail „rezygnacja, dostęp do końca opłaconego
    // okresu".
    const at = relativeIso(-1 * DZIEN);
    const period = {
      priceKey: "plus_annual",
      periodStart: at,
      periodEnd: relativeIso(364 * DZIEN),
    };
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "incomplete", ...period }),
      at,
    );
    const deleted = stripeSubscription({
      status: "canceled",
      ...period,
      cancellationReason: "cancellation_requested",
    });
    const deletedAt = relativeIso(-1 * DZIEN + 60 * 60 * SEKUNDA);

    expect(await deliver("customer.subscription.deleted", deleted, deletedAt)).toBe("processed");
    expect(await deliver("customer.subscription.deleted", deleted, deletedAt)).toBe("processed");

    expect(subscriptionRow()?.status).toBe("canceled");
    expect(grantsAccess(entitlement())).toBe(false);
    expect(h.emails).toHaveLength(0);
    expect(notifications).toHaveLength(0);
    expect(crmWrites()).toHaveLength(0);
  });
});

describe("potwierdzenie zakupu po zapisie stanu - przejściowa awaria zgody (SUB-15 #34 x A3)", () => {
  it("awaria zapisu zgody PO wstawieniu wiersza: zdarzenie pada, ponowienie zapisuje zgodę i potwierdza RAZ", async () => {
    // Komunikaty zakupu (CRM, zgoda z checkoutu, zajęcie potwierdzenia, mail,
    // dzwonek) wychodzą dopiero PO zapisie wiersza. Przejściowa awaria zapisu
    // zgody nie może wtedy zniknąć w logu: zdarzenie musi paść, żeby operator
    // je ponowił - a ponowienie (`replay`) widzi pusty `purchase_confirmed_at`
    // i ogłasza zakup jeszcze raz, tym razem do skutku.
    const newsletter = table([]);
    let failNext = true;
    db.setResponse("newsletter_subscribers", (chain) => {
      if (failNext && chain.has("upsert")) {
        failNext = false;
        return fail("could not serialize access", "40001");
      }
      return newsletter(chain);
    });
    const at = relativeIso(-1 * DZIEN);
    const object = stripeSubscription({
      status: "active",
      periodStart: at,
      periodEnd: relativeIso(29 * DZIEN),
      metadata: premiumNewsletterConsentMetadata({
        version: PREMIUM_NEWSLETTER_CONSENT_VERSION,
        lang: "pl",
        at: relativeIso(-1 * DZIEN - 5 * SEKUNDA),
      }),
    });

    await expect(deliver("customer.subscription.created", object, at)).rejects.toThrow(
      /newsletter insert failed/,
    );
    // Stan zapisany (dostęp jest), potwierdzenie wolne - nic nie wyszło.
    expect(grantsAccess(entitlement())).toBe(true);
    expect(subscriptionRow()?.purchase_confirmed_at).toBeNull();
    expect(mails("subscription_confirmed")).toHaveLength(0);

    expect(await deliver("customer.subscription.created", object, at)).toBe("processed");
    expect(newsletterWrites()).toHaveLength(2);
    expect(subscriptionRow()?.purchase_confirmed_at).toBeTruthy();
    expect(mails("subscription_confirmed")).toHaveLength(1);
    expect(bells("Subskrypcja aktywna")).toHaveLength(1);
  });
});

describe("wyrównanie po wyparciu liczy karencję (PAY-02 x SUB-03)", () => {
  it("spóźnione zdarzenie przy zaległości: uprawnienie do końca karencji, nie do końca nowego roku", async () => {
    const renewalAt = relativeIso(-3 * DZIEN);
    const yearAgo = new Date(Date.parse(renewalAt) - 365 * DZIEN).toISOString();
    const nextYear = new Date(Date.parse(renewalAt) + 365 * DZIEN).toISOString();
    const annual = { priceKey: "plus_annual" };
    await deliver(
      "customer.subscription.created",
      stripeSubscription({
        status: "active",
        ...annual,
        periodStart: yearAgo,
        periodEnd: renewalAt,
      }),
      yearAgo,
    );
    const pastDue = { status: "past_due", ...annual, periodStart: renewalAt, periodEnd: nextYear };
    await deliver("customer.subscription.updated", stripeSubscription(pastDue), renewalAt);

    // Spóźnione `updated(active)` sprzed odnowienia: ładunku nie stosuje,
    // uprawnienie wyrównuje żywym stanem operatora (zaległość) - z tą samą
    // karencją co obsługa zdarzenia, a nie do końca przesuniętego okresu.
    stripeLive(() => stripeSubscription(pastDue));
    expect(
      await deliver(
        "customer.subscription.updated",
        stripeSubscription({
          status: "active",
          ...annual,
          periodStart: yearAgo,
          periodEnd: renewalAt,
        }),
        relativeIso(-200 * DZIEN),
      ),
    ).toBe("processed");

    const graceEnd = new Date(Date.parse(renewalAt) + PAYMENT_GRACE_DAYS * DZIEN).toISOString();
    expect(subscriptionRow()).toMatchObject({
      status: "past_due",
      first_payment_failed_at: renewalAt,
    });
    expect(entitlement()?.current_period_end).toBe(graceEnd);
  });
});

// =============================================================================
// Odrzucona dopłata opłacona PÓŹNIEJ (`customer.subscription.pending_update_applied`).
// =============================================================================

const SCHEDULE = "sub_sched_1SyntetycznyHarmonogram";

type LiveItem = { current_period_start: number; current_period_end: number };

/**
 * Operator z harmonogramem dołączonym do subskrypcji. Pamięta zwolnienie,
 * więc ponowienie zdarzenia widzi stan PO nim - jak prawdziwy operator.
 * Ceny operatora to `price_<lookup_key>`; bieżąca faza niesie cenę sprzed
 * zmiany, następna - `nextPrice` (zaplanowana wcześniej zmiana).
 */
function stripeWithSchedule(o: {
  live: Record<string, unknown>;
  nextPrice: string;
  failedReleases?: number;
}) {
  const [item] = (o.live.items as { data: LiveItem[] }).data;
  const schedule = {
    id: SCHEDULE,
    object: "subscription_schedule",
    status: "active",
    subscription: SUB as string | null,
    metadata: {},
    current_phase: { start_date: item.current_period_start, end_date: item.current_period_end },
    phases: [
      {
        start_date: item.current_period_start,
        end_date: item.current_period_end,
        items: [{ price: "price_plus_monthly", quantity: 1 }],
      },
      { start_date: item.current_period_end, end_date: null, items: [{ price: o.nextPrice }] },
    ],
  };
  let failures = o.failedReleases ?? 0;
  const release = vi.fn(async (id: string, _params: unknown, _opts?: unknown) => {
    if (failures > 0) {
      failures -= 1;
      throw Object.assign(new Error("Too many requests"), { type: "StripeRateLimitError" });
    }
    if (id !== SCHEDULE || schedule.status !== "active")
      throw new Error("test: nie ten harmonogram");
    schedule.status = "released";
    schedule.subscription = null;
    return structuredClone(schedule);
  });
  const retrieve = vi.fn<StripeRetrieve>(async (id, params) => {
    if (id !== SUB) {
      throw Object.assign(new Error("No such subscription"), { code: "resource_missing" });
    }
    const expand = (params as { expand?: string[] } | undefined)?.expand ?? [];
    const attached = schedule.status === "active";
    return {
      ...structuredClone(o.live),
      schedule: attached
        ? expand.includes("schedule")
          ? structuredClone(schedule)
          : SCHEDULE
        : null,
    };
  });
  h.stripe.current = {
    subscriptions: { retrieve },
    subscriptionSchedules: { release },
    prices: { retrieve: async (id: string) => ({ id, lookup_key: id.replace(/^price_/, "") }) },
  } as unknown as typeof h.stripe.current;
  return { release, schedule };
}

describe("odrzucona dopłata opłacona później: pending_update_applied zwalnia sprzeczny harmonogram", () => {
  const start = relativeIso(-10 * DZIEN);
  const end = relativeIso(20 * DZIEN);
  const appliedAt = relativeIso(-1 * DZIEN);

  /** Plus z zaplanowaną wcześniej zmianą; upgrade do Pro odrzucony, a potem opłacony. */
  async function plusWithDeclinedUpgrade() {
    await deliver(
      "customer.subscription.created",
      stripeSubscription({
        status: "active",
        providerPriceId: "price_plus_monthly",
        periodStart: start,
        periodEnd: end,
      }),
      start,
    );
    return stripeSubscription({
      status: "active",
      priceKey: "pro_monthly",
      providerPriceId: "price_pro_monthly",
      periodStart: start,
      periodEnd: end,
    });
  }

  it("zaplanowany downgrade cofałby opłacony upgrade: zwolniony klientem środowiska zdarzenia, lustro na Pro", async () => {
    const applied = await plusWithDeclinedUpgrade();
    const stripe = stripeWithSchedule({ live: applied, nextPrice: "price_student_monthly" });

    const outcome = await deliver(
      "customer.subscription.pending_update_applied",
      { ...applied, schedule: SCHEDULE },
      appliedAt,
    );

    expect(outcome).toBe("processed");
    expect(stripe.release).toHaveBeenCalledTimes(1);
    expect(stripe.release.mock.calls[0]?.[0]).toBe(SCHEDULE);
    expect(stripe.release.mock.calls[0]?.[2]).toEqual({
      idempotencyKey: expect.stringMatching(/^nes-sub-schedule-release-[0-9a-f]{48}$/),
    });
    expect(stripe.schedule.status).toBe("released");
    expect(h.stripe.envs.length).toBeGreaterThan(0);
    expect(h.stripe.envs.every((env) => env === "live")).toBe(true);
    // To samo zdarzenie domyka lustro: opłacony plan, dostęp, znacznik.
    expect(subscriptionRow()).toMatchObject({ price_id: "pro_monthly", last_event_at: appliedAt });
    expect(entitlement()).toMatchObject({ plan_id: "plan-pro-monthly" });
    expect(grantsAccess(entitlement())).toBe(true);
  });

  it("zgodny harmonogram (od odnowienia Pro rocznie) zostaje, a lustro i tak przechodzi na Pro", async () => {
    const applied = await plusWithDeclinedUpgrade();
    const stripe = stripeWithSchedule({ live: applied, nextPrice: "price_pro_annual" });

    expect(
      await deliver(
        "customer.subscription.pending_update_applied",
        { ...applied, schedule: SCHEDULE },
        appliedAt,
      ),
    ).toBe("processed");

    expect(stripe.release).not.toHaveBeenCalled();
    expect(stripe.schedule.status).toBe("active");
    expect(subscriptionRow()?.price_id).toBe("pro_monthly");
  });

  it("odmowa operatora przy zwolnieniu: zdarzenie wraca do ponowienia (500), ponowienie zwalnia i domyka lustro", async () => {
    const applied = await plusWithDeclinedUpgrade();
    const stripe = stripeWithSchedule({
      live: applied,
      nextPrice: "price_student_monthly",
      failedReleases: 1,
    });
    const object = { ...applied, schedule: SCHEDULE };

    await expect(
      deliver("customer.subscription.pending_update_applied", object, appliedAt),
    ).rejects.toThrow(/Too many requests/);
    // Nic nie przepadło po cichu: harmonogram żyje, lustro bez zmian - a
    // znacznik strażnika nie jest zajęty, więc ponowienie przejdzie.
    expect(stripe.schedule.status).toBe("active");
    expect(subscriptionRow()?.price_id).toBe("plus_monthly");
    expect(subscriptionRow()?.last_event_at).not.toBe(appliedAt);

    // Operator ponawia TO SAMO zdarzenie (ten sam znacznik).
    expect(await deliver("customer.subscription.pending_update_applied", object, appliedAt)).toBe(
      "processed",
    );
    expect(stripe.release).toHaveBeenCalledTimes(2);
    expect(stripe.schedule.status).toBe("released");
    expect(subscriptionRow()).toMatchObject({ price_id: "pro_monthly", last_event_at: appliedAt });
  });

  it("migawka bez harmonogramu: bez pytania operatora - zwykła aktualizacja lustra", async () => {
    const applied = await plusWithDeclinedUpgrade();

    // `h.stripe.current` pusty: każde wywołanie operatora wywróciłoby test.
    expect(
      await deliver(
        "customer.subscription.pending_update_applied",
        { ...applied, schedule: null },
        appliedAt,
      ),
    ).toBe("processed");
    expect(subscriptionRow()?.price_id).toBe("pro_monthly");
    expect(grantsAccess(entitlement())).toBe(true);
  });

  it("wygasła oczekująca zmiana: stary plan i zaplanowana zmiana zostają, bez pytania operatora", async () => {
    await plusWithDeclinedUpgrade();
    const expired = stripeSubscription({
      status: "active",
      providerPriceId: "price_plus_monthly",
      periodStart: start,
      periodEnd: end,
      schedule: SCHEDULE,
    });

    await deliver("customer.subscription.pending_update_expired", expired, appliedAt);

    expect(subscriptionRow()).toMatchObject({ price_id: "plus_monthly", status: "active" });
    expect(grantsAccess(entitlement())).toBe(true);
  });
});

// =============================================================================
// Odrzucony upgrade przy dacie końca `cancel_at`, opłacony PÓŹNIEJ.
// =============================================================================

/** Faktura dopłaty, której zapłata zastosowała zmianę (identyfikator z migawki). */
const UPGRADE_INVOICE = "in_1SyntetycznaDoplata";

/**
 * Operator ze subskrypcją kończącą się datą `cancel_at` i opłaconą fakturą
 * dopłaty (`marker` = metadane zapisane przy odmowie, `paidAt` = chwila
 * zapłaty). Pamięta zdjęcie daty, więc ponowienie zdarzenia widzi stan PO nim
 * - jak prawdziwy operator.
 */
function stripeWithCancelDate(o: {
  live: Record<string, unknown>;
  marker: Record<string, string>;
  paidAt: string;
  failedUpdates?: number;
}) {
  const state = structuredClone(o.live);
  let failures = o.failedUpdates ?? 0;
  const retrieve = vi.fn<StripeRetrieve>(async (id) => {
    if (id !== SUB) {
      throw Object.assign(new Error("No such subscription"), { code: "resource_missing" });
    }
    return structuredClone(state);
  });
  const update = vi.fn(async (id: string, params: Record<string, unknown>, _opts?: unknown) => {
    if (failures > 0) {
      failures -= 1;
      throw Object.assign(new Error("Too many requests"), { type: "StripeRateLimitError" });
    }
    if (id !== SUB) throw new Error("test: nie ta subskrypcja");
    if (params.cancel_at === "") {
      state.cancel_at = null;
      state.canceled_at = null;
    }
    state.metadata = { ...(state.metadata as object), ...(params.metadata as object) };
    return structuredClone(state);
  });
  const invoices = {
    retrieve: vi.fn(async (id: string) => {
      if (id !== UPGRADE_INVOICE) {
        throw Object.assign(new Error("No such invoice"), { code: "resource_missing" });
      }
      return {
        id,
        object: "invoice",
        status: "paid",
        billing_reason: "subscription_update",
        parent: { subscription_details: { subscription: SUB } },
        status_transitions: { paid_at: unix(o.paidAt) },
        metadata: o.marker,
      };
    }),
  };
  h.stripe.current = {
    subscriptions: { retrieve, update },
    invoices,
  } as unknown as typeof h.stripe.current;
  return { retrieve, update, state };
}

describe("odrzucony upgrade przy dacie końca opłacony później: pending_update_applied zdejmuje datę", () => {
  const start = relativeIso(-10 * DZIEN);
  const end = relativeIso(20 * DZIEN);
  const cancelSetAt = relativeIso(-5 * DZIEN);
  const appliedAt = relativeIso(-1 * DZIEN);
  /** Data końca z portalu („anuluj z końcem okresu") i chwila jej ustawienia. */
  const dateEnd = { cancel_at: unix(end), canceled_at: unix(cancelSetAt) };
  /** Znacznik zapisany przy odmowie - stan z chwili prośby o upgrade. */
  const MARKER = {
    nes_upgrade_cancel_at: String(unix(end)),
    nes_upgrade_canceled_at: String(unix(cancelSetAt)),
    nes_upgrade_price: "price_pro_monthly",
  };

  /** Plus kończący się datą; upgrade do Pro odrzucony, a potem opłacony - migawka z chwili zastosowania. */
  async function plusEndingOnDate() {
    const plus = { providerPriceId: "price_plus_monthly", periodStart: start, periodEnd: end };
    await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "active", ...plus }),
      start,
    );
    await deliver(
      "customer.subscription.updated",
      { ...stripeSubscription({ status: "active", ...plus }), ...dateEnd },
      cancelSetAt,
    );
    expect(subscriptionRow()?.cancel_at_period_end).toBe(true);
    expect(entitlement()?.canceled_at).toBeTruthy();
    return {
      ...stripeSubscription({
        status: "active",
        priceKey: "pro_monthly",
        providerPriceId: "price_pro_monthly",
        periodStart: start,
        periodEnd: end,
        schedule: null,
      }),
      ...dateEnd,
      latest_invoice: UPGRADE_INVOICE,
    };
  }

  it("data z chwili prośby schodzi u operatora (klient środowiska zdarzenia); lustro: Pro, odnawia się", async () => {
    const applied = await plusEndingOnDate();
    const stripe = stripeWithCancelDate({ live: applied, marker: MARKER, paidAt: appliedAt });

    expect(await deliver("customer.subscription.pending_update_applied", applied, appliedAt)).toBe(
      "processed",
    );

    expect(stripe.update).toHaveBeenCalledTimes(1);
    expect(stripe.update).toHaveBeenCalledWith(
      SUB,
      { cancel_at: "", metadata: { nes_ops_rev: "1" } },
      { idempotencyKey: expect.stringMatching(/^nes-sub-cancel-at-clear-applied-[0-9a-f]{48}$/) },
    );
    expect(h.stripe.envs.length).toBeGreaterThan(0);
    expect(h.stripe.envs.every((env) => env === "live")).toBe(true);
    // Migawka wciąż niesie datę, ale lustro dostaje stan operatora PO zdjęciu:
    // bez „kończy się" i bez przycisku „Wznów" przy subskrypcji, która się odnowi.
    expect(subscriptionRow()).toMatchObject({
      price_id: "pro_monthly",
      cancel_at_period_end: false,
      last_event_at: appliedAt,
    });
    expect(entitlement()).toMatchObject({ plan_id: "plan-pro-monthly", canceled_at: null });
    expect(grantsAccess(entitlement())).toBe(true);
    expect(mails("subscription_upgraded")).toHaveLength(1);

    // Zdarzenie samego zdjęcia (nowszy znacznik): nic się nie dubluje.
    const clearedAt = new Date(Date.parse(appliedAt) + 5 * SEKUNDA).toISOString();
    expect(
      await deliver("customer.subscription.updated", structuredClone(stripe.state), clearedAt),
    ).toBe("processed");
    expect(subscriptionRow()).toMatchObject({
      cancel_at_period_end: false,
      last_event_at: clearedAt,
    });
    expect(entitlement()?.canceled_at).toBeNull();
    expect(mails("subscription_upgraded")).toHaveLength(1);
    expect(mails("subscription_canceled")).toHaveLength(0);
  });

  it.each([
    {
      name: "inna data ustawiona po odmowie",
      live: { cancel_at: unix(end) - 86_400, canceled_at: unix(relativeIso(-2 * DZIEN)) },
    },
    {
      name: "ta sama data ustawiona ponownie po odmowie (nowsze `canceled_at`)",
      live: { cancel_at: unix(end), canceled_at: unix(relativeIso(-2 * DZIEN)) },
    },
  ])("$name: data zostaje, lustro dalej „kończy się”", async ({ live }) => {
    const applied = { ...(await plusEndingOnDate()), ...live };
    const stripe = stripeWithCancelDate({ live: applied, marker: MARKER, paidAt: appliedAt });
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await deliver("customer.subscription.pending_update_applied", applied, appliedAt)).toBe(
      "processed",
    );

    expect(stripe.update).not.toHaveBeenCalled();
    expect(stripe.state).toMatchObject(live);
    expect(warned).toHaveBeenCalledWith(
      "[payments] pending update paid later, cancel date kept",
      "kept_changed",
      SUB,
      expect.any(String),
    );
    expect(subscriptionRow()).toMatchObject({
      price_id: "pro_monthly",
      cancel_at_period_end: true,
    });
    expect(entitlement()?.canceled_at).toBeTruthy();
    warned.mockRestore();
  });

  it("flaga „z końcem okresu” w migawce: bez pytania operatora - flaga jechała w oczekującej zmianie", async () => {
    const applied = { ...(await plusEndingOnDate()), cancel_at_period_end: true };

    // `h.stripe.current` pusty: każde wywołanie operatora wywróciłoby test.
    expect(await deliver("customer.subscription.pending_update_applied", applied, appliedAt)).toBe(
      "processed",
    );
    expect(subscriptionRow()).toMatchObject({
      price_id: "pro_monthly",
      cancel_at_period_end: true,
    });
  });

  it("odmowa operatora przy zdjęciu: zdarzenie wraca do ponowienia (500), ponowienie zdejmuje i domyka lustro", async () => {
    const applied = await plusEndingOnDate();
    const stripe = stripeWithCancelDate({
      live: applied,
      marker: MARKER,
      paidAt: appliedAt,
      failedUpdates: 1,
    });

    await expect(
      deliver("customer.subscription.pending_update_applied", applied, appliedAt),
    ).rejects.toThrow(/Too many requests/);
    // Nic nie przepadło po cichu: data jest, lustro bez zmian, znacznik strażnika wolny.
    expect(stripe.state.cancel_at).toBe(unix(end));
    expect(subscriptionRow()?.price_id).toBe("plus_monthly");
    expect(subscriptionRow()?.last_event_at).not.toBe(appliedAt);

    expect(await deliver("customer.subscription.pending_update_applied", applied, appliedAt)).toBe(
      "processed",
    );
    expect(stripe.update).toHaveBeenCalledTimes(2);
    expect(stripe.state.cancel_at).toBeNull();
    expect(subscriptionRow()).toMatchObject({
      price_id: "pro_monthly",
      cancel_at_period_end: false,
      last_event_at: appliedAt,
    });
  });

  it("ponowienie, gdy data już zeszła (zgubiona odpowiedź): bez drugiej mutacji, lustro bez „kończy się”", async () => {
    const applied = await plusEndingOnDate();
    const stripe = stripeWithCancelDate({
      live: { ...applied, cancel_at: null, canceled_at: null },
      marker: MARKER,
      paidAt: appliedAt,
    });

    expect(await deliver("customer.subscription.pending_update_applied", applied, appliedAt)).toBe(
      "processed",
    );

    expect(stripe.update).not.toHaveBeenCalled();
    expect(subscriptionRow()).toMatchObject({
      price_id: "pro_monthly",
      cancel_at_period_end: false,
    });
    expect(entitlement()?.canceled_at).toBeNull();
  });

  it("dostawa później niż okno ponowień operatora od zapłaty (naprawa z panelu): data zostaje, lustro „kończy się” jak u klienta", async () => {
    const applied = await plusEndingOnDate();
    // Klient zapłacił 5 dni temu; zdarzenie dociera dopiero teraz.
    const paidAt = relativeIso(-5 * DZIEN + 60 * SEKUNDA);
    const stripe = stripeWithCancelDate({ live: applied, marker: MARKER, paidAt });
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await deliver("customer.subscription.pending_update_applied", applied, paidAt)).toBe(
      "processed",
    );

    expect(stripe.update).not.toHaveBeenCalled();
    expect(stripe.state.cancel_at).toBe(unix(end));
    expect(warned).toHaveBeenCalledWith(
      "[payments] pending update paid later, cancel date kept",
      "kept_stale",
      SUB,
      expect.stringContaining(`"paidAt":${unix(paidAt)}`),
    );
    expect(subscriptionRow()).toMatchObject({
      price_id: "pro_monthly",
      cancel_at_period_end: true,
    });
    expect(entitlement()?.canceled_at).toBeTruthy();
    warned.mockRestore();
  });
});
