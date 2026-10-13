// ZWROT PIENIĘDZY I SPÓR PŁATNICZY - 5,1% linii i 9% gałęzi do 31.08.2026,
// 111 linii bez żadnego testu. To najdroższa nieprzetestowana ścieżka w tym
// repo: zwrot jest NIEODWRACALNY, a jego skutki rozchodzą się na pięć tabel
// naraz (zamówienie, uprawnienie, zgłoszenie na wydarzenie, dzwonek, CRM).
//
// CO TEN PLIK MIERZY - ŚCIEŻKĘ PIENIĘDZY, NIE ŚCIEŻKĘ SZCZĘŚLIWĄ:
//   * zwrot pełny / częściowy / przekraczający kwotę zamówienia,
//   * korektę, która NIE odbiera dostępu (kredyt, wniosek, odrzucenie),
//   * ponowione dostarczenie tego samego zwrotu (idempotencja),
//   * transakcję nieznaną, darowiznę, zamówienie bez właściciela,
//   * spór otwarty (dostęp znika od razu) i wygrany (dostęp wraca),
//   * awarię KAŻDEGO zapisu z osobna - i to, CO ZOSTAJE W BAZIE po awarii.
//
// GRANICA ATRAP - ŚWIADOMIE WĄSKA. Podmienione są WYŁĄCZNIE granice systemu:
// klient Supabase (rola serwisowa), wysyłka poczty i klient operatora
// (cel zwrotu spoza własnej bazy: faktura subskrypcji, sesja Checkout -
// PAY-04 / PAY-07). Sąsiednie moduły
// rozliczeń (`grant.server`, `purchaseEffects.server`, `notifications.server`,
// `entitlementSync.server`, `oneTimeFulfilment.server`, `catalog`) biegną
// PRAWDZIWE. To kosztuje więcej pracy przy planowaniu odpowiedzi bazy, ale
// tylko tak test dowodzi, że zwrot NAPRAWDĘ odbiera uprawnienie czytane przez
// `has_content_access()` - atrapa `grant.server` dowodziłaby wyłącznie tego,
// że wywołano atrapę.
//
// RODO: wszystkie adresy są syntetyczne i leżą w `example.com`.
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { Tables } from "@/integrations/supabase/types";
import {
  BILLING_IDS,
  fail,
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
} from "@/test/billing/fixtures";

const h = vi.hoisted(() => ({
  db: { current: null as { from: (table: string) => unknown } | null },
  rpc: {
    calls: [] as { fn: string; args: Record<string, unknown> }[],
    error: null as { message: string } | null,
  },
  emails: [] as unknown[],
  stripe: {
    envs: [] as string[],
    /** Płatności faktur zwracane przez `invoicePayments.list` (PAY-04). */
    invoicePayments: [] as Array<Record<string, unknown>>,
    /** Sesje zwracane przez `checkout.sessions.list` (PAY-07). */
    sessions: [] as Array<Record<string, unknown>>,
    /**
     * Obciążenie płatności (`paymentIntents.retrieve` + `latest_charge`) -
     * stan zwrotów u operatora (S2, 2.11). `null` = płatność nieznana (404).
     */
    charge: null as Record<string, unknown> | null,
    /** Spory po identyfikatorze (`disputes.retrieve`, S2); brak = 404. */
    disputes: new Map<string, Record<string, unknown>>(),
    /** Subskrypcja u operatora (`subscriptions.retrieve`, S1); `null` = 404. */
    subscription: null as Record<string, unknown> | null,
    calls: [] as string[],
    /** Awaria operatora (sieć, 5xx) - każde wywołanie rzuca. */
    failure: null as Error | null,
  },
}));

/** Odpowiedź operatora „nie ma takiego zasobu" (404) - ostateczna, bez ponowień. */
function missing(): Error {
  return Object.assign(new Error("No such resource"), {
    statusCode: 404,
    code: "resource_missing",
  });
}

// GRANICA 1: klient roli serwisowej. `rpc` jest tu, bo pełny zwrot biletu
// przelicza status zgłoszenia funkcją bazodanową, a nie zapytaniem.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpc.calls.push({ fn, args });
      return Promise.resolve({ data: null, error: h.rpc.error });
    },
  },
}));

// GRANICA 3: operator płatności. Zwrot, którego nie zna własna baza, pyta
// operatora o fakturę płatności (subskrypcja, PAY-04) i o sesję Checkout
// (zwrot przed realizacją, PAY-07). Domyślnie operator nie zna niczego.
vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: async (env: string) => {
    h.stripe.envs.push(env);
    return {
      charges: { retrieve: async (id: string) => ({ id, payment_intent: null }) },
      invoicePayments: {
        list: async () => {
          h.stripe.calls.push("invoicePayments.list");
          if (h.stripe.failure) throw h.stripe.failure;
          return { data: h.stripe.invoicePayments };
        },
      },
      invoices: { retrieve: async (id: string) => ({ id }) },
      checkout: {
        sessions: {
          list: async () => {
            h.stripe.calls.push("checkout.sessions.list");
            return { data: h.stripe.sessions };
          },
        },
      },
      paymentIntents: {
        retrieve: async (id: string) => {
          h.stripe.calls.push("paymentIntents.retrieve");
          if (h.stripe.failure) throw h.stripe.failure;
          if (!h.stripe.charge) throw missing();
          return { id, latest_charge: { id: `ch_${id}`, ...h.stripe.charge } };
        },
      },
      disputes: {
        retrieve: async (id: string) => {
          h.stripe.calls.push("disputes.retrieve");
          if (h.stripe.failure) throw h.stripe.failure;
          const dispute = h.stripe.disputes.get(id);
          if (!dispute) throw missing();
          return dispute;
        },
      },
      subscriptions: {
        retrieve: async (id: string) => {
          h.stripe.calls.push("subscriptions.retrieve");
          if (h.stripe.failure) throw h.stripe.failure;
          if (!h.stripe.subscription) throw missing();
          return { id, ...h.stripe.subscription };
        },
      },
    };
  },
}));

// GRANICA 2: poczta. Reszta `transactional.server` (formatowanie kwot i dat,
// które trafia do treści maila o zwrocie) zostaje prawdziwa.
vi.mock("@/lib/email/transactional.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/transactional.server")>(
    "@/lib/email/transactional.server",
  );
  return {
    ...actual,
    sendTxEmail: (message: unknown) => {
      h.emails.push(message);
      return Promise.resolve({ ok: true });
    },
  };
});

import { applyRefundEffects, type RefundEvent } from "@/lib/billing/refunds.server";
import { DZIEN, freezeClock, relativeIso } from "@/test/time";

// Reguła S1 („okres faktury minął") porównuje z zegarem - plik ma jedno „teraz".
freezeClock();

/** Sekundy uniksowe względem zamrożonego „teraz" - kształt pól okresu Stripe. */
function unixAt(offsetMs: number): number {
  return Math.floor(Date.parse(relativeIso(offsetMs)) / 1000);
}

/** Subskrypcja u operatora w kształcie API Basil (okres na pozycji). */
function remoteSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "active",
    metadata: { userId: "user-me" },
    items: {
      data: [
        {
          current_period_start: unixAt(-5 * DZIEN),
          current_period_end: unixAt(25 * DZIEN),
          price: {
            id: "price_plus",
            lookup_key: "plus_monthly",
            product: { id: "prod_plus", metadata: { lovable_external_id: "plus" } },
          },
        },
      ],
    },
    ...overrides,
  };
}

/** Obciążenie bez zwrotów (domyślny stan płatności u operatora). */
function chargeState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    amount: 4900,
    amount_refunded: 0,
    refunded: false,
    disputed: false,
    currency: "pln",
    ...overrides,
  };
}

// --- atomy sceny ------------------------------------------------------------

/** Wiersz `payment_orders` w kształcie czytanym przez zwrot i przez spór. */
type OrderRow = Pick<
  Tables<"payment_orders">,
  | "id"
  | "user_id"
  | "tenant_id"
  | "plan_id"
  | "kind"
  | "entity_type"
  | "entity_id"
  | "metadata"
  | "amount_cents"
  | "refunded_amount_cents"
  | "currency"
  // `status` czyta bramka powtórzonego zwrotu (patrz DEFEKT 2 na końcu pliku).
  | "status"
>;

/** Wiersz `subscriptions` (operatorski) czytany przez obie ścieżki. */
type SubscriptionRow = Pick<
  Tables<"subscriptions">,
  "user_id" | "tenant_id" | "price_id" | "status" | "current_period_end"
>;

const TXN = "pi_1SyntetycznaTransakcja";
/** Identyfikator zamówienia w kształcie UUID - tak zapisuje go `metadata.orderId` sesji. */
const ORDER_UUID = "33333333-cccc-4ccc-8ccc-333333333333";
const SUB = "sub_1SyntetycznaSubskrypcja";
const EVENT_ID = "44444444-4444-4444-4444-444444444444";

function orderRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: BILLING_IDS.order,
    user_id: BILLING_IDS.me,
    tenant_id: BILLING_IDS.tenant,
    plan_id: "plan-member-monthly",
    kind: "subscription",
    entity_type: null,
    entity_id: null,
    metadata: {},
    amount_cents: 4900,
    refunded_amount_cents: 0,
    currency: "PLN",
    status: "paid",
    ...overrides,
  };
}

function subscriptionRow(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    user_id: BILLING_IDS.me,
    // Najemca subskrypcji: zawęża plan (`resolvePlanForPrice`) i adresatów
    // alertu o sporze (`notifyTenantAdmins`).
    tenant_id: BILLING_IDS.tenant,
    // `plus_monthly` jest w `BILLING_CATALOG` - bez wpisu katalogowego plan
    // nie rozwiąże się i połowa skutków zwrotu przestaje istnieć.
    price_id: "plus_monthly",
    status: "active",
    current_period_end: "2026-09-18T10:00:00.000Z",
    ...overrides,
  };
}

function refundEvent(overrides: Partial<RefundEvent> = {}): RefundEvent {
  return {
    adjustmentId: "adj_1Syntetyczna",
    transactionId: TXN,
    subscriptionId: null,
    action: "refund",
    status: "approved",
    amountCents: 4900,
    capturedAmountCents: 4900,
    currency: "PLN",
    environment: "sandbox",
    ...overrides,
  };
}

/** Stan bazy dla jednego testu - podmieniany polami, nie całymi atrapami. */
interface Scene {
  order: OrderRow | null;
  subscription: SubscriptionRow | null;
  /** Ile wierszy `user_subscriptions` faktycznie odebrano (`select("id")`). */
  revokedEntitlements: { id: string }[];
  /** Uprawnienie odczytane przy przywracaniu dostępu (`maybeSingle`). */
  existingEntitlement: { id: string; status: string; canceled_at?: string | null } | null;
  /** Darowizny zmienione przez zwrot. */
  refundedDonations: { id: string }[];
  /** Najemca darowizny odczytany przez alert o sporze (`maybeSingle`). */
  donationTenant: string | null;
  admins: { user_id: string }[];
  adminProfiles: { id: string; tenant_id: string | null }[];
}

let db: SupabaseFromStub;
let scene: Scene;

function seed(): void {
  db.setResponse("payment_orders", (chain) => {
    if (chain.has("update")) return ok(null);
    // Odebranie i przywrócenie dostępu czytają zamówienie TĄ SAMĄ funkcją
    // (`findOrderForAdjustment`), czyli listą z `.limit(1)`. Gałąź
    // `maybeSingle` zostaje dla atrap, które nadal pytają pojedynczym wierszem.
    if (chain.has("maybeSingle")) return ok(scene.order);
    return ok(scene.order ? [scene.order] : []);
  });
  db.setResponse("subscriptions", () => ok(scene.subscription));
  db.setResponse("user_subscriptions", (chain) => {
    if (chain.has("maybeSingle")) return ok(scene.existingEntitlement);
    if (chain.has("select")) return ok(scene.revokedEntitlements);
    return ok(null);
  });
  db.setResponse("user_purchases", () => ok(null));
  db.setResponse("donations", (chain) =>
    // Alert o sporze pyta o najemcę darowizny pojedynczym wierszem; zwrot
    // zapisuje status i czyta zmienione wiersze listą.
    chain.has("maybeSingle")
      ? ok(scene.donationTenant ? { tenant_id: scene.donationTenant } : null)
      : ok(scene.refundedDonations),
  );
  db.setResponse("event_rsvps", () => ok(null));
  db.setResponse("notifications", () => ok(null));
  db.setResponse("user_roles", () => ok(scene.admins));
  db.setResponse("profiles", (chain) =>
    // Alert dla zespołu czyta profile administratorów listą (`.in`),
    // reszta ścieżek - jeden profil odbiorcy maila / kontaktu CRM.
    chain.has("in")
      ? ok(scene.adminProfiles)
      : ok({
          id: BILLING_IDS.me,
          email: "klient@example.com",
          first_name: "Klient",
          last_name: "Testowy",
          display_name: "Klient Testowy",
          tenant_id: BILLING_IDS.tenant,
          prefs: { language: "pl" },
        }),
  );
  db.setResponse("access_plans", () =>
    ok({
      id: "plan-member-monthly",
      tenant_id: BILLING_IDS.tenant,
      price_cents: 4900,
      currency: "PLN",
      interval: "month",
      name_pl: "Członek",
      name_en: "Member",
    }),
  );
  db.setResponse("crm_leads", () => ok(null));
  db.setResponse("newsletter_subscribers", () => ok(null));
}

// --- odczyt tego, co atrapa zapisała ---------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Wszystkie łatki `update` wysłane na tabelę, w kolejności. */
function patches(table: string): Record<string, unknown>[] {
  return db
    .chainsFor(table)
    .map((chain) => chain.argsOf("update")?.[0])
    .filter(isRecord);
}

/** Wszystkie wiersze `insert` (także wsadowe) wysłane na tabelę. */
function inserted(table: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const chain of db.chainsFor(table)) {
    const payload = chain.argsOf("insert")?.[0];
    if (Array.isArray(payload)) rows.push(...payload.filter(isRecord));
    else if (isRecord(payload)) rows.push(payload);
  }
  return rows;
}

/** Filtry `eq`/`neq` zapisane w łańcuchu, jako pary [kolumna, wartość]. */
function filters(table: string, method: "eq" | "neq"): unknown[][] {
  return db
    .chainsFor(table)
    .flatMap((chain) => chain.calls.filter((call) => call.method === method))
    .map((call) => [...call.args]);
}

