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
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
    rpc: (name: string, args?: Record<string, unknown>) => h.rpc.current!.rpc(name, args),
  },
}));

vi.mock("@/lib/stripe.server", () => ({
  getConnectionApiKey: () => "test_klucz_atrapy",
  getWebhookSecret: () => "test_sekret_atrapy",
  getStripeClient: () => {
    throw new Error("test: żaden przypadek nie ma prawa wołać operatora");
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

  db.setResponse(
    "subscriptions",
    table(subscriptions, {
      payment_failure_count: 0,
      last_dunning_transaction_id: null,
      last_payment_at: null,
      last_payment_failed_at: null,
      first_payment_failed_at: null,
      purchase_confirmed_at: null,
      last_event_at: null,
      tenant_id: BILLING_IDS.tenant,
    }),
  );
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
    items: {
      data: [
        {
          quantity: 1,
          current_period_start: unix(o.periodStart),
          current_period_end: unix(o.periodEnd),
          price: {
            id: "price_atrapa",
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
    parent: { subscription_details: { subscription: SUB, metadata: {} } },
    lines: { data: [] },
  };
}

/** Surowe zdarzenie Stripe -> normalizacja -> dyspozytor (jak trasa HTTP). */
async function deliver(type: string, object: Record<string, unknown>, at: string) {
  const event = { id: `evt_${type}_${at}`, type, created: unix(at), data: { object } };
  const normalized = normalizeStripeEvent(event as unknown as VerifiedWebhookEvent);
  if (!normalized) throw new Error(`test: zdarzenie ${type} poza zakresem integracji`);
  return dispatchWebhookEvent({
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
    const outcome = await deliver(
      "customer.subscription.created",
      stripeSubscription({ status: "incomplete", ...period }),
      created,
    );

    expect(outcome).toBe("skipped");
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
    expect(subscriptionRow()?.purchase_confirmed_at).toBeNull();

    expect(await deliver("customer.subscription.created", object, at)).toBe("processed");
    expect(grantsAccess(entitlement())).toBe(true);
    expect(mails("subscription_confirmed")).toHaveLength(1);
    expect(bells("Subskrypcja aktywna")).toHaveLength(1);

    // Powtórka po sukcesie niczego nie dubluje.
    expect(await deliver("customer.subscription.created", object, at)).toBe("skipped");
    expect(mails("subscription_confirmed")).toHaveLength(1);
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
    expect(await deliver("customer.subscription.created", object, at)).toBe("skipped");

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

    it("anulowanie za brak płatności zawiesza zespół", async () => {
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
      expect(organizations[0]?.status).toBe("suspended");
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
    await Promise.all([
      deliver("invoice.paid", stripeInvoice({ attempt: 2 }), paidAt),
      deliver("invoice.payment_succeeded", stripeInvoice({ attempt: 2 }), paidAt),
    ]);

    expect(mails("payment_recovered")).toHaveLength(1);
    expect(bells("Płatność zaksięgowana")).toHaveLength(1);
    expect(subscriptionRow()).toMatchObject({
      payment_failure_count: 0,
      first_payment_failed_at: null,
    });
  });

  it("spóźniona porażka próby, po której płatność już przeszła, nie otwiera nowego cyklu", async () => {
    await activeSubscription();
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
