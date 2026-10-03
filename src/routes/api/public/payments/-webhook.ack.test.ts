// @vitest-environment node
//
// ODPOWIEDŹ WEBHOOKA DLA OPERATORA PŁATNOŚCI - co Stripe dostaje z powrotem i
// co zostaje w dzienniku zdarzeń.
//
// JAKIE RYZYKO PILNUJE TEN PLIK. Kod odpowiedzi jest tu decyzją o pieniądzach:
//   * 2xx = „mam, nie ponawiaj". 200 na zdarzeniu, które PADŁO, gubi je na
//     zawsze - klient zapłacił, uprawnienia nie dostał, nikt nie ponowi;
//   * nie-2xx = „ponów". 500 na zdarzeniu, którego CELOWO nie obsługujemy,
//     to trzy dni ponowień i fałszywe alarmy;
//   * 400 dla zdarzenia bez ważnego podpisu albo z podpisem INNEGO
//     środowiska - inaczej każdy mógłby wysłać „opłacono" i odblokować treść,
//     a zdarzenie opłacone kartą testową przeszłoby jako live.
// Do tego dziennik `payment_webhook_events`: każde zweryfikowane zdarzenie ma
// w nim wiersz z kluczami, po których panel /admin/billing filtruje
// (subskrypcja, klient, użytkownik), i status domknięcia zgodny z odpowiedzią.
//
// Siostrzany `-webhook.test.ts` jedzie ścieżkami PRZETWARZANIA zdarzeń
// subskrypcji (z atrapą weryfikacji podpisu). Ten plik bierze ścieżki
// ODMOWY, POMINIĘCIA i AWARII - z PRAWDZIWYM podpisem HMAC, prawdziwą
// normalizacją, prawdziwym dziennikiem i prawdziwym dyspozytorem.
//
// GRANICE ATRAP: klient roli serwisowej Supabase, `runAfterResponse` (punkt
// zaczepienia `ctx.waitUntil` runtime'u Workers - bez niego praca „za
// odpowiedzią" byłaby wyścigiem z końcem pliku, patrz `-webhook.test.ts`) oraz
// kontrola odcisku katalogu, która woła operatora przez sieć.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseResult,
} from "@/test/supabase/chain";
import { routeServerHandlers } from "@/test/routeHarness";
import { FIXED_NOW_ISO, FIXED_NOW_MS, SEKUNDA, freezeClock } from "@/test/time";

const h = vi.hoisted(() => ({
  db: { current: null as { from: (table: string) => unknown } | null },
  afterResponse: [] as Promise<unknown>[],
  catalogSync: vi.fn<(env: string) => Promise<void>>(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
  },
}));
vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => {
    h.afterResponse.push(work);
  },
}));
vi.mock("@/lib/billing/catalogAutoSync.server", () => ({
  ensureCatalogSynced: (env: string) => h.catalogSync(env),
}));

import { Route, __handleForTests as handle } from "./webhook";

freezeClock();

const SECRETS = { sandbox: "whsec_sandbox_test_1", live: "whsec_live_test_1" } as const;
const NOW_S = Math.floor(FIXED_NOW_MS / SEKUNDA);
const LOG = "payment_webhook_events";

const db = supabaseFromStub();

/** Odpowiedzi bazy dla dziennika i strażnika kolejności subskrypcji. */
interface DbPlan {
  logInsert?: SupabaseResult;
  /** Odczyt istniejącego wiersza po duplikacie (`maybeSingle`). */
  logLookup?: SupabaseResult;
  /** Warunkowe przejęcie wiersza (UPDATE ... RETURNING id); domyślnie wygrane. */
  logReclaim?: SupabaseResult;
  /** Warunkowy UPDATE `last_event_at` (RETURNING id) - `claimSubscriptionEvent`. */
  subscriptionGuard?: SupabaseResult | (() => SupabaseResult | Promise<SupabaseResult>);
  subscriptionExists?: SupabaseResult;
}

function planDb(p: DbPlan = {}) {
  db.setResponse(LOG, (chain: RecordedChain) => {
    if (chain.has("insert")) return p.logInsert ?? ok(null);
    if (chain.has("maybeSingle")) return p.logLookup ?? ok(null);
    // Warunkowe przejęcie (UPDATE ... RETURNING id): domyślnie ta dostawa wygrała wyścig.
    if (chain.has("update") && chain.has("select")) {
      return p.logReclaim ?? ok([{ id: "row-reclaimed" }]);
    }
    return ok(null);
  });
  db.setResponse("subscriptions", (chain: RecordedChain) => {
    if (chain.has("update")) {
      const guard = p.subscriptionGuard ?? ok([{ id: "row-sub-1" }]);
      return typeof guard === "function" ? guard() : guard;
    }
    return p.subscriptionExists ?? ok(null);
  });
}