/** Filtry `or(...)` zapisane na tabeli - tekst warunku PostgREST. */
function orFilters(table: string): string[] {
  return db
    .chainsFor(table)
    .map((chain) => chain.argsOf("or")?.[0])
    .filter((value): value is string => typeof value === "string");
}

/** Dzwonki administratorów - `notifyTenantAdmins` wstawia je przez RPC. */
function adminBells(): Record<string, unknown>[] {
  return h.rpc.calls.filter((call) => call.fn === "enqueue_notification").map((call) => call.args);
}

/** Najemca, w którym alert o sporze szukał administratorów (`user_roles`). */
function alertTenants(): unknown[] {
  return db
    .chainsFor("user_roles")
    .flatMap((chain) => chain.calls.filter((call) => call.method === "eq"))
    .filter((call) => call.args[0] === "tenant_id")
    .map((call) => call.args[1]);
}

/** Wiadomości oddane granicy pocztowej. */
function emails(): Record<string, unknown>[] {
  return h.emails.filter(isRecord);
}

beforeEach(() => {
  db = supabaseFromStub();
  h.db.current = { from: (table: string) => db.from(table) };
  h.rpc.calls.length = 0;
  h.rpc.error = null;
  h.emails.length = 0;
  h.stripe.envs.length = 0;
  h.stripe.calls.length = 0;
  h.stripe.invoicePayments = [];
  h.stripe.sessions = [];
  h.stripe.charge = chargeState();
  h.stripe.disputes.clear();
  h.stripe.subscription = remoteSubscription();
  h.stripe.failure = null;
  scene = {
    order: orderRow(),
    subscription: null,
    revokedEntitlements: [{ id: "us-1" }],
    existingEntitlement: null,
    refundedDonations: [],
    donationTenant: null,
    admins: [],
    adminProfiles: [],
  };
  seed();
});

describe("applyRefundEffects - korekty, które NIE odbierają dostępu", () => {
  it.each(["credit", "other"] as const)(
    "korekta `%s` nie dotyka ani zamówienia, ani uprawnienia",
    async (action) => {
      // Kredyt to nota, nie oddanie pieniędzy. Odebranie za nią dostępu byłoby
      // karą za rabat.
      const outcome = await applyRefundEffects(refundEvent({ action }));

      expect(outcome).toBe("skipped");
      expect(db.chains).toHaveLength(0);
    },
  );

  it.each(["pending_approval", "rejected", "reversed"])(
    "zwrot w stanie `%s` czeka albo nie doszedł do skutku",
    async (status) => {
      // Odebranie dostępu na sam WNIOSEK o zwrot to utrata klienta bez zwrotu
      // pieniędzy. `rejected`/`reversed` znaczą, że pieniądze zostały u nas.
      const outcome = await applyRefundEffects(refundEvent({ status }));

      expect(outcome).toBe("skipped");
      expect(db.chains).toHaveLength(0);
    },
  );

  it("korekta bez transakcji i bez subskrypcji jest logowana, nie zgadywana", async () => {
    // Nie mamy w co trafić. Zgadywanie „po kwocie" albo „po ostatnim
    // zamówieniu" odebrałoby dostęp przypadkowej osobie.
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = await applyRefundEffects(
      refundEvent({ transactionId: null, subscriptionId: null }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chains).toHaveLength(0);
    expect(warnLog).toHaveBeenCalled();
    warnLog.mockRestore();
  });

  it("identyfikator transakcji o obcym kształcie NIE trafia do filtra `or(...)`", async () => {
    // Identyfikator wchodzi do filtra PostgREST jako tekst. Przecinek albo
    // nawias mogłyby rozszerzyć zapytanie na cudze zamówienia, więc kształt
    // jest bramkowany PRZED zapytaniem - i to jest tu przedmiotem testu.
    const outcome = await applyRefundEffects(
      refundEvent({ transactionId: "pi_1,provider_intent_id.eq.cudze" }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("transakcja wyzerowana W TRAKCIE przetwarzania nie zmienia celu korekty ani nie daje filtra z `null`", async () => {
    // Obiekt zdarzenia zmieniony przez wołającego po wywołaniu (np. używany
    // dalej) nie może skończyć się filtrem z `null`. Korekta pracuje na KOPII
    // z wejścia: cel, alert i skutek widzą te same identyfikatory, więc zwrot
    // trafia w zamówienie wskazane w chwili wywołania.
    const event = refundEvent();
    const pending = applyRefundEffects(event);
    event.transactionId = null;

    expect(await pending).toBe("order_refunded");
    const orFilters = db
      .chainsFor("payment_orders")
      .flatMap((chain) => chain.calls.filter((call) => call.method === "or"))
      .map((call) => String(call.args[0]));
    expect(orFilters.every((filter) => filter.includes(TXN) && !filter.includes("null"))).toBe(
      true,
    );
  });

  it("subskrypcja wyzerowana W TRAKCIE przetwarzania nie daje odebrania po pustym `external_ref`", async () => {
    // To samo okno w `revokeSubscription`: `eq(..., null)` odebrałoby dostęp
    // po pustym kluczu. Kopia z wejścia trzyma subskrypcję z chwili wywołania.
    const event = refundEvent({ transactionId: null, subscriptionId: SUB });
    const pending = applyRefundEffects(event);
    event.subscriptionId = null;

    expect(await pending).toBe("subscription_refunded");
    expect(filters("user_subscriptions", "eq")).toEqual([["external_ref", SUB]]);
  });
});

describe("zwrot PEŁNY zamówienia - dostęp znika natychmiast", () => {
  it("oznacza zamówienie, odbiera uprawnienie, pisze mail i dzwonek", async () => {
    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");

    // 1. Źródło płatności.
    expect(patches("payment_orders")[0]).toMatchObject({
      status: "refunded",
      refunded_amount_cents: 4900,
    });
    expect(filters("payment_orders", "eq")).toContainEqual(["id", BILLING_IDS.order]);
    // Bez tego filtra ponowione zdarzenie nadpisywałoby zamknięty zwrot.
    expect(filters("payment_orders", "neq")).toContainEqual(["status", "refunded"]);

    // 2. Uprawnienie czytane przez `has_content_access()`.
    const entitlement = patches("user_subscriptions")[0];
    expect(entitlement).toMatchObject({ status: "refunded" });
    expect(filters("user_subscriptions", "eq")).toContainEqual(["external_ref", BILLING_IDS.order]);

    // 3. Mail o zwrocie, kluczowany identyfikatorem korekty (idempotencja).
    expect(emails()[0]).toMatchObject({
      type: "payment_refunded",
      to: "klient@example.com",
      idempotencyKey: "payment_refunded:adj_1Syntetyczna",
    });

    // 4. Dzwonek w aplikacji, w przestrzeni najemcy zamówienia.
    expect(inserted("notifications")[0]).toMatchObject({
      user_id: BILLING_IDS.me,
      tenant_id: BILLING_IDS.tenant,
      kind: "billing",
      title_pl: "Zwrot płatności",
      // Spec B.7: ikona z listy kuratorskiej (`receipt` ładował rejestr 109 KB).
      icon: "credit-card",
    });
  });

  it("dostęp kończy się TERAZ, a nie z końcem opłaconego okresu", async () => {
    // Decyzja produktowa z nagłówka modułu. Gdyby `current_period_end` został
    // datą z przyszłości, klient miałby pieniądze i treść jednocześnie.
    const before = Date.now();

    await applyRefundEffects(refundEvent());

    const entitlement = patches("user_subscriptions")[0];
    const periodEnd = Date.parse(String(entitlement.current_period_end));
    expect(periodEnd).toBeGreaterThanOrEqual(before);
    expect(periodEnd).toBeLessThanOrEqual(Date.now());
    expect(entitlement.canceled_at).toBe(entitlement.current_period_end);
  });

  it("zwrot zakupu jednorazowego odbiera `user_purchases`, nie subskrypcję", async () => {
    // Odblokowanie pojedynczej treści żyje w innej tabeli. Pomyłka tutaj
    // zostawiłaby opłaconą treść otwartą po oddaniu pieniędzy.
    scene.order = orderRow({ kind: "one_time", entity_type: "post", entity_id: "post-1" });

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(patches("user_purchases")[0]).toMatchObject({ status: "refunded" });
    expect(filters("user_purchases", "eq")).toEqual([
      ["user_id", BILLING_IDS.me],
      ["entity_type", "post"],
      ["entity_id", "post-1"],
    ]);
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
  });

  it.each(["chargeback_warning", "chargeback"] as const)(
    "2.4: spór (`%s`) NIE wysyła klientowi maila ani dzwonka „Płatność została zwrócona”",
    async (action) => {
      // Spór to nie zwrot. Potwierdzenie zwrotu przy otwarciu sporu (także
      // przy zapytaniu banku, gdy żadne środki nie ruszyły) klient mógł
      // przekazać bankowi jako dowód przeciwko nam, a po wygranej obiecywało
      // pieniądze, które nigdy nie przyszły.
      scene.order = orderRow();

      const outcome = await applyRefundEffects(refundEvent({ action, status: null }));

      expect(outcome).toBe("order_refunded");
      expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
      expect(emails()).toHaveLength(0);
      expect(inserted("notifications")).toHaveLength(0);
    },
  );

  it("zamówienie po ANONIMIZACJI konta nadal się księguje, ale nikogo nie zawiadamia", async () => {
    // `user_id` NULL = konto usunięte, zamówienie żyje jako dowód księgowy.
    // Nie ma komu wysłać maila ani odebrać uprawnienia - ale status musi się
    // zgadzać z księgami.
    scene.order = orderRow({ user_id: null });

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(emails()).toHaveLength(0);
    expect(inserted("notifications")).toHaveLength(0);
  });
});

describe("zwrot CZĘŚCIOWY - korekta ceny, nie rezygnacja", () => {
  it("nie zmienia statusu zamówienia i NIE odbiera uprawnienia", async () => {
    scene.order = orderRow({ amount_cents: 9900 });

    const outcome = await applyRefundEffects(
      refundEvent({ amountCents: 3000, capturedAmountCents: 9900 }),
    );

    expect(outcome).toBe("order_refunded");
    const patch = patches("payment_orders")[0];
    expect(patch.refunded_amount_cents).toBe(3000);
    // Kluczowa asercja: BRAK klucza `status` w łatce.
    expect(patch).not.toHaveProperty("status");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(db.chainsFor("user_purchases")).toHaveLength(0);
    expect(emails()).toHaveLength(0);
    expect(inserted("notifications")).toHaveLength(0);
  });

  it("bilet: miejsce ZOSTAJE, a przeliczenie robi baza", async () => {
    // Zwrot części ceny nie zwalnia miejsca na wydarzeniu - próg „miejsce
    // wraca do puli" ma jedno miejsce w systemie i jest nim funkcja bazowa.
    scene.order = orderRow({ amount_cents: 9900, metadata: { event_id: EVENT_ID } });

    await applyRefundEffects(refundEvent({ amountCents: 3000, capturedAmountCents: 9900 }));

    expect(h.rpc.calls).toEqual([
      {
        fn: "payments_apply_event_ticket_outcome",
        args: {
          p_order_id: BILLING_IDS.order,
          p_outcome: "partial_refund",
          p_refunded_cents: 3000,
        },
      },
    ]);
    // Zgłoszenie nie jest anulowane - uczestnik nadal ma wejście.
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
  });

  it("kwota RÓWNA pobranej to już zwrot pełny", async () => {
    // Próg jest ostry: `refundedSoFar < captured`. Równość musi odebrać dostęp,
    // inaczej pełny zwrot zapisany jako dwa równe raty zostawiłby uprawnienie.
    scene.order = orderRow({ amount_cents: 9900 });

    await applyRefundEffects(refundEvent({ amountCents: 9900, capturedAmountCents: 9900 }));

    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
  });

  it("korekta BEZ KWOTY jest traktowana jak zwrot pełny", async () => {
    // Brak wiedzy o kwocie to nie powód do zostawienia dostępu. Bezpieczniej
    // odebrać uprawnienie niż zostawić opłaconą treść po oddaniu pieniędzy.
    await applyRefundEffects(refundEvent({ amountCents: null, capturedAmountCents: null }));

    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
  });

  it("nieznana kwota pobrana (zero) też schodzi na zwrot pełny", async () => {
    await applyRefundEffects(refundEvent({ amountCents: 3000, capturedAmountCents: 0 }));

    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
  });

  it("OBCIĄŻENIE ZWROTNE nigdy nie jest częściowe", async () => {
    // Bank wycofuje środki w całości sporu, nawet gdy kwota jest niższa niż
    // obciążenie. Potraktowanie tego jak korekty ceny zostawiłoby dostęp
    // osobie, która zakwestionowała płatność.
    scene.order = orderRow({ amount_cents: 9900 });

    await applyRefundEffects(
      refundEvent({ action: "chargeback", amountCents: 3000, capturedAmountCents: 9900 }),
    );

    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
  });
});

describe("IDEMPOTENCJA licznika zwrotów", () => {
  it("spóźnione zdarzenie z NIŻSZĄ kwotą nie cofa licznika", async () => {
    // Operator liczy zwroty narastająco, ale zdarzenia potrafią dojść nie po
    // kolei. Zapisanie niższej wartości „odzwracałoby" część pieniędzy
    // w naszych księgach.
    scene.order = orderRow({ amount_cents: 9900, refunded_amount_cents: 9900 });

    await applyRefundEffects(refundEvent({ amountCents: 3000, capturedAmountCents: 9900 }));

    expect(patches("payment_orders")[0].refunded_amount_cents).toBe(9900);
  });

  it("dwie raty częściowe składają się na zwrot pełny bez sumowania po naszej stronie", async () => {
    scene.order = orderRow({ amount_cents: 9900, refunded_amount_cents: 0 });
    await applyRefundEffects(refundEvent({ amountCents: 4950, capturedAmountCents: 9900 }));
    expect(patches("payment_orders")[0]).not.toHaveProperty("status");

    db = supabaseFromStub();
    h.db.current = { from: (table: string) => db.from(table) };
    scene.order = orderRow({ amount_cents: 9900, refunded_amount_cents: 4950 });
    seed();

    await applyRefundEffects(
      refundEvent({ adjustmentId: "adj_2", amountCents: 9900, capturedAmountCents: 9900 }),
    );

    expect(patches("payment_orders")[0]).toMatchObject({
      status: "refunded",
      refunded_amount_cents: 9900,
    });
  });
});

describe("wiersze z PUSTYMI kwotami - bezpieczniki `??` w liczeniu zwrotu", () => {
  // Kolumny kwot są dziś NOT NULL, ale PostgREST oddaje to, co leży w bazie,
  // a wiersze sprzed ograniczeń i ręczne poprawki potrafią nieść NULL. Zwrot
  // nie może się na nich wywrócić ani policzyć czegoś, czego nie ma.
  const EMPTY = null as unknown as number;

  it("brak kwoty obciążenia i licznika: zwrot liczy się od zera, bez „już rozliczone”", async () => {
    scene.order = orderRow({ amount_cents: EMPTY, refunded_amount_cents: EMPTY });

    const outcome = await applyRefundEffects(
      refundEvent({ amountCents: 2000, capturedAmountCents: undefined }),
    );

    expect(outcome).toBe("order_refunded");
    expect(patches("payment_orders")[0]).toMatchObject({ refunded_amount_cents: 2000 });
  });

  it("pusty licznik przy znanym obciążeniu: powtórka BEZ nowych pieniędzy to `skipped`", async () => {
    // Licznik NULL czytamy jak zero - wiec zdarzenie bez kwoty nie przynosi
    // pieniedzy, a zamowienie juz „refunded" nie jest zapisywane drugi raz.
    scene.order = orderRow({ status: "refunded", refunded_amount_cents: EMPTY });

    const outcome = await applyRefundEffects(refundEvent({ amountCents: 0 }));

    expect(outcome).toBe("skipped");
  });

  it("pusty licznik przy znanym obciążeniu i nowej kwocie: zwrot przechodzi", async () => {
    scene.order = orderRow({ refunded_amount_cents: EMPTY });

    const outcome = await applyRefundEffects(refundEvent({ amountCents: 4900 }));

    expect(outcome).toBe("order_refunded");
    expect(patches("payment_orders")[0]).toMatchObject({ refunded_amount_cents: 4900 });
  });
});

describe("BILET na wydarzenie - zwrot cofa udział", () => {
  it("pełny zwrot anuluje zgłoszenie i zwalnia miejsce", async () => {
    scene.order = orderRow({ metadata: { event_id: EVENT_ID } });

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    // D0-1: pisownia z CHECK `event_rsvps.status` - `canceled` łamało ograniczenie.
    expect(patches("event_rsvps")[0]).toMatchObject({ status: "cancelled" });
    expect(patches("event_rsvps")[0]).not.toMatchObject({ status: "canceled" });
    expect(filters("event_rsvps", "eq")).toEqual([
      ["event_id", EVENT_ID],
      ["user_id", BILLING_IDS.me],
    ]);
    expect(h.rpc.calls[0]).toMatchObject({
      fn: "payments_apply_event_ticket_outcome",
      args: { p_outcome: "refunded" },
    });
  });

  it("status anulowanego udziału to wartość dozwolona przez CHECK tabeli", async () => {
    // Była tu literówka „canceled": CHECK `event_rsvps_status_check` jej nie
    // dopuszcza, więc KAŻDY pełny zwrot biletu rzucał przed
    // `payments_apply_event_ticket_outcome` - webhook ponawiał w nieskończoność,
    // a zgłoszenie zostawało opłacone, goście przyjęci i kolejka nieruszona.
    // Test czyta NAJNOWSZĄ definicję CHECK-a z migracji, a nie jej kopię.
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "supabase", "migrations");
    const pattern = /ADD CONSTRAINT event_rsvps_status_check\s+CHECK \(status IN \(([^)]*)\)\)/g;
    const checks = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .flatMap((name) => [...readFileSync(join(dir, name), "utf8").matchAll(pattern)])
      .map((match) => match[1]);
    expect(checks.length).toBeGreaterThan(0);
    const allowed = [...(checks.at(-1) as string).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    scene.order = orderRow({ metadata: { event_id: EVENT_ID } });

    await applyRefundEffects(refundEvent());

    expect(allowed).toContain(patches("event_rsvps")[0].status);
  });

  it("zamówienie związane ze zgłoszeniem nie anuluje RSVP samo - robi to baza po zastosowaniu zwrotu", async () => {
    // Zwrot nadliczbowej wpłaty (`refund_for_other_order`) zostawia ważny
    // bilet opłacony innym zamówieniem. Anulowanie RSVP przed decyzją bazy
    // rozjechałoby się z tym biletem.
    scene.order = orderRow({
      metadata: { event_id: EVENT_ID, registration_id: "reg-bound-1" },
    });

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
    expect(h.rpc.calls[0]).toMatchObject({
      fn: "payments_apply_event_ticket_outcome",
      args: { p_outcome: "refunded" },
    });
  });

  it("pusty `registration_id` traktujemy jak zamówienie starszej ścieżki", async () => {
    scene.order = orderRow({ metadata: { event_id: EVENT_ID, registration_id: "" } });

    await applyRefundEffects(refundEvent());

    expect(patches("event_rsvps")[0]).toMatchObject({ status: "cancelled" });
  });

  it("bilet zanonimizowanego konta zwalnia miejsce, ale nie rusza cudzych zgłoszeń", async () => {
    // Bez `user_id` filtr `event_rsvps` obejmowałby WSZYSTKIE zgłoszenia na
    // wydarzenie. Miejsce i tak musi wrócić do puli - i wraca, przez bazę.
    scene.order = orderRow({ user_id: null, metadata: { event_id: EVENT_ID } });

    await applyRefundEffects(refundEvent());

    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
    expect(h.rpc.calls).toHaveLength(1);
  });

  it("metadane `null` (jsonb 'null') to zwykły zakup: dostęp znika, zgłoszeń nie ruszamy", async () => {
    // Kolumna jest `NOT NULL DEFAULT '{}'`, ale jsonb dopuszcza literał
    // `'null'` - i typ `Json` go przewiduje. Odczyt `event_id` wprost z `null`
    // wywróciłby zwrot wyjątkiem, czyli pętlą ponowień z otwartym dostępem.
    scene.order = orderRow({ metadata: null });

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
    expect(h.rpc.calls).toHaveLength(0);
  });

  it("awaria funkcji bazowej nie wywraca zwrotu (miękki skutek)", async () => {
    scene.order = orderRow({ metadata: { event_id: EVENT_ID } });
    h.rpc.error = { message: "deadlock detected" };
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });
});

describe("AWARIE ZAPISU - co zostaje w bazie", () => {
  it("błąd odczytu zamówienia przerywa zwrot, ZANIM cokolwiek zapisze", async () => {
    // Kontrakt błędów modułu: rzucamy, żeby operator ponowił dostarczenie.
    db.setResponse("payment_orders", () => fail("statement timeout", "57014"));

    await expect(applyRefundEffects(refundEvent())).rejects.toThrow(
      "refund: order lookup failed: statement timeout",
    );
    expect(patches("payment_orders")).toHaveLength(0);
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
  });

  it("błąd flipu statusu NIE odbiera uprawnienia (dostęp zostaje do ponowienia)", async () => {
    // Kolejność ma tu znaczenie pieniężne: gdyby uprawnienie padło przed
    // księgowaniem, klient straciłby dostęp przy zwrocie, którego nie ma.
    db.setResponse("payment_orders", (chain) =>
      chain.has("update") ? fail("permission denied", "42501") : ok([orderRow()]),
    );

    await expect(applyRefundEffects(refundEvent())).rejects.toThrow(
      "refund: order status flip failed: permission denied",
    );
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(emails()).toHaveLength(0);
    expect(inserted("notifications")).toHaveLength(0);
  });

  it("błąd odebrania uprawnienia przerywa, ZANIM pójdzie mail o zwrocie", async () => {
    // Stan pośredni jest tu świadomy: zamówienie jest już `refunded`,
    // uprawnienie jeszcze nie. Ponowienie zdarzenia dokończy pracę, bo oba
    // zapisy są idempotentne - ale mail nie może wyjść przed odebraniem
    // dostępu, inaczej klient dostaje „zwrócono" i dalej czyta treść.
    db.setResponse("user_subscriptions", () => fail("deadlock detected", "40P01"));

    await expect(applyRefundEffects(refundEvent())).rejects.toThrow(
      "revoke: user_subscriptions failed",
    );
    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(emails()).toHaveLength(0);
  });

  it("błąd anulowania zgłoszenia przerywa, choć zwrot jest już zaksięgowany", async () => {
    scene.order = orderRow({ metadata: { event_id: EVENT_ID } });
    db.setResponse("event_rsvps", () => fail("permission denied", "42501"));

    await expect(applyRefundEffects(refundEvent())).rejects.toThrow(
      "refund: rsvp cancel failed: permission denied",
    );
    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
  });

  it("awaria DZWONKA nie wywraca zwrotu - skutek miękki nigdy nie cofa pieniędzy", async () => {
    db.setResponse("notifications", () => {
      throw new Error('relation "notifications" does not exist');
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("awaria ALERTU O SPORZE nie blokuje odebrania dostępu", async () => {
    db.setResponse("user_roles", () => {
      throw new Error("permission denied for table user_roles");
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await applyRefundEffects(refundEvent({ action: "chargeback" }));

    expect(outcome).toBe("order_refunded");
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
    errorLog.mockRestore();
  });
});

describe("DAROWIZNA - brak uprawnień, ale księgi muszą się zgadzać", () => {
  it("zwrot bez zamówienia trafia w darowiznę", async () => {
    scene.order = null;
    scene.refundedDonations = [{ id: "don-1" }];

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("donation_refunded");
    expect(patches("donations")[0]).toEqual({ status: "refunded" });
    expect(orFilters("donations")).toEqual([`provider_intent_id.eq.${TXN}`]);
    expect(filters("donations", "eq")).toContainEqual(["environment", "sandbox"]);
    expect(filters("donations", "neq")).toContainEqual(["status", "refunded"]);
  });

  it("transakcja NIEZNANA (ani zamówienie, ani darowizna) to `skipped`", async () => {
    // Zwrot dotyczy czegoś, czego u nas nie ma - np. płatności z innego
    // systemu. Nie wymyślamy skutku.
    scene.order = null;
    scene.refundedDonations = [];

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("skipped");
    expect(emails()).toHaveLength(0);
    expect(inserted("notifications")).toHaveLength(0);
  });

  it("darowizna JUŻ ZWRÓCONA nie jest zwracana drugi raz", async () => {
    // Wzorzec, którego brakuje ścieżce zamówienia: `.select("id")` po zapisie
    // odróżnia „zmieniono" od „nic nie pasowało".
    scene.order = null;
    scene.refundedDonations = [];

    expect(await applyRefundEffects(refundEvent())).toBe("skipped");
  });

  it("błąd zapisu darowizny jest zgłaszany do ponowienia", async () => {
    scene.order = null;
    db.setResponse("donations", () => fail("statement timeout", "57014"));

    await expect(applyRefundEffects(refundEvent())).rejects.toThrow(
      "refund: donation status flip failed: statement timeout",
    );
  });
});

describe("zwrot SUBSKRYPCJI", () => {
  const subEvent = (overrides: Partial<RefundEvent> = {}) =>
    refundEvent({ subscriptionId: SUB, transactionId: null, ...overrides });

  it("odbiera uprawnienie po `external_ref` operatora, znaczy CRM i pisze mail", async () => {
    scene.subscription = subscriptionRow();

    const outcome = await applyRefundEffects(subEvent());

    expect(outcome).toBe("subscription_refunded");
    expect(filters("user_subscriptions", "eq")).toContainEqual(["external_ref", SUB]);
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
    // Zwrot to UTRATA klienta, nie pauza - inaczej CRM dalej liczyłby go do
    // przychodu cyklicznego.
    expect(inserted("crm_leads")[0]?.tags).toEqual(
      expect.arrayContaining(["plan:member", "churned"]),
    );
    expect(emails()[0]).toMatchObject({ type: "payment_refunded" });
    expect(inserted("notifications")[0]).toMatchObject({ tenant_id: BILLING_IDS.tenant });
  });

  it("subskrypcja jest szukana W TYM SAMYM ŚRODOWISKU co korekta", async () => {
    scene.subscription = subscriptionRow();

    await applyRefundEffects(subEvent({ environment: "live" }));

    expect(filters("subscriptions", "eq")).toContainEqual(["environment", "live"]);
    expect(filters("subscriptions", "eq")).toContainEqual(["provider_subscription_id", SUB]);
  });

  it("błąd odczytu subskrypcji przerywa zwrot", async () => {
    db.setResponse("subscriptions", () => fail("statement timeout", "57014"));

    await expect(applyRefundEffects(subEvent())).rejects.toThrow(
      "refund: subscription lookup failed: statement timeout",
    );
  });

  it("subskrypcja NIEZNANA lokalnie: o wyniku decyduje odebranie uprawnienia", async () => {
    // Wiersz operatorski mógł nie dojechać, ale uprawnienie mogło zostać
    // nadane wcześniejszym zdarzeniem - i to ono liczy się dla dostępu.
    scene.subscription = null;
    scene.revokedEntitlements = [{ id: "us-1" }];

    expect(await applyRefundEffects(subEvent())).toBe("subscription_refunded");
    expect(emails()).toHaveLength(0);
  });

  it("brak subskrypcji i brak uprawnienia to `skipped`", async () => {
    scene.subscription = null;
    scene.revokedEntitlements = [];

    expect(await applyRefundEffects(subEvent())).toBe("skipped");
  });

  it("cena SPOZA KATALOGU: dostęp znika, bez CRM, ale dzwonek idzie do najemcy subskrypcji", async () => {
    // Bez wpisu katalogowego nie znamy warstwy (więc CRM milczy) - ale najemcę
    // niesie sam wiersz `subscriptions`. Wcześniej dzwonek brał najemcę
    // wyłącznie z planu i przy cenie spoza katalogu klient nie dostawał
    // w aplikacji żadnego śladu zwrotu.
    scene.subscription = subscriptionRow({ price_id: "cena_spoza_katalogu" });

    const outcome = await applyRefundEffects(subEvent());

    expect(outcome).toBe("subscription_refunded");
    expect(db.chainsFor("crm_leads")).toHaveLength(0);
    expect(inserted("notifications")).toEqual([
      expect.objectContaining({ user_id: BILLING_IDS.me, tenant_id: BILLING_IDS.tenant }),
    ]);
    // Mail idzie mimo to - klient ma prawo wiedzieć o zwrocie.
    expect(emails()[0]).toMatchObject({ type: "payment_refunded" });
  });

  it("pusty identyfikator ceny nie wywraca zwrotu", async () => {
    scene.subscription = subscriptionRow({ price_id: "" });

    expect(await applyRefundEffects(subEvent())).toBe("subscription_refunded");
    expect(db.chainsFor("access_plans")).toHaveLength(0);
  });
});

describe("SPÓR OTWARTY - alert dla zespołu NAJEMCY sporu", () => {
  // AUDYT WYD. 12 (16.8, defekt wysoki): `alertAdminsAboutDispute` wybierał
  // z `user_roles` KAŻDEGO z rolą `admin`, bez warunku najemcy, i wstawiał mu
  // dzwonek z identyfikatorem cudzej transakcji. Odbiorców zawęża teraz
  // `notifyTenantAdmins` (rola i profil W TYM najemcy, dzwonek przez
  // `enqueue_notification`), a najemcę wyprowadza się z NASZEGO wiersza.

  it("dzwonek trafia do administratorów najemcy zamówienia, przez kolejkę powiadomień", async () => {
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];

    await applyRefundEffects(refundEvent({ action: "chargeback_warning", status: null }));

    expect(alertTenants()).toEqual([BILLING_IDS.tenant]);
    expect(adminBells()).toHaveLength(1);
    expect(adminBells()[0]).toMatchObject({
      p_user_id: "admin-1",
      p_kind: "billing",
      p_title_pl: "Otwarto spór płatniczy",
      // 2.7: adres unikalny dla sporu i fazy - klucz deduplikacji `once`.
      p_href: "/admin/billing?dispute=adj_1Syntetyczna&phase=open",
      // Ikona z listy kuratorskiej - `shield-alert` jej nie ma i ładował
      // w przeglądarce leniwy rejestr ikon (spec B.7).
      p_icon: "credit-card",
    });
    expect(String(adminBells()[0].p_body_pl)).toContain(TXN);
    // Żadnego wsadowego `insert` do `notifications` z pominięciem kolejki.
    expect(inserted("notifications").some((row) => row.href === "/admin/billing")).toBe(false);
  });

  it("spór najemcy B NIE pyta o administratorów najemcy A", async () => {
    // Regresja wprost: zamówienie obcej organizacji wyznacza JEJ najemcę.
    scene.order = orderRow({ tenant_id: BILLING_IDS.foreignTenant });
    scene.admins = [{ user_id: "admin-b" }];
    scene.adminProfiles = [{ id: "admin-b", tenant_id: BILLING_IDS.foreignTenant }];

    await applyRefundEffects(refundEvent({ action: "chargeback" }));

    expect(alertTenants()).toEqual([BILLING_IDS.foreignTenant]);
    expect(alertTenants()).not.toContain(BILLING_IDS.tenant);
    const profileTenants = db
      .chainsFor("profiles")
      .filter((chain) => chain.has("in"))
      .flatMap((chain) => chain.calls.filter((call) => call.method === "eq"))
      .map((call) => call.args);
    expect(profileTenants).toContainEqual(["tenant_id", BILLING_IDS.foreignTenant]);
  });

  it("brak administratorów w najemcy nie generuje żadnego dzwonka", async () => {
    scene.admins = [];

    await applyRefundEffects(refundEvent({ action: "chargeback" }));

    expect(adminBells()).toHaveLength(0);
  });

  it("alert wskazuje SUBSKRYPCJĘ i jej najemcę, gdy korekta nie niesie transakcji", async () => {
    // Odniesienie w treści alertu jest tym, po czym zespół odnajduje sprawę
    // u operatora. Spór subskrypcyjny nie ma identyfikatora transakcji.
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];
    scene.subscription = subscriptionRow();

    await applyRefundEffects(
      refundEvent({ action: "chargeback", transactionId: null, subscriptionId: SUB }),
    );

    expect(alertTenants()).toEqual([BILLING_IDS.tenant]);
    expect(String(adminBells()[0]?.p_body_pl)).toContain(SUB);
  });

  it("subskrypcja NIEZNANA lokalnie: najemca przychodzi z zamówienia transakcji", async () => {
    // Spór może nieść oba identyfikatory, a wiersza subskrypcji u nas nie być
    // (inne środowisko, subskrypcja sprzed migracji). Wtedy najemcę wyznacza
    // zamówienie po transakcji - a nie „nikt".
    scene.subscription = null;
    scene.order = orderRow({ tenant_id: BILLING_IDS.foreignTenant });
    scene.admins = [{ user_id: "admin-b" }];
    scene.adminProfiles = [{ id: "admin-b", tenant_id: BILLING_IDS.foreignTenant }];

    await applyRefundEffects(refundEvent({ action: "chargeback", subscriptionId: SUB }));

    expect(alertTenants()).toEqual([BILLING_IDS.foreignTenant]);
    expect(String(adminBells()[0]?.p_body_pl)).toContain(TXN);
  });

  it("spór o DAROWIZNĘ alarmuje najemcę darowizny", async () => {
    scene.order = null;
    scene.donationTenant = BILLING_IDS.foreignTenant;
    scene.admins = [{ user_id: "admin-b" }];
    scene.adminProfiles = [{ id: "admin-b", tenant_id: BILLING_IDS.foreignTenant }];

    await applyRefundEffects(refundEvent({ action: "chargeback" }));

    expect(alertTenants()).toEqual([BILLING_IDS.foreignTenant]);
    expect(filters("donations", "eq")).toContainEqual(["environment", "sandbox"]);
  });

  it("spór BEZ przypisanego najemcy nie dzwoni u nikogo - zostaje ślad w logu serwera", async () => {
    // Lepszy brak dzwonka niż dzwonek u obcej organizacji. Spór zostaje
    // w dzienniku webhooków i w logu - z numerem korekty, jedynym uchwytem.
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await applyRefundEffects(
      refundEvent({ action: "chargeback", transactionId: null, subscriptionId: null }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("user_roles")).toHaveLength(0);
    expect(adminBells()).toHaveLength(0);
    expect(JSON.stringify(errorLog.mock.calls)).toContain("adj_1Syntetyczna");
    warnLog.mockRestore();
    errorLog.mockRestore();
  });

  it("transakcja nieznana (ani zamówienie, ani darowizna) to też brak najemcy", async () => {
    scene.order = null;
    scene.donationTenant = null;
    scene.admins = [{ user_id: "admin-1" }];
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await applyRefundEffects(refundEvent({ action: "chargeback" }));

    expect(db.chainsFor("user_roles")).toHaveLength(0);
    errorLog.mockRestore();
  });

  it("identyfikator o obcym kształcie nie szuka najemcy w `or(...)`", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await applyRefundEffects(
      refundEvent({ action: "chargeback", transactionId: "pi_1,provider_intent_id.eq.cudze" }),
    );

    expect(db.chainsFor("payment_orders")).toHaveLength(0);
    expect(db.chainsFor("user_roles")).toHaveLength(0);
    errorLog.mockRestore();
  });

  it("awaria odczytu najemcy nie wywraca odebrania dostępu", async () => {
    db.setResponse("subscriptions", () => {
      throw new Error("connection reset");
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await applyRefundEffects(
      refundEvent({ action: "chargeback", transactionId: null, subscriptionId: SUB }),
    );

    // Odczyt najemcy połknął błąd (alert to skutek miękki), a odebranie
    // dostępu nie zależy od wiersza `subscriptions` - klucz uprawnienia to
    // identyfikator subskrypcji operatora.
    expect(outcome).toBe("subscription_refunded");
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
    expect(JSON.stringify(errorLog.mock.calls)).toContain("dispute tenant lookup failed");
    errorLog.mockRestore();
  });

  it("awaria ODEBRANIA dostępu przy sporze: alert idzie mimo to (termin na dowody), a wyjątek leci do ponowienia", async () => {
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];
    db.setResponse("user_subscriptions", () => fail("deadlock detected", "40P01"));

    await expect(
      applyRefundEffects(refundEvent({ action: "chargeback_warning", status: "open" })),
    ).rejects.toThrow("dispute: user_subscriptions suspend failed");

    expect(adminBells()).toHaveLength(1);
    expect(String(adminBells()[0].p_body_pl)).toContain("zostanie ponowiona automatycznie");
  });

  it("zwykły zwrot NIE alarmuje zespołu", async () => {
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];

    await applyRefundEffects(refundEvent());

    expect(db.chainsFor("user_roles")).toHaveLength(0);
  });
});

describe("SPÓR WYGRANY - dostęp wraca", () => {
  const wonEvent = (overrides: Partial<RefundEvent> = {}) =>
    refundEvent({ action: "chargeback", status: "reversed", ...overrides });
  /** Zamówienie zamknięte otwarciem sporu: `refunded` z kwotą sporu w liczniku. */
  const disputedOrder = (overrides: Partial<OrderRow> = {}) =>
    orderRow({ status: "refunded", refunded_amount_cents: 4900, ...overrides });

  it("S1: przywraca uprawnienie subskrypcji ze stanu U OPERATORA (`force`) i zawiadamia zespół", async () => {
    scene.subscription = subscriptionRow({ status: "canceled", current_period_end: null });
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];

    const outcome = await applyRefundEffects(wonEvent({ subscriptionId: SUB }));

    expect(outcome).toBe("subscription_restored");
    expect(h.stripe.calls).toContain("subscriptions.retrieve");
    expect(filters("user_subscriptions", "eq")).toContainEqual(["external_ref", SUB]);
    // Status i okres z odczytu operatora, nie z (przestarzałego) wiersza.
    expect(inserted("user_subscriptions")[0]).toMatchObject({
      user_id: BILLING_IDS.me,
      plan_id: "plan-member-monthly",
      status: "active",
      external_ref: SUB,
      current_period_end: relativeIso(25 * DZIEN),
    });
    expect(alertTenants()).toEqual([BILLING_IDS.tenant]);
    expect(adminBells()[0]).toMatchObject({
      p_title_pl: "Spór płatniczy rozstrzygnięty",
      p_href: "/admin/billing?dispute=adj_1Syntetyczna&phase=won",
    });
    expect(String(adminBells()[0].p_body_pl)).toContain("Dostęp klienta przywrócono.");
  });

  it("S1: korekta sporu (`refunded`) wraca po wygranej - `force` ożywia TĘ korektę", async () => {
    // Spór otwarty na bieżącym okresie zapisał `refunded`; wygrana nadpisuje
    // go autorytatywnym stanem operatora.
    scene.subscription = subscriptionRow();
    scene.existingEntitlement = {
      id: "us-1",
      status: "refunded",
      canceled_at: relativeIso(-2 * DZIEN),
    };

    const outcome = await applyRefundEffects(wonEvent({ subscriptionId: SUB }));

    expect(outcome).toBe("subscription_restored");
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "active", canceled_at: null });
    expect(filters("user_subscriptions", "eq")).toContainEqual(["status", "refunded"]);
  });

  it("2.0/7.1: obciążenie ZWRÓCONE u operatora - wygrany spór (zapytanie zamknięte zwrotem) NIE przywraca subskrypcji", async () => {
    scene.subscription = subscriptionRow();
    h.stripe.charge = chargeState({ amount_refunded: 4900, refunded: true });
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];

    const outcome = await applyRefundEffects(
      wonEvent({ subscriptionId: SUB, providerStatus: "warning_closed" }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(String(adminBells()[0].p_body_pl)).toContain("Płatność została zwrócona");
  });

  it("brak lokalnej subskrypcji nic nie przywraca - ale zespół i tak dostaje alert o wygranej", async () => {
    // PAY-03: alert idzie w KAŻDEJ fazie sporu, niezależnie od tego, czy
    // znaleźliśmy co przywrócić. Najemcę wyznacza wtedy zamówienie transakcji.
    scene.subscription = null;
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];

    const outcome = await applyRefundEffects(wonEvent({ subscriptionId: SUB }));

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(alertTenants()).toEqual([BILLING_IDS.tenant]);
    expect(adminBells()[0]).toMatchObject({ p_title_pl: "Spór płatniczy rozstrzygnięty" });
  });

  it("subskrypcja nieznana operatorowi (404): nic nie przywracamy, alert prosi o ręczną weryfikację", async () => {
    scene.subscription = subscriptionRow();
    h.stripe.subscription = null;
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await applyRefundEffects(wonEvent({ subscriptionId: SUB }))).toBe("skipped");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(String(adminBells()[0].p_body_pl)).toContain("sprawdź dostęp ręcznie");
    errorLog.mockRestore();
  });

  it("awaria odczytu operatora przy przywróceniu RZUCA - ponowienie, nie cichy brak dostępu", async () => {
    scene.subscription = subscriptionRow();
    h.stripe.failure = Object.assign(new Error("api_connection_error"), { statusCode: 500 });

    await expect(applyRefundEffects(wonEvent({ subscriptionId: SUB }))).rejects.toThrow(
      "api_connection_error",
    );
  });

  it("błąd odczytu subskrypcji przy sporze przerywa przywrócenie", async () => {
    db.setResponse("subscriptions", () => fail("statement timeout", "57014"));

    await expect(applyRefundEffects(wonEvent({ subscriptionId: SUB }))).rejects.toThrow(
      "dispute: subscription lookup failed: statement timeout",
    );
  });

  it("cena spoza katalogu: NIC nie przywrócono i wynik mówi to wprost (`skipped`)", async () => {
    // Dawniej wynik brzmiał `subscription_restored`, choć nic nie nadano.
    scene.subscription = subscriptionRow({ price_id: "cena_spoza_katalogu" });
    h.stripe.subscription = remoteSubscription({ items: { data: [] } });

    const outcome = await applyRefundEffects(wonEvent({ subscriptionId: SUB }));

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
  });

  it("przywraca zamówienie: status `paid`, uprawnienie i potwierdzony udział", async () => {
    scene.order = disputedOrder({ metadata: { event_id: EVENT_ID } });

    const outcome = await applyRefundEffects(wonEvent());

    expect(outcome).toBe("order_restored");
    expect(patches("payment_orders")[0]).toMatchObject({ status: "paid" });
    expect(filters("payment_orders", "eq")).toContainEqual(["status", "refunded"]);
    expect(inserted("user_subscriptions")[0]).toMatchObject({ status: "active" });
    expect(patches("event_rsvps")[0]).toMatchObject({ status: "going" });
  });

  it("2.5/5.6/6.4: wygrana zapisuje licznik PRAWDZIWYCH zwrotów - kwota sporu znika z księgi", async () => {
    // Otwarcie sporu zapisało 4900 (środki wycofane przez bank). Po wygranej
    // licznik musi wrócić do zwrotów u operatora - inaczej przychód netto
    // wygranego sporu to zero, a kolejny drobny zwrot (maksimum z 4900)
    // odbierał cały dostęp.
    scene.order = disputedOrder({ kind: "one_time", entity_type: "post", entity_id: "post-1" });
    h.stripe.charge = chargeState({ amount_refunded: 1000 });

    const outcome = await applyRefundEffects(wonEvent());

    expect(outcome).toBe("order_restored");
    expect(h.stripe.calls).toContain("paymentIntents.retrieve");
    expect(patches("payment_orders")[0]).toMatchObject({
      status: "paid",
      refunded_amount_cents: 1000,
    });
    expect(db.chainsFor("user_purchases")[0]?.argsOf("upsert")?.[0]).toMatchObject({
      status: "active",
    });
  });

  it("2.0/6.3/7.1: obciążenie ZWRÓCONE w całości - wygrana NIE wskrzesza zamówienia ani zakupu", async () => {
    // Zwrot, a potem spór wygrany dowodem zwrotu; zapytanie banku rozwiązane
    // pełnym zwrotem (`warning_closed`); ponowiona wygrana po późniejszym
    // zwrocie. Dawniej: `paid` + `user_purchases` aktywne, choć klient ma
    // pieniądze z powrotem.
    scene.order = disputedOrder({ kind: "one_time", entity_type: "post", entity_id: "post-1" });
    h.stripe.charge = chargeState({ amount_refunded: 4900, refunded: true });
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];

    const outcome = await applyRefundEffects(wonEvent({ providerStatus: "warning_closed" }));

    expect(outcome).toBe("skipped");
    expect(patches("payment_orders")).toEqual([
      expect.objectContaining({ refunded_amount_cents: 4900 }),
    ]);
    expect(patches("payment_orders")[0]).not.toHaveProperty("status");
    expect(db.chainsFor("user_purchases").some((chain) => chain.has("upsert"))).toBe(false);
    expect(patches("user_purchases")[0]).toMatchObject({ status: "refunded" });
    expect(String(adminBells()[0].p_body_pl)).toContain("Płatność została zwrócona");
    expect(String(adminBells()[0].p_body_pl)).not.toContain("przywrócono");
  });

  it("PAY-07: plan odebrany OSTATECZNIE przez realizację ścigającą się z otwarciem sporu wraca po wygranej", async () => {
    // Realizacja, która zastała zamówienie zamknięte sporem, odbiera nadany
    // plan jako `refunded`. Obciążenie nie jest zwrócone (operator), więc
    // `refunded` zabrał spór - wygrana musi go ożywić.
    scene.order = {
      ...disputedOrder({ kind: "one_time", plan_id: "plan-lifetime" }),
      provider_intent_id: "cs_plan",
    } as OrderRow;
    scene.existingEntitlement = { id: "us-plan", status: "refunded" };

    expect(await applyRefundEffects(wonEvent())).toBe("order_restored");
    const revive = db.chainsFor("user_subscriptions").find((chain) => chain.has("update"));
    expect(revive?.argsOf("update")?.[0]).toMatchObject({ status: "active" });
    expect(revive?.calls).toContainEqual({ method: "eq", args: ["external_ref", "cs_plan"] });
    expect(revive?.has("neq")).toBe(false);
  });

  it("2.0: plan zawieszony sporem, a obciążenie zwrócone - plan odebrany OSTATECZNIE (`refunded`)", async () => {
    scene.order = disputedOrder({ kind: "one_time", plan_id: "plan-lifetime" });
    h.stripe.charge = chargeState({ amount_refunded: 4900, refunded: true });

    await applyRefundEffects(wonEvent({ providerStatus: "warning_closed" }));

    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
  });

  it("zamówienie OPŁACONE przy zwróconym obciążeniu zostaje dla zdarzenia zwrotu (bilet, mail, dzwonek)", async () => {
    // `charge.refunded` dojdzie własną drogą; zamknięcie zamówienia tutaj
    // zamieniłoby je w powtórkę bez odwołania biletu i bez maila.
    scene.order = orderRow({ status: "paid" });
    h.stripe.charge = chargeState({ amount_refunded: 4900, refunded: true });

    expect(await applyRefundEffects(wonEvent())).toBe("skipped");
    expect(patches("payment_orders")).toHaveLength(0);
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
  });

  it("stan płatności nieznany operatorowi: zamówienie NIE wraca, alert prosi o ręczną weryfikację", async () => {
    scene.order = disputedOrder();
    h.stripe.charge = null;
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await applyRefundEffects(wonEvent())).toBe("skipped");
    expect(patches("payment_orders")).toHaveLength(0);
    expect(String(adminBells()[0].p_body_pl)).toContain("sprawdź dostęp ręcznie");
    errorLog.mockRestore();
  });

  it("spór na zamówieniu w toku (przed realizacją) nie zamienia go w opłacone", async () => {
    scene.order = orderRow({ status: "processing" });
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await applyRefundEffects(wonEvent())).toBe("skipped");
    expect(patches("payment_orders")).toHaveLength(0);
    expect(h.stripe.calls).not.toContain("paymentIntents.retrieve");
    warnLog.mockRestore();
  });

  it("zamówienie ZWIĄZANE ZE ZGŁOSZENIEM nie dostaje `going` - decyzja zostaje u organizatora", async () => {
    // AUDYT WYD. 12 (16.8): zwrot w tym samym oknie przestał dotykać RSVP
    // zamówień ze `registration_id` (miejsce zwalnia baza, z awansem z listy
    // rezerwowej), a wygrany spór dawał `going` bezwarunkowo - czyli link
    // wejścia osobie z odwołanym zgłoszeniem, której miejsce mogło już przejść
    // na kogoś innego.
    scene.order = disputedOrder({
      metadata: { event_id: EVENT_ID, registration_id: "reg-1" },
    });
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];

    const outcome = await applyRefundEffects(wonEvent());

    expect(outcome).toBe("order_restored");
    expect(patches("payment_orders")[0]).toMatchObject({ status: "paid" });
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
    expect(String(adminBells()[0]?.p_body_pl)).toContain("wymaga decyzji organizatora");
    expect(String(adminBells()[0]?.p_body_en)).toContain("needs an organiser decision");
  });

  it("zamówienie bez zgłoszenia nie dopisuje do alertu zdania o organizatorze", async () => {
    scene.order = disputedOrder({ metadata: { event_id: EVENT_ID } });
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];

    await applyRefundEffects(wonEvent());

    expect(String(adminBells()[0]?.p_body_pl)).not.toContain("organizatora");
  });

  it("zamówienie BEZ biletu wraca bez dotykania zgłoszeń na wydarzenia", async () => {
    // Zwykły zakup nie ma `event_id` w metadanych. Ślepy zapis do
    // `event_rsvps` bez tego filtra ruszałby cudze zgłoszenia.
    scene.order = disputedOrder({ metadata: {} });

    const outcome = await applyRefundEffects(wonEvent());

    expect(outcome).toBe("order_restored");
    expect(patches("payment_orders")[0]).toMatchObject({ status: "paid" });
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
  });

  it("zamówienie z metadanymi `null` (jsonb 'null') wraca bez dotykania zgłoszeń", async () => {
    // Lustro przypadku przy zwrocie: literał `'null'` w metadanych nie może
    // wywrócić przywrócenia dostępu po wygranym sporze.
    scene.order = disputedOrder({ metadata: null });

    const outcome = await applyRefundEffects(wonEvent());

    expect(outcome).toBe("order_restored");
    expect(patches("payment_orders")[0]).toMatchObject({ status: "paid" });
    expect(inserted("user_subscriptions")[0]).toMatchObject({ status: "active" });
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
  });

  it("identyfikator o obcym kształcie NIE trafia do filtra `or(...)` także przy sporze", async () => {
    // Przywrócenie nie ma własnej bramki kształtu - korzysta z tej
    // w `findOrderForAdjustment`. Bez niej tekst z payloadu operatora wszedłby
    // do `or(...)` i mógł przywrócić dostęp na CUDZYM zamówieniu.
    const outcome = await applyRefundEffects(
      wonEvent({ transactionId: "pi_1,provider_intent_id.eq.cudze" }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chains).toHaveLength(0);
  });

  it("spór wygrany bez transakcji i bez subskrypcji to `skipped`", async () => {
    const outcome = await applyRefundEffects(
      wonEvent({ transactionId: null, subscriptionId: null }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chains).toHaveLength(0);
  });

  it("nieznane zamówienie nie jest przywracane", async () => {
    scene.order = null;

    expect(await applyRefundEffects(wonEvent())).toBe("skipped");
    expect(patches("payment_orders")).toHaveLength(0);
  });

  it("błąd odczytu zamówienia przy sporze przerywa", async () => {
    db.setResponse("payment_orders", () => fail("statement timeout", "57014"));

    await expect(applyRefundEffects(wonEvent())).rejects.toThrow(
      "dispute: order lookup failed: statement timeout",
    );
  });

  it("błąd flipu na `paid` przerywa, zanim wróci uprawnienie", async () => {
    // Odczyt oddaje LISTĘ: po naprawie defektu nr 4 przywrócenie dostępu szuka
    // zamówienia tą samą funkcją co zwrot (`or(...)` + `.limit(1)`), a nie
    // pojedynczym wierszem po `provider_intent_id`.
    db.setResponse("payment_orders", (chain) =>
      chain.has("update") ? fail("permission denied", "42501") : ok([disputedOrder()]),
    );

    await expect(applyRefundEffects(wonEvent())).rejects.toThrow(
      "dispute: order status flip failed: permission denied",
    );
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
  });

  it("błąd przywrócenia zgłoszenia przerywa, choć zamówienie jest już `paid`", async () => {
    scene.order = disputedOrder({ metadata: { event_id: EVENT_ID } });
    db.setResponse("event_rsvps", () => fail("permission denied", "42501"));

    await expect(applyRefundEffects(wonEvent())).rejects.toThrow(
      "dispute: rsvp restore failed: permission denied",
    );
    expect(patches("payment_orders")[0]).toMatchObject({ status: "paid" });
  });
});

describe("refunds.server - DEFEKTY NAPRAWIONE (bramki regresji)", () => {
  // =====================================================================
  // DEFEKT 1 (naprawiony): zwrot NIE BYŁ ZAWĘŻONY DO ŚRODOWISKA.
  //
  // CO BYŁO ZŁE. `revokeOrder` szukał zamówienia wyłącznie po identyfikatorze
  // transakcji (`or(provider_payment_intent_id / provider_intent_id /
  // provider_session_id)`) - bez `.eq("environment", event.environment)`.
  // Ta sama funkcja tuż obok (`revokeSubscription`) filtr środowiska MA,
  // i test „subskrypcja jest szukana W TYM SAMYM ŚRODOWISKU" tego dowodzi.
  //
  // JAKIE TO BYŁO RYZYKO. Reguła jest w tym repo nazwana wprost jako P0
  // (`oneTimeFulfilment.server`): „realizujemy zamówienie WYŁĄCZNIE zdarzeniem
  // z tego samego środowiska, w którym powstało. Bez tego sandboxowy webhook
  // (opłacony kartą testową) mógłby zrealizować realne zamówienie". Zwrot jest
  // tą samą operacją odwróconą i o wyższej stawce: skutkiem nie był darmowy
  // dostęp, tylko ODEBRANIE dostępu i oznaczenie realnego zamówienia jako
  // zwróconego - na podstawie zdarzenia z piaskownicy.
  //
  // JAK NAPRAWIONO. Wyszukiwanie zamówienia zjechało do JEDNEJ funkcji
  // (`findOrderForAdjustment`), która filtruje `.eq("environment", ...)` i jest
  // wołana przez obie ścieżki - odebranie i przywrócenie dostępu. Obawa
  // o wiersze historyczne odpadła: kolumna weszła jako `NOT NULL DEFAULT 'live'`
  // (migracja `20260731220000_payment_orders_environment_isolation`).
  //
  // CO ZOSTAŁO NIEDOKOŃCZONE. `revokeDonation` nadal nie filtruje środowiska,
  // bo `donations` NIE MA kolumny `environment` (wygenerowane `types.ts`).
  // Domknięcie wymaga migracji (kolumna + backfill + indeks), której ta zmiana
  // świadomie nie dokłada - zgłoszone właścicielowi modułu.
  // =====================================================================
  it("zwrot szuka zamówienia W ŚRODOWISKU korekty", async () => {
    await applyRefundEffects(refundEvent({ environment: "live" }));

    expect(filters("payment_orders", "eq")).toContainEqual(["environment", "live"]);
  });

  it("wygrany spór też szuka zamówienia w środowisku korekty", async () => {
    // Ta sama funkcja wyszukująca, więc filtr obowiązuje w obie strony:
    // zdarzenie z piaskownicy nie przywróci realnego zamówienia.
    await applyRefundEffects(
      refundEvent({ action: "chargeback", status: "reversed", environment: "live" }),
    );

    expect(filters("payment_orders", "eq")).toContainEqual(["environment", "live"]);
  });

  // =====================================================================
  // DEFEKT 2 (naprawiony): PODWÓJNY ZWROT był niewykrywalny - skutki miękkie
  // szły co raz.
  //
  // CO BYŁO ZŁE. `revokeOrder` zapisywał `update(...).neq("status","refunded")`
  // i NIE czytał wyniku (`.select("id")` nie było). Co więcej, `select` na
  // wejściu nie pobierał kolumny `status`, więc kod nie miał jak stwierdzić, że
  // zamówienie jest już w całości zwrócone. Ponowione zdarzenie przechodziło
  // CAŁĄ ścieżkę skutków: ponownie odbierało uprawnienie, ponownie anulowało
  // zgłoszenie, ponownie wstawiało dzwonek - i zwracało `order_refunded`, choć
  // baza nie zmieniła ani jednego wiersza.
  //
  // JAKIE TO BYŁO RYZYKO. Wzorzec poprawny stoi kilkadziesiąt linii niżej,
  // w TYM SAMYM PLIKU: `revokeDonation` robi `.select("id")` i oddaje
  // `skipped`, gdy nic nie pasowało (dowodzi tego test „darowizna JUŻ
  // ZWRÓCONA..."). Skutkiem braku tej samej bramki był kolejny dzwonek „Zwrot
  // płatności" przy każdym ponowieniu webhooka i wynik, na którym nie dało się
  // oprzeć metryki zwrotów.
  //
  // JAK NAPRAWIONO. `select` na wejściu pobiera `status`, zapis kończy się
  // `.select("id")`, a skutki miękkie odcina bramka powtórki: zapis nie objął
  // żadnego wiersza I zamówienie było już zamknięte zwrotem I zdarzenie nie
  // podnosi licznika. ZMIANA KONTRAKTU WYNIKU: powtórka oddaje `skipped`
  // zamiast `order_refunded`. Jedyny wołający (`webhookDispatch.server`)
  // wyniku nie czyta (`await applyRefundEffects(...)`), więc zmiana nie dotyka
  // dziennika zdarzeń.
  // =====================================================================
  it("ponowiony zwrot już zwróconego zamówienia nie wstawia dzwonka", async () => {
    scene.order = orderRow({ amount_cents: 4900, refunded_amount_cents: 4900 });

    await applyRefundEffects(refundEvent({ adjustmentId: "adj_ponowione" }));

    expect(inserted("notifications")).toHaveLength(0);
  });

  it("powtórka oddaje `skipped` i nie rusza uprawnienia ani zgłoszenia", async () => {
    // Pełny kontrakt powtórki: nie tylko dzwonek, ale ŻADEN skutek miękki -
    // i wynik, po którym metryka zwrotów odróżnia zwrot od jego ponowienia.
    scene.order = orderRow({
      amount_cents: 4900,
      refunded_amount_cents: 4900,
      status: "refunded",
      metadata: { event_id: EVENT_ID },
    });

    const outcome = await applyRefundEffects(refundEvent({ adjustmentId: "adj_ponowione" }));

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
    expect(emails()).toHaveLength(0);
  });

  it("PIERWSZY zwrot na zamówieniu `paid` nadal przechodzi całą ścieżkę", async () => {
    // Bramka powtórki nie może zjeść zwrotu, który naprawdę coś zmienia -
    // dlatego wymaga OBU dowodów naraz (pusty zapis + zamknięte zamówienie).
    scene.order = orderRow({ amount_cents: 4900, refunded_amount_cents: 0, status: "paid" });

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
    expect(inserted("notifications")).toHaveLength(1);
  });

  // =====================================================================
  // DEFEKT 3 (naprawiony): kwota zwrotu NIE BYŁA ZACISKANA do kwoty zamówienia.
  //
  // CO BYŁO ZŁE. `refundedSoFar = Math.max(order.refunded_amount_cents,
  // event.amountCents)` trafiał do bazy bez porównania z `captured`. Gdy korekta
  // niosła kwotę WYŻSZĄ niż nasze zamówienie, zapisywaliśmy
  // `refunded_amount_cents > amount_cents` - i robiliśmy to CICHO, bez logu.
  //
  // JAKIE TO BYŁO RYZYKO. `refunded_amount_cents` jest podstawą rachunku
  // „przychód netto = amount_cents - refunded_amount_cents". Wartość większa od
  // kwoty zamówienia daje przychód UJEMNY i psuje każde zestawienie, w którym
  // ta kolumna występuje. Rozjazd kwot nie jest hipotetyczny: `captured`
  // pochodzi z payloadu operatora, a `amount_cents` z naszego checkoutu, więc
  // rozjeżdżają się przy zmianie ceny, kuponie dopisanym po utworzeniu
  // zamówienia albo przy zdarzeniu dotyczącym innej waluty. Sytuacja, w której
  // te dwie liczby się nie zgadzają, nie zostawiała ŻADNEGO śladu.
  //
  // JAK NAPRAWIONO (decyzja księgowa: ZACISK, NIE ODRZUCENIE). Kwota jest
  // zaciskana do `captured` i rozjazd ląduje w `console.warn`. Odrzucenie
  // zdarzenia (wyjątek -> ponowienie) wstrzymałoby ODEBRANIE DOSTĘPU przy
  // korekcie, która u operatora już się wydarzyła: klient miałby i pieniądze,
  // i treść, a kolejne dostarczenia niosłyby tę samą kwotę, więc pętla nie
  // miałaby wyjścia bez ręcznej interwencji. Pełne uzasadnienie stoi przy
  // zacisku w `refunds.server.ts`.
  // =====================================================================
  it("zwrot PRZEKRACZAJĄCY kwotę zamówienia jest zaciskany, nie księgowany wprost", async () => {
    scene.order = orderRow({ amount_cents: 4900, refunded_amount_cents: 0 });
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});

    await applyRefundEffects(refundEvent({ amountCents: 12000, capturedAmountCents: null }));

    const written = Number(patches("payment_orders")[0].refunded_amount_cents);
    expect(written).toBeLessThanOrEqual(4900);
    // Rozjazd kwot MUSI zostawić ślad - bez niego zacisk po cichu gubiłby
    // informację o tym, że operator i nasze księgi się nie zgadzają.
    expect(warnLog).toHaveBeenCalled();
    warnLog.mockRestore();
  });

  it("zacisk nie zamienia zwrotu pełnego w częściowy", async () => {
    // Po zacisku `refundedSoFar === captured`, więc próg „zwrot pełny" musi
    // zadziałać: dostęp znika, a status zamówienia idzie na `refunded`.
    scene.order = orderRow({ amount_cents: 4900, refunded_amount_cents: 0 });
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});

    await applyRefundEffects(refundEvent({ amountCents: 12000, capturedAmountCents: null }));

    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
    warnLog.mockRestore();
  });

  // =====================================================================
  // DEFEKT 4 (naprawiony): WYGRANY SPÓR nie przywracał zamówień znalezionych
  // sesją.
  //
  // CO BYŁO ZŁE. Odebranie dostępu (`revokeOrder`) szukało zamówienia po TRZECH
  // kolumnach: `provider_payment_intent_id`, `provider_intent_id` oraz
  // `provider_session_id` - z komentarzem, że bez tego „zwrot cicho nie
  // odbierałby dostępu". Przywrócenie (`restoreAccess`) szukało po JEDNEJ:
  // `.eq("provider_intent_id", ...)`.
  //
  // JAKIE TO BYŁO RYZYKO. Asymetria była jednokierunkowa i działała na
  // niekorzyść klienta: zamówienie zapisane identyfikatorem sesji checkout było
  // ZNAJDOWANE przy odbieraniu dostępu i NIEWIDOCZNE przy jego przywracaniu.
  // Efekt: spór wygrany (pieniądze zostają u nas), a klient bezpowrotnie bez
  // dostępu - i bez żadnego sygnału, bo `restoreAccess` oddawał wtedy
  // `skipped`, czyli stan nieodróżnialny od „nie było czego przywracać".
  // Test poniżej pokazuje obie strony w jednym przebiegu: ten sam wiersz jest
  // najpierw namierzony przez zwrot, a potem przez przywrócenie.
  //
  // JAK NAPRAWIONO. Obie ścieżki wołają JEDNĄ funkcję wyszukującą
  // (`findOrderForAdjustment`): ten sam filtr `or(...)` po trzech kolumnach,
  // ta sama bramka kształtu identyfikatora (bez niej `or` przyjąłby tekst
  // z payloadu operatora) i ten sam filtr środowiska.
  // =====================================================================
  it("wygrany spór przywraca zamówienie znalezione po sesji checkout", async () => {
    const sessionOrder = orderRow();
    // Atrapa naśladuje bazę: wiersz ma TYLKO identyfikator sesji, więc
    // odpowiada na filtr `or(...)`, a nie na `eq("provider_intent_id", ...)`.
    db.setResponse("payment_orders", (chain) => {
      if (chain.has("update")) return ok(null);
      if (chain.has("or")) return ok([sessionOrder]);
      return ok(null);
    });

    // Strona pierwsza: spór otwarty NAMIERZA zamówienie i zawiesza dostęp.
    expect(
      await applyRefundEffects(refundEvent({ action: "chargeback_warning", status: "open" })),
    ).toBe("order_refunded");

    // Strona druga: spór wygrany - to samo zamówienie ma odzyskać dostęp
    // (obciążenie u operatora nie zostało zwrócone).
    sessionOrder.status = "refunded";
    const outcome = await applyRefundEffects(
      refundEvent({ action: "chargeback", status: "reversed" }),
    );

    expect(outcome).toBe("order_restored");
  });
});