function signed(event: Record<string, unknown>, env: "sandbox" | "live", secret = SECRETS[env]) {
  const body = JSON.stringify(event);
  const v1 = createHmac("sha256", secret).update(`${NOW_S}.${body}`).digest("hex");
  return new Request(`https://example.com/api/public/payments/webhook?env=${env}`, {
    method: "POST",
    headers: { "stripe-signature": `t=${NOW_S},v1=${v1}` },
    body,
  });
}

/** Zdarzenie w kształcie z bramki operatora. */
function stripeEvent(type: string, object: Record<string, unknown>, id = "evt_test_1") {
  return { id, type, created: NOW_S, data: { object } };
}

/** Odnowienie darowizny cyklicznej odrzucone przez bank - transakcja z subskrypcją. */
const DONATION_RENEWAL_FAILED = stripeEvent("invoice.payment_failed", {
  id: "in_test_1",
  customer: "cus_test_1",
  subscription: "sub_donation_1",
  currency: "pln",
  total: 5000,
  amount_paid: 0,
  customer_email: "anna@example.com",
  metadata: { purpose: "donation", donationId: "don-1", userId: "user-me" },
});

/** Zmiana stanu subskrypcji - `customer.subscription.updated`. */
const SUBSCRIPTION_UPDATED = stripeEvent("customer.subscription.updated", {
  id: "sub_test_1",
  customer: "cus_test_1",
  status: "active",
  metadata: { userId: "user-me" },
  items: { data: [] },
});

const logInsert = () =>
  db
    .chainsFor(LOG)
    .find((c) => c.has("insert"))
    ?.argsOf("insert")?.[0];
const eqFilters = (chain: RecordedChain) =>
  chain.calls.filter((c) => c.method === "eq").map((c) => c.args);
/** Domknięcie wiersza - UPDATE zawężony po `event_id` (przejęcie idzie po `id`). */
const finishChain = () =>
  db
    .chainsFor(LOG)
    .find((c) => c.has("update") && eqFilters(c).some(([column]) => column === "event_id"));
const logFinish = () => finishChain()?.argsOf("update")?.[0];
const touchedTables = () => [...new Set(db.chains.map((c) => c.table))].sort();

beforeEach(() => {
  db.reset();
  h.db.current = db;
  h.afterResponse.length = 0;
  h.catalogSync.mockReset();
  h.catalogSync.mockResolvedValue(undefined);
  vi.stubEnv("PAYMENTS_SANDBOX_WEBHOOK_SECRET", SECRETS.sandbox);
  vi.stubEnv("PAYMENTS_LIVE_WEBHOOK_SECRET", SECRETS.live);
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Bez prawdziwej sieci: ścieżka ACK nie może wołać operatora ani maila
  // synchronicznie. Próba wyjścia do sieci = awaria dyspozytora = 500 w teście.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("test: sieć zablokowana w teście webhooka"))),
  );
});