describe("PAY-04 - zwrot i spór płatności FAKTURY subskrypcji (cel przez operatora)", () => {
  // Zamówienie subskrypcyjne nie zna intencji płatności odnowień, więc
  // własna baza nie znajduje nic - cel wskazuje operator: płatność ->
  // `InvoicePayment` -> faktura -> `parent.subscription_details.subscription`.
  beforeEach(() => {
    scene.order = null;
    scene.subscription = subscriptionRow();
    h.stripe.invoicePayments = [
      { invoice: { id: "in_odnowienie", parent: { subscription_details: { subscription: SUB } } } },
    ];
  });

  it("PAY-04: zwrot pełny płatności odnowienia odbiera uprawnienie subskrypcji (`external_ref` = sub_)", async () => {
    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("subscription_refunded");
    expect(h.stripe.envs).toEqual(["sandbox"]);
    expect(h.stripe.calls).toEqual(["invoicePayments.list"]);
    expect(filters("user_subscriptions", "eq")).toContainEqual(["external_ref", SUB]);
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
    expect(emails()[0]).toMatchObject({ type: "payment_refunded" });
    // Darowizny nie dotykamy - cel jest rozstrzygnięty.
    expect(db.chainsFor("donations")).toHaveLength(0);
  });

  it("PAY-04: zwrot CZĘŚCIOWY faktury subskrypcji to korekta ceny - dostęp zostaje", async () => {
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = await applyRefundEffects(
      refundEvent({ amountCents: 1000, capturedAmountCents: 4900 }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(emails()).toHaveLength(0);
    expect(warnLog).toHaveBeenCalledWith(
      "[payments] partial refund of a subscription payment - access kept",
      expect.objectContaining({ subscriptionId: SUB, refunded: 1000, captured: 4900 }),
    );
    warnLog.mockRestore();
  });

  it("PAY-04: spór na płatności odnowienia alarmuje najemcę SUBSKRYPCJI", async () => {
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];

    await applyRefundEffects(refundEvent({ action: "chargeback_warning", status: "open" }));

    expect(alertTenants()).toEqual([BILLING_IDS.tenant]);
    expect(filters("subscriptions", "eq")).toContainEqual(["provider_subscription_id", SUB]);
  });

  it("ponowiony zwrot odebranego już uprawnienia nie dokłada dzwonka ani maila", async () => {
    scene.revokedEntitlements = [];

    expect(await applyRefundEffects(refundEvent())).toBe("skipped");
    expect(emails()).toHaveLength(0);
    expect(inserted("notifications")).toHaveLength(0);
  });

  it("faktura BEZ subskrypcji (płatność jednorazowa z fakturą) nie jest subskrypcją", async () => {
    h.stripe.invoicePayments = [{ invoice: { id: "in_jednorazowa", parent: null } }];
    scene.refundedDonations = [];

    expect(await applyRefundEffects(refundEvent())).toBe("skipped");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    // Następny krok kaskady: sesja Checkout tej płatności.
    expect(h.stripe.calls).toEqual(["invoicePayments.list", "checkout.sessions.list"]);
  });

  it("identyfikator spoza kształtu `pi_`/`ch_` nie pyta operatora", async () => {
    await applyRefundEffects(refundEvent({ transactionId: "txn_paddle_1" }));

    expect(h.stripe.calls).toEqual([]);
  });
});

describe("PAY-07 - zwrot, który WYPRZEDZIŁ realizację zamówienia", () => {
  // Zamówienie zna tylko sesję (`provider_session_id`), zwrot niesie intencję.
  // Wcześniej zwrot nie trafiał w nic (`revokeDonation` -> `skipped`), a późna
  // realizacja nadawała dostęp klientowi z pieniędzmi z powrotem.
  const pending = () =>
    orderRow({
      status: "processing",
      refunded_amount_cents: 0,
      kind: "one_time",
      entity_type: "post",
      entity_id: "post-1",
    });

  beforeEach(() => {
    h.stripe.sessions = [{ id: "cs_zamowienie", metadata: { orderId: ORDER_UUID } }];
    db.setResponse("payment_orders", (chain) => {
      if (chain.has("update")) return ok([{ id: BILLING_IDS.order }]);
      // Własna baza nie zna intencji; sesja (albo `metadata.orderId`) - tak.
      const or = String(chain.argsOf("or")?.[0] ?? "");
      return ok(or.includes("cs_zamowienie") ? [pending()] : []);
    });
  });

  it("PAY-07: zwrot przed realizacją znajduje zamówienie przez sesję i zapisuje stan zwrotu z intencją", async () => {
    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(h.stripe.calls).toEqual(["invoicePayments.list", "checkout.sessions.list"]);
    expect(patches("payment_orders")[0]).toMatchObject({
      status: "refunded",
      refunded_amount_cents: 4900,
      // Kolejne zdarzenia trafią w zamówienie bez pytania operatora.
      provider_payment_intent_id: TXN,
    });
    const sessionLookup = db
      .chainsFor("payment_orders")
      .find((chain) => String(chain.argsOf("or")?.[0] ?? "").includes("cs_zamowienie"));
    expect(sessionLookup?.argsOf("or")?.[0]).toBe(
      `provider_session_id.eq.cs_zamowienie,id.eq.${ORDER_UUID}`,
    );
    // Środowisko korekty - ta sama reguła P0 co przy dopasowaniu po intencji.
    expect(sessionLookup?.calls).toContainEqual({ method: "eq", args: ["environment", "sandbox"] });
  });

  it("`metadata.orderId` spoza kształtu UUID nie trafia do filtra `or(...)`", async () => {
    h.stripe.sessions = [{ id: "cs_zamowienie", metadata: { orderId: "x),id.eq.cudze" } }];

    await applyRefundEffects(refundEvent());

    const ors = db
      .chainsFor("payment_orders")
      .map((chain) => String(chain.argsOf("or")?.[0] ?? ""));
    expect(ors).toContain("provider_session_id.eq.cs_zamowienie");
    expect(ors.some((filter) => filter.includes("cudze"))).toBe(false);
  });

  it("sesja bez naszego zamówienia schodzi na darowiznę", async () => {
    h.stripe.sessions = [];
    scene.refundedDonations = [{ id: "don-1" }];

    expect(await applyRefundEffects(refundEvent())).toBe("donation_refunded");
  });

  it("awaria operatora przy szukaniu celu RZUCA - zwrot nie może przepaść po cichu", async () => {
    // Webhook kończy się 500 i operator ponawia; `skipped` w tym miejscu
    // zostawiłby dostęp klientowi, który odzyskał pieniądze.
    h.stripe.failure = Object.assign(new Error("api_connection_error"), { statusCode: 500 });

    await expect(applyRefundEffects(refundEvent())).rejects.toThrow("api_connection_error");
    expect(patches("payment_orders")).toHaveLength(0);
    expect(db.chainsFor("donations")).toHaveLength(0);
  });
});

describe("PAY-07 - zwrot planu kupionego przez Stripe odbiera dostęp pod KAŻDYM kluczem", () => {
  it("plan dożywotni: odebranie także pod kluczem sesji i intencji, pod którymi nadał je webhook", async () => {
    // Realizacja z webhooka nadaje plan pod `external_ref` = sesja Checkout,
    // przywrócenie po sporze - pod intencją. `revokeOrderEntitlement` zna
    // wyłącznie klucz zamówienia, więc bez dodatkowych odebrań plan zostawał
    // aktywny po zwrocie.
    scene.order = {
      ...orderRow({ kind: "one_time", plan_id: "plan-lifetime" }),
      provider_session_id: "cs_plan",
      provider_intent_id: "cs_plan",
      provider_payment_intent_id: TXN,
    } as OrderRow;

    expect(await applyRefundEffects(refundEvent())).toBe("order_refunded");

    const refs = filters("user_subscriptions", "eq")
      .filter(([column]) => column === "external_ref")
      .map(([, value]) => value);
    expect(refs).toEqual([BILLING_IDS.order, "cs_plan", TXN]);
  });
});

// =============================================================================
// RUNDA 2 PRZEGLĄDU (S1-S3, 2.x / 5.x / 6.x / 7.x) - każdy blok niżej pada na
// kodzie sprzed poprawki i przechodzi po niej.
// =============================================================================

/** Faktura subskrypcji w kształcie `invoicePayments.list` (rozwinięta). */
function subscriptionInvoice(
  overrides: Record<string, unknown> = {},
  periodEndOffsetMs = 20 * DZIEN,
): Record<string, unknown> {
  return {
    invoice: {
      id: "in_odnowienie",
      billing_reason: "subscription_cycle",
      parent: { subscription_details: { subscription: SUB, metadata: {} } },
      lines: {
        data: [
          {
            period: {
              start: unixAt(periodEndOffsetMs - 30 * DZIEN),
              end: unixAt(periodEndOffsetMs),
            },
          },
        ],
      },
      ...overrides,
    },
  };
}

describe("S2 - spór liczony ze stanu BIEŻĄCEGO u operatora (6.5, 2.3)", () => {
  const DISPUTE = "dp_1Syntetyczny";
  const disputeAt = (status: string) => ({
    id: DISPUTE,
    status,
    amount: 4900,
    currency: "pln",
    payment_intent: TXN,
    charge: "ch_1Syntetyczne",
  });

  beforeEach(() => {
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];
  });

  it("6.5: spóźnione `created` (needs_response) po wygranej NIE zawiesza dostępu ponownie", async () => {
    // Zdarzenie otwarcia przetworzone po `closed(won)` (ponowienie, przegląd
    // zaległych). Dawniej zawieszało dostęp zwycięzcy na stałe.
    h.stripe.disputes.set(DISPUTE, disputeAt("won"));
    scene.order = orderRow({ status: "paid" });

    const outcome = await applyRefundEffects(
      refundEvent({
        adjustmentId: DISPUTE,
        action: "chargeback_warning",
        status: "open",
        providerStatus: "needs_response",
      }),
    );

    expect(outcome).toBe("order_restored");
    expect(h.stripe.calls[0]).toBe("disputes.retrieve");
    expect(patches("payment_orders").some((patch) => patch.status === "refunded")).toBe(false);
    expect(patches("user_subscriptions").some((patch) => patch.status === "canceled")).toBe(false);
    expect(adminBells()[0]).toMatchObject({
      p_title_pl: "Spór płatniczy rozstrzygnięty",
      p_href: `/admin/billing?dispute=${DISPUTE}&phase=won`,
    });
  });

  it("2.3: spór zatrzymany AUTOMATYCZNYM ZWROTEM (`prevented`) odbiera dostęp ostatecznie, z własnym alertem", async () => {
    // Zdarzenie niesie jeszcze status sprzed zamknięcia - o skutku decyduje
    // stan u operatora.
    h.stripe.disputes.set(DISPUTE, disputeAt("prevented"));
    scene.order = orderRow({ kind: "one_time", entity_type: "post", entity_id: "post-1" });

    const outcome = await applyRefundEffects(
      refundEvent({ adjustmentId: DISPUTE, action: "chargeback", status: "reversed" }),
    );

    expect(outcome).toBe("order_refunded");
    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(patches("user_purchases")[0]).toMatchObject({ status: "refunded" });
    expect(db.chainsFor("user_purchases").some((chain) => chain.has("upsert"))).toBe(false);
    expect(emails()).toHaveLength(0);
    expect(adminBells()[0]).toMatchObject({
      p_title_pl: "Spór zakończony zwrotem płatności",
      p_href: `/admin/billing?dispute=${DISPUTE}&phase=prevented`,
    });
  });

  it("awaria odczytu sporu RZUCA, zanim cokolwiek zapisze - operator ponowi", async () => {
    h.stripe.failure = Object.assign(new Error("api_connection_error"), { statusCode: 500 });

    await expect(
      applyRefundEffects(
        refundEvent({ adjustmentId: DISPUTE, action: "chargeback_warning", status: "open" }),
      ),
    ).rejects.toThrow("api_connection_error");
    expect(db.chains).toHaveLength(0);
  });

  it("spór nieznany operatorowi (404) - skutek ze stanu zdarzenia, z ostrzeżeniem w logu", async () => {
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = await applyRefundEffects(
      refundEvent({ adjustmentId: DISPUTE, action: "chargeback_warning", status: "open" }),
    );

    expect(outcome).toBe("order_refunded");
    expect(JSON.stringify(warnLog.mock.calls)).toContain("dispute unknown to the provider");
    warnLog.mockRestore();
  });

  it("korekta spoza Stripe (bez `dp_`) nie pyta operatora o spór", async () => {
    await applyRefundEffects(refundEvent({ action: "chargeback_warning", status: "open" }));

    expect(h.stripe.calls).not.toContain("disputes.retrieve");
  });
});

describe("2.7 / 5.11 / 6.6 / 6.7 / 7.4 - alert o sporze RAZ na spór i fazę", () => {
  beforeEach(() => {
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];
  });

  it("dwa RÓŻNE spory w tym samym oknie dostają dwa różne adresy - nie sklejają się w jeden dzwonek", async () => {
    await applyRefundEffects(
      refundEvent({ adjustmentId: "adj_A", action: "chargeback_warning", status: "open" }),
    );
    await applyRefundEffects(
      refundEvent({ adjustmentId: "adj_B", action: "chargeback_warning", status: "open" }),
    );

    expect(adminBells().map((bell) => bell.p_href)).toEqual([
      "/admin/billing?dispute=adj_A&phase=open",
      "/admin/billing?dispute=adj_B&phase=open",
    ]);
  });

  it("ponowienie sporu po kwadransie NIE dubluje dzwonka - odbiorca ma już alert z tym adresem", async () => {
    db.setResponse("notifications", (chain) =>
      chain.has("insert") ? ok(null) : ok([{ id: "bell-juz-jest" }]),
    );

    await applyRefundEffects(refundEvent({ action: "chargeback_warning", status: "open" }));

    expect(adminBells()).toHaveLength(0);
    const lookup = db.chainsFor("notifications").find((chain) => chain.has("select"));
    expect(lookup?.calls).toContainEqual({
      method: "eq",
      args: ["href", "/admin/billing?dispute=adj_1Syntetyczna&phase=open"],
    });
  });
});