afterEach(async () => {
  await Promise.all(h.afterResponse);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("webhook płatności - odmowy przed dziennikiem", () => {
  it.each([
    ["bez parametru środowiska", "https://example.com/api/public/payments/webhook"],
    ["z nieznanym środowiskiem", "https://example.com/api/public/payments/webhook?env=staging"],
  ])("adres %s: 400 i żadnego zapisu", async (_label, url) => {
    planDb();
    const valid = signed(SUBSCRIPTION_UPDATED, "live");

    const res = await handle(
      new Request(url, { method: "POST", headers: valid.headers, body: await valid.text() }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid environment");
    expect(db.chains).toHaveLength(0);
    expect(h.afterResponse).toHaveLength(0);
  });

  it("podpis sandboxa wysłany na adres live: 400, zdarzenie nie trafia do dziennika", async () => {
    planDb();
    const sandboxSigned = signed(SUBSCRIPTION_UPDATED, "sandbox");
    const asLive = new Request("https://example.com/api/public/payments/webhook?env=live", {
      method: "POST",
      headers: sandboxSigned.headers,
      body: await sandboxSigned.text(),
    });

    const res = await handle(asLive);

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid signature");
    expect(db.chains).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith(
      "[payments] webhook signature rejected",
      expect.objectContaining({ message: "Invalid webhook signature" }),
    );
  });
});

describe("webhook płatności - zdarzenia przyjęte przez trasę HTTP", () => {
  it("zdarzenie spoza integracji: 200 (koniec ponowień), dziennik z surowym typem, `skipped`", async () => {
    planDb();
    // Sesja „unpaid" (przelew w toku) - pieniądze przyjdą osobnym zdarzeniem.
    const unpaid = stripeEvent("checkout.session.completed", {
      id: "cs_test_1",
      payment_status: "unpaid",
      customer: "cus_test_1",
    });

    const res = await routeServerHandlers(Route).POST!({ request: signed(unpaid, "sandbox") });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(logInsert()).toEqual({
      event_id: "evt_test_1",
      event_type: "checkout.session.completed",
      environment: "sandbox",
      occurred_at: FIXED_NOW_ISO,
      subscription_id: null,
      customer_id: null,
      user_id: null,
      payload: unpaid,
      status: "received",
    });
    expect(logFinish()).toEqual({
      status: "skipped",
      error: null,
      processed_at: FIXED_NOW_ISO,
      duration_ms: 0,
    });
    // Nic poza dziennikiem: pominięte zdarzenie nie dotyka żadnej warstwy.
    expect(touchedTables()).toEqual([LOG]);
  });

  it("transakcja odnowienia: dziennik dostaje subskrypcję z transakcji i użytkownika z metadanych", async () => {
    planDb();

    const res = await handle(signed(DONATION_RENEWAL_FAILED, "live"));

    expect(res.status).toBe(200);
    expect(logInsert()).toMatchObject({
      event_type: "transaction.payment_failed",
      environment: "live",
      subscription_id: "sub_donation_1",
      customer_id: "cus_test_1",
      user_id: "user-me",
    });
    expect(logFinish()).toMatchObject({ status: "processed", error: null });
  });

  it("płatność jednorazowa: identyfikator sesji NIE ląduje w dzienniku jako subskrypcja", async () => {
    // Tylko zdarzenia `subscription.*` niosą subskrypcję w `data.id` - dla
    // transakcji to identyfikator sesji. Pomyłka przypięłaby płatność
    // jednorazową do nieistniejącej subskrypcji w filtrach panelu.
    planDb();

    const res = await handle(
      signed(
        stripeEvent("checkout.session.async_payment_failed", {
          id: "cs_test_2",
          customer: "cus_test_1",
          payment_status: "unpaid",
          metadata: { userId: "user-me" },
        }),
        "live",
      ),
    );

    expect(res.status).toBe(200);
    expect(logInsert()).toMatchObject({
      event_type: "transaction.payment_failed",
      subscription_id: null,
      customer_id: "cus_test_1",
      user_id: "user-me",
    });
    expect(logFinish()).toMatchObject({ status: "processed" });
  });

  it("spóźnione zdarzenie subskrypcji (stan w bazie nowszy): 200 i `skipped`, bez nadpisania", async () => {
    planDb({ subscriptionGuard: ok([]), subscriptionExists: ok({ id: "row-sub-1" }) });

    const res = await handle(signed(SUBSCRIPTION_UPDATED, "live"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(logInsert()).toMatchObject({
      event_type: "subscription.updated",
      // Dla zdarzeń `subscription.*` subskrypcją jest sam obiekt zdarzenia.
      subscription_id: "sub_test_1",
      customer_id: "cus_test_1",
      user_id: "user-me",
    });
    expect(logFinish()).toMatchObject({ status: "skipped", error: null });
    // Jedyny zapis do `subscriptions` to warunkowy strażnik - żadnego upsertu.
    const writes = db.chainsFor("subscriptions").filter((c) => c.has("update") || c.has("upsert"));
    expect(writes).toHaveLength(1);
    expect(writes[0]!.argsOf("update")?.[0]).toEqual({ last_event_at: FIXED_NOW_ISO });
  });
});

describe("webhook płatności - ponowna dostawa tego samego zdarzenia", () => {
  it("zdarzenie, które wcześniej PADŁO: przejęte i przetworzone - 200 bez `duplicate`", async () => {
    // Najdroższa pomyłka tej trasy: uznać ponowienie po 500 za duplikat. Stripe
    // po 200 przestaje ponawiać, więc zdarzenie zostałoby niewykonane na zawsze.
    planDb({
      logInsert: fail('duplicate key value violates unique constraint "uq_event"', "23505"),
      logLookup: ok({
        id: "row-failed-1",
        status: "failed",
        created_at: FIXED_NOW_ISO,
        retry_count: 1,
      }),
    });

    const res = await handle(signed(DONATION_RENEWAL_FAILED, "live"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    const reclaim = db
      .chainsFor(LOG)
      .find((c) => c.has("update") && eqFilters(c).some(([column]) => column === "id"));
    expect(eqFilters(reclaim!)).toEqual([
      ["id", "row-failed-1"],
      ["status", "failed"],
      ["retry_count", 1],
    ]);
    expect(reclaim!.argsOf("update")?.[0]).toMatchObject({
      status: "received",
      error: null,
      retry_count: 2,
    });
    expect(logFinish()).toMatchObject({ status: "processed", error: null });
    expect(eqFilters(finishChain()!)).toEqual([
      ["event_id", "evt_test_1"],
      ["environment", "live"],
    ]);
  });

  it("przegrany wyścig o przejęcie `failed`: 200 `duplicate`, bez drugiej obsługi i domknięcia", async () => {
    // Naprawa z panelu (albo równoległa dostawa) przejęła ten sam wiersz chwilę
    // wcześniej - warunkowy UPDATE nie dopasował żadnego wiersza. Obsługę
    // wykonuje TYLKO zwycięzca; ta dostawa nie może jej powtórzyć ani nadpisać
    // jego wyniku swoim domknięciem.
    planDb({
      logInsert: fail('duplicate key value violates unique constraint "uq_event"', "23505"),
      logLookup: ok({
        id: "row-failed-1",
        status: "failed",
        created_at: FIXED_NOW_ISO,
        retry_count: 1,
      }),
      logReclaim: ok([]),
    });

    const res = await handle(signed(SUBSCRIPTION_UPDATED, "live"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(touchedTables()).toEqual([LOG]);
    expect(finishChain()).toBeUndefined();
    expect(h.afterResponse).toHaveLength(0);
  });

  it("zdarzenie już domknięte: 200 `duplicate`, bez obsługi, domknięcia i pracy za odpowiedzią", async () => {
    planDb({
      logInsert: fail('duplicate key value violates unique constraint "uq_event"', "23505"),
      logLookup: ok({
        id: "row-done-1",
        status: "processed",
        created_at: FIXED_NOW_ISO,
        retry_count: 0,
      }),
    });

    const res = await handle(signed(SUBSCRIPTION_UPDATED, "live"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(touchedTables()).toEqual([LOG]);
    expect(db.chainsFor(LOG).filter((c) => c.has("update"))).toHaveLength(0);
    expect(h.afterResponse).toHaveLength(0);
  });
});

describe("webhook płatności - awarie", () => {
  it("awaria obsługi: 500 (operator ponowi) i `failed` z komunikatem w dzienniku", async () => {
    planDb({ subscriptionGuard: fail("deadlock detected") });

    const res = await handle(signed(SUBSCRIPTION_UPDATED, "live"));

    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Webhook error");
    expect(logFinish()).toEqual({
      status: "failed",
      error: "subscription event claim failed: deadlock detected",
      processed_at: FIXED_NOW_ISO,
      duration_ms: 0,
    });
    expect(console.error).toHaveBeenCalledWith("[payments] webhook error", expect.any(Error));
  });

  it("awaria spoza klasy Error (odrzucenie napisem) trafia do dziennika jako tekst", async () => {
    planDb({ subscriptionGuard: () => Promise.reject("upstream connect error") });

    const res = await handle(signed(SUBSCRIPTION_UPDATED, "live"));

    expect(res.status).toBe(500);
    expect(logFinish()).toMatchObject({ status: "failed", error: "upstream connect error" });
  });

  it("awaria dziennika nie blokuje obsługi: zdarzenie przetworzone mimo to (fail-open)", async () => {
    // Lepiej przetworzyć zdarzenie dwa razy (dyspozytor ma własne strażniki)
    // niż zgubić płatność, bo nie dało się zapisać wiersza audytu.
    planDb({ logInsert: fail("permission denied", "42501") });

    const res = await handle(signed(DONATION_RENEWAL_FAILED, "live"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(logFinish()).toMatchObject({ status: "processed" });
    expect(console.error).toHaveBeenCalledWith(
      "[payments] webhook log failed",
      expect.objectContaining({ message: "webhook log insert failed: permission denied" }),
    );
  });

  it("kontrola katalogu za odpowiedzią: jej awaria jest logowana i nie zmienia ACK", async () => {
    planDb();
    h.catalogSync.mockRejectedValue(new Error("gateway timeout"));

    const res = await handle(signed(DONATION_RENEWAL_FAILED, "sandbox"));
    expect(res.status).toBe(200);

    await Promise.all(h.afterResponse);

    expect(h.catalogSync).toHaveBeenCalledWith("sandbox");
    expect(console.error).toHaveBeenCalledWith(
      "[payments] auto-sync check failed",
      expect.objectContaining({ message: "gateway timeout" }),
    );
  });
});