describe("S1 - korekta faktury subskrypcji: okres bieżący vs zakończony (2.1, 2.2, 2.10, 5.0, 5.1, 5.7)", () => {
  beforeEach(() => {
    scene.order = null;
    scene.subscription = subscriptionRow();
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];
  });

  it("2.1: pełny zwrot faktury za ZAKOŃCZONY okres nie odbiera dostępu bieżącego okresu", async () => {
    // Zwrot starej (albo proracyjnej sprzed cyklu) faktury odbierał dostęp do
    // opłaconego BIEŻĄCEGO okresu, a `refunded` blokował każde kolejne
    // odnowienie - klient płacił bez dostępu.
    h.stripe.invoicePayments = [subscriptionInvoice({ id: "in_stara" }, -10 * DZIEN)];

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    // Klient nie dostaje „dostęp zakończony" - bo nie jest.
    expect(emails()).toHaveLength(0);
    expect(inserted("notifications")).toHaveLength(0);
    // Zespół dostaje ślad - raz na zwrot.
    expect(adminBells()[0]).toMatchObject({
      p_title_pl: "Zwrot faktury za zakończony okres",
      p_href: "/admin/billing?refund=adj_1Syntetyczna&phase=past_period",
    });
  });

  it("S1: pełny zwrot faktury BIEŻĄCEGO okresu - `refunded` z `canceled_at` = teraz, mail i dzwonek", async () => {
    h.stripe.invoicePayments = [subscriptionInvoice()];

    expect(await applyRefundEffects(refundEvent())).toBe("subscription_refunded");
    expect(patches("user_subscriptions")[0]).toMatchObject({
      status: "refunded",
      canceled_at: relativeIso(0),
    });
    expect(emails()[0]).toMatchObject({ type: "payment_refunded" });
  });

  it("2.2/5.0: spór OTWARTY na bieżącym okresie zapisuje `refunded` (trzyma przez `subscription.updated`), nie zawieszenie `canceled`", async () => {
    h.stripe.invoicePayments = [subscriptionInvoice()];

    const outcome = await applyRefundEffects(
      refundEvent({ action: "chargeback_warning", status: "open" }),
    );

    expect(outcome).toBe("subscription_refunded");
    expect(patches("user_subscriptions")[0]).toMatchObject({
      status: "refunded",
      canceled_at: relativeIso(0),
    });
    // 2.4: spór nie wysyła klientowi potwierdzenia zwrotu.
    expect(emails()).toHaveLength(0);
    expect(inserted("notifications")).toHaveLength(0);
    expect(String(adminBells()[0].p_body_pl)).toContain("wstrzymany do rozstrzygnięcia");
  });

  it("2.10/5.7: spór PRZEGRANY po otwartym nie wysyła klientowi drugiego dzwonka ani maila; CRM: utrata klienta", async () => {
    h.stripe.invoicePayments = [subscriptionInvoice()];
    // Wiersz jest już `refunded` od otwarcia - zapis niczego nie zmienia.
    scene.revokedEntitlements = [];

    const outcome = await applyRefundEffects(refundEvent({ action: "chargeback" }));

    expect(outcome).toBe("skipped");
    expect(emails()).toHaveLength(0);
    expect(inserted("notifications")).toHaveLength(0);
    expect(inserted("crm_leads")[0]?.tags).toEqual(expect.arrayContaining(["churned"]));
    expect(adminBells()[0]).toMatchObject({ p_title_pl: "Spór płatniczy przegrany" });
  });

  it("S1: spór o fakturę za ZAKOŃCZONY okres nie rusza dostępu - alert mówi to wprost", async () => {
    h.stripe.invoicePayments = [subscriptionInvoice({ id: "in_stara" }, -3 * DZIEN)];

    const outcome = await applyRefundEffects(
      refundEvent({ action: "chargeback_warning", status: "open" }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(String(adminBells()[0].p_body_pl)).toContain("zakończonego okresu");
  });

  it("S1: wygrany spór o fakturę za zakończony okres niczego nie przywraca (nie cofa cudzej korekty)", async () => {
    h.stripe.invoicePayments = [subscriptionInvoice({ id: "in_stara" }, -3 * DZIEN)];

    const outcome = await applyRefundEffects(
      refundEvent({ action: "chargeback", status: "reversed" }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(h.stripe.calls).not.toContain("subscriptions.retrieve");
  });
});

describe("5.3 - korekta faktury, która domknęła NASZE zamówienie subskrypcji (księgi)", () => {
  const SUB_ORDER = {
    ...orderRow({ id: ORDER_UUID, kind: "subscription", amount_cents: 4900 }),
    provider_intent_id: "cs_kasa",
  };

  function routeOrders(): void {
    db.setResponse("payment_orders", (chain) => {
      if (chain.has("update")) return ok(null);
      if (chain.has("maybeSingle")) return ok(SUB_ORDER);
      return ok([]);
    });
  }

  beforeEach(() => {
    scene.subscription = subscriptionRow();
    routeOrders();
  });

  it("pełny zwrot pierwszej faktury (`subscription_create`) zamyka zamówienie w księgach", async () => {
    h.stripe.invoicePayments = [
      subscriptionInvoice({
        billing_reason: "subscription_create",
        parent: {
          subscription_details: { subscription: SUB, metadata: { orderId: ORDER_UUID } },
        },
      }),
    ];

    await applyRefundEffects(refundEvent());

    const lookup = db.chainsFor("payment_orders").find((chain) => chain.has("maybeSingle"));
    expect(lookup?.calls).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["id", ORDER_UUID] },
        { method: "eq", args: ["kind", "subscription"] },
        { method: "eq", args: ["provider_subscription_id", SUB] },
        { method: "eq", args: ["environment", "sandbox"] },
      ]),
    );
    expect(patches("payment_orders")[0]).toMatchObject({
      status: "refunded",
      refunded_amount_cents: 4900,
    });
  });

  it("zwrot częściowy pierwszej faktury zapisuje licznik bez zamykania zamówienia", async () => {
    h.stripe.invoicePayments = [
      subscriptionInvoice({
        billing_reason: "subscription_create",
        parent: {
          subscription_details: { subscription: SUB, metadata: { orderId: ORDER_UUID } },
        },
      }),
    ];
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});

    await applyRefundEffects(refundEvent({ amountCents: 1000, capturedAmountCents: 4900 }));

    expect(patches("payment_orders")[0]).toEqual(
      expect.objectContaining({ refunded_amount_cents: 1000 }),
    );
    expect(patches("payment_orders")[0]).not.toHaveProperty("status");
    warnLog.mockRestore();
  });

  it("zwrot ODNOWIENIA (ta sama subskrypcja, ten sam `orderId` w metadanych) nie rusza zamówienia z pierwszej kasy", async () => {
    h.stripe.invoicePayments = [
      subscriptionInvoice({
        billing_reason: "subscription_cycle",
        parent: {
          subscription_details: { subscription: SUB, metadata: { orderId: ORDER_UUID } },
        },
      }),
    ];

    await applyRefundEffects(refundEvent());

    expect(patches("payment_orders")).toHaveLength(0);
  });
});

describe("2.6 - darowizna: zwrot i spór trafiają po sesji, fakturze i `donationId`", () => {
  const DONATION_UUID = "55555555-dddd-4ddd-8ddd-555555555555";

  beforeEach(() => {
    scene.order = null;
    scene.admins = [{ user_id: "admin-b" }];
    scene.adminProfiles = [{ id: "admin-b", tenant_id: BILLING_IDS.foreignTenant }];
    scene.donationTenant = BILLING_IDS.foreignTenant;
  });

  it("spór o wpłatę jednorazową (zapisaną z SESJĄ) alarmuje najemcę darowizny; otwarcie nie zamyka wpłaty", async () => {
    h.stripe.sessions = [
      { id: "cs_darowizna", metadata: { purpose: "donation", donationId: DONATION_UUID } },
    ];

    await applyRefundEffects(refundEvent({ action: "chargeback_warning", status: "open" }));

    expect(alertTenants()).toEqual([BILLING_IDS.foreignTenant]);
    expect(orFilters("donations")[0]).toBe(
      [
        `provider_intent_id.eq.${TXN}`,
        "provider_intent_id.eq.cs_darowizna",
        "provider_session_id.eq.cs_darowizna",
        `id.eq.${DONATION_UUID}`,
      ].join(","),
    );
    expect(patches("donations")).toHaveLength(0);
  });

  it("spór PRZEGRANY zamyka wpłatę (`refunded`) - pieniądze wróciły do darczyńcy", async () => {
    h.stripe.sessions = [
      { id: "cs_darowizna", metadata: { purpose: "donation", donationId: DONATION_UUID } },
    ];
    scene.refundedDonations = [{ id: DONATION_UUID }];

    expect(await applyRefundEffects(refundEvent({ action: "chargeback" }))).toBe(
      "donation_refunded",
    );
    expect(patches("donations")[0]).toEqual({ status: "refunded" });
  });

  it("pełny zwrot wpłaty z sesji oznacza ją `refunded` (dawniej zostawała `paid`)", async () => {
    h.stripe.sessions = [
      { id: "cs_darowizna", metadata: { purpose: "donation", donationId: DONATION_UUID } },
    ];
    scene.refundedDonations = [{ id: DONATION_UUID }];

    expect(await applyRefundEffects(refundEvent())).toBe("donation_refunded");
    expect(orFilters("donations")).toContain(
      [
        `provider_intent_id.eq.${TXN}`,
        "provider_intent_id.eq.cs_darowizna",
        "provider_session_id.eq.cs_darowizna",
        `id.eq.${DONATION_UUID}`,
      ].join(","),
    );
  });

  it("zwrot odnowienia darowizny CYKLICZNEJ trafia we wpłatę po fakturze, nie w uprawnienia subskrypcji", async () => {
    h.stripe.invoicePayments = [
      subscriptionInvoice({
        id: "in_darowizna",
        parent: {
          subscription_details: {
            subscription: "sub_darowizna",
            metadata: { purpose: "donation" },
          },
        },
      }),
    ];
    scene.refundedDonations = [{ id: "don-renewal" }];

    expect(await applyRefundEffects(refundEvent())).toBe("donation_refunded");
    expect(orFilters("donations")).toContain(
      `provider_intent_id.eq.${TXN},provider_intent_id.eq.in_darowizna`,
    );
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    // Kotwica (`donationId` subskrypcji) wskazuje PIERWSZĄ wpłatę - nie wolno
    // jej zamknąć zwrotem odnowienia.
    const parts = orFilters("donations").flatMap((filter) => filter.split(","));
    expect(parts.some((part) => part.startsWith("id.eq."))).toBe(false);
  });

  it("zwrot CZĘŚCIOWY darowizny zostawia ją opłaconą", async () => {
    h.stripe.sessions = [
      { id: "cs_darowizna", metadata: { purpose: "donation", donationId: DONATION_UUID } },
    ];
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      await applyRefundEffects(refundEvent({ amountCents: 1000, capturedAmountCents: 4900 })),
    ).toBe("skipped");
    expect(patches("donations")).toHaveLength(0);
    warnLog.mockRestore();
  });
});

describe("2.9 - zwrot w PODSTAWIE ZAMÓWIENIA (ta sama, co w bazie i raportach)", () => {
  it("obciążenie z podatkiem na wierzchu: zwrot kwoty netto jest częściowy - i dla TS, i dla bazy", async () => {
    // Zamówienie 49,00 netto, obciążenie 60,27 brutto. Zwrot 49,00 zapisany
    // wprost dawał licznik = kwota zamówienia: baza (licznik >= kwota)
    // odwoływała zgłoszenie, a TS (49 < 60,27) zostawiał dostęp.
    scene.order = orderRow({ amount_cents: 4900, metadata: { event_id: EVENT_ID } });

    await applyRefundEffects(refundEvent({ amountCents: 4900, capturedAmountCents: 6027 }));

    expect(patches("payment_orders")[0]).toEqual(
      expect.objectContaining({ refunded_amount_cents: 3984 }),
    );
    expect(patches("payment_orders")[0]).not.toHaveProperty("status");
    expect(h.rpc.calls[0]).toMatchObject({
      args: { p_outcome: "partial_refund", p_refunded_cents: 3984 },
    });
  });

  it("pełny zwrot brutto księguje DOKŁADNIE kwotę zamówienia - bez ujemnego przychodu netto", async () => {
    scene.order = orderRow({ amount_cents: 4900 });

    await applyRefundEffects(refundEvent({ amountCents: 6027, capturedAmountCents: 6027 }));

    expect(patches("payment_orders")[0]).toMatchObject({
      status: "refunded",
      refunded_amount_cents: 4900,
    });
  });
});

describe("S3 / 7.7 - zwrot po samoczynnym zwrocie nadsprzedanego biletu", () => {
  it("zamówienie już `refunded` z pełną kwotą: bez maila, dzwonka, przeliczenia biletu i zapisów uprawnień", async () => {
    scene.order = orderRow({
      kind: "one_time",
      plan_id: null,
      status: "refunded",
      refunded_amount_cents: 4900,
      metadata: { event_id: EVENT_ID },
    });

    expect(await applyRefundEffects(refundEvent({ adjustmentId: "re_oversold" }))).toBe("skipped");
    expect(emails()).toHaveLength(0);
    expect(inserted("notifications")).toHaveLength(0);
    expect(h.rpc.calls).toHaveLength(0);
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(db.chainsFor("user_purchases")).toHaveLength(0);
  });
});

describe("2.11 - nieudany zwrot (`refund.failed`): przeliczenie, przywrócenie, alert raz", () => {
  const failedRefund = (overrides: Partial<RefundEvent> = {}) =>
    refundEvent({
      adjustmentId: "re_nieudany",
      action: "refund",
      status: "failed",
      failureReason: "expired_or_canceled_card",
      ...overrides,
    });

  beforeEach(() => {
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];
    h.stripe.charge = chargeState({ amount_refunded: 0 });
    db.setResponse("payment_orders", (chain) => {
      if (chain.has("update")) return ok([{ id: BILLING_IDS.order }]);
      if (chain.has("maybeSingle")) return ok(scene.order);
      return ok(scene.order ? [scene.order] : []);
    });
  });

  it("zakup jednorazowy: zamówienie wraca na `paid`, licznik z operatora, dostęp wraca, zespół dostaje alert", async () => {
    scene.order = orderRow({
      kind: "one_time",
      entity_type: "post",
      entity_id: "post-1",
      status: "refunded",
      refunded_amount_cents: 4900,
    });

    const outcome = await applyRefundEffects(failedRefund());

    expect(outcome).toBe("order_restored");
    expect(h.stripe.calls).toContain("paymentIntents.retrieve");
    expect(patches("payment_orders")[0]).toMatchObject({
      status: "paid",
      refunded_amount_cents: 0,
    });
    expect(filters("payment_orders", "eq")).toContainEqual(["status", "refunded"]);
    expect(db.chainsFor("user_purchases")[0]?.argsOf("upsert")?.[0]).toMatchObject({
      status: "active",
    });
    expect(emails()).toHaveLength(0);
    expect(adminBells()[0]).toMatchObject({
      p_title_pl: "Zwrot płatności nie powiódł się",
      p_href: "/admin/billing?refund=re_nieudany&phase=failed",
    });
    expect(String(adminBells()[0].p_body_pl)).toContain("expired_or_canceled_card");
  });

  it("inny zwrot tego obciążenia się udał (nadal pełny) - tylko księgi, dostęp zostaje odebrany", async () => {
    scene.order = orderRow({ status: "refunded", refunded_amount_cents: 4900 });
    h.stripe.charge = chargeState({ amount_refunded: 4900, refunded: true });

    expect(await applyRefundEffects(failedRefund())).toBe("skipped");
    expect(patches("payment_orders")).toEqual([
      expect.objectContaining({ refunded_amount_cents: 4900 }),
    ]);
    expect(patches("payment_orders")[0]).not.toHaveProperty("status");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
  });

  it("zwrot częściowy, który przepadł: licznik w dół, zamówienie opłacone zostaje opłacone", async () => {
    scene.order = orderRow({ status: "paid", refunded_amount_cents: 1000 });

    expect(await applyRefundEffects(failedRefund())).toBe("skipped");
    expect(patches("payment_orders")[0]).toEqual(
      expect.objectContaining({ refunded_amount_cents: 0 }),
    );
    expect(patches("payment_orders")[0]).not.toHaveProperty("status");
  });

  it("bilet NIE wraca sam (miejsce mogło przejść na listę rezerwową) - decyzja organizatora w alercie", async () => {
    scene.order = orderRow({
      kind: "one_time",
      plan_id: null,
      status: "refunded",
      refunded_amount_cents: 4900,
      metadata: { event_id: EVENT_ID, registration_id: "reg-1" },
    });

    expect(await applyRefundEffects(failedRefund())).toBe("order_restored");
    expect(patches("payment_orders")[0]).toMatchObject({ status: "paid" });
    expect(db.chainsFor("user_purchases")).toHaveLength(0);
    // Bez RPC biletu: jedynym wywołaniem poza dzwonkami jest eskalacja
    // zlecenia zwrotu zgłoszenia (INV-19c) - miejsce wraca decyzją człowieka.
    expect(
      h.rpc.calls.filter((call) => call.fn !== "enqueue_notification").map((call) => call.fn),
    ).toEqual(["_event_registration_refund_failed"]);
    expect(String(adminBells()[0].p_body_pl)).toContain("wymaga decyzji organizatora");
  });

  it("plan dożywotni odebrany zwrotem (`refunded`) wraca - pieniądze są u nas", async () => {
    scene.order = {
      ...orderRow({
        kind: "one_time",
        plan_id: "plan-lifetime",
        status: "refunded",
        refunded_amount_cents: 4900,
      }),
      provider_intent_id: "cs_plan",
    } as OrderRow;
    scene.existingEntitlement = { id: "us-plan", status: "refunded" };

    expect(await applyRefundEffects(failedRefund())).toBe("order_restored");
    const revive = db.chainsFor("user_subscriptions").find((chain) => chain.has("update"));
    expect(revive?.argsOf("update")?.[0]).toMatchObject({ status: "active", canceled_at: null });
    expect(revive?.has("neq")).toBe(false);
  });

  it("obciążenie objęte sporem: zwrot przepadł, ale o dostępie i księgach decyduje spór", async () => {
    // Spór przegrany zapisał kwotę wycofaną przez bank - `amount_refunded`
    // operatora jej nie zna, więc przeliczenie wymazałoby ją z ksiąg.
    scene.order = orderRow({ status: "refunded", refunded_amount_cents: 4900 });
    h.stripe.charge = chargeState({ amount_refunded: 0, disputed: true });

    expect(await applyRefundEffects(failedRefund())).toBe("skipped");
    expect(patches("payment_orders")).toHaveLength(0);
    expect(String(adminBells()[0].p_body_pl)).toContain("objęta sporem");
  });

  it("subskrypcja, bieżący okres: korekta `refunded` wraca ze stanem operatora (`force`)", async () => {
    scene.order = null;
    scene.subscription = subscriptionRow();
    scene.existingEntitlement = { id: "us-1", status: "refunded", canceled_at: relativeIso(-1) };
    h.stripe.invoicePayments = [subscriptionInvoice()];

    expect(await applyRefundEffects(failedRefund())).toBe("subscription_restored");
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "active" });
    expect(h.stripe.calls).toContain("subscriptions.retrieve");
  });

  it("darowizna wraca na `paid`", async () => {
    scene.order = null;
    scene.donationTenant = BILLING_IDS.tenant;
    scene.refundedDonations = [{ id: "don-1" }];

    expect(await applyRefundEffects(failedRefund())).toBe("donation_restored");
    expect(patches("donations")[0]).toEqual({ status: "paid" });
    expect(filters("donations", "eq")).toContainEqual(["status", "refunded"]);
  });

  it("płatność nieznana operatorowi: nic nie zmieniamy, alert prosi o ręczną weryfikację", async () => {
    scene.order = orderRow({ status: "refunded", refunded_amount_cents: 4900 });
    h.stripe.charge = null;

    expect(await applyRefundEffects(failedRefund())).toBe("skipped");
    expect(patches("payment_orders")).toHaveLength(0);
    expect(String(adminBells()[0].p_body_pl)).toContain("sprawdź dostęp ręcznie");
  });

  it("awaria operatora RZUCA (ponowienie), a zespół i tak dostaje alert", async () => {
    scene.order = orderRow({ status: "refunded", refunded_amount_cents: 4900 });
    h.stripe.failure = Object.assign(new Error("api_connection_error"), { statusCode: 500 });

    await expect(applyRefundEffects(failedRefund())).rejects.toThrow("api_connection_error");
    expect(String(adminBells()[0].p_body_pl)).toContain("zostanie ponowiona automatycznie");
    expect(patches("payment_orders")).toHaveLength(0);
  });
});
