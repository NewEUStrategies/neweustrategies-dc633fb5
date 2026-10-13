// Rdzeń obsługi zdarzeń operatora płatności - GAŁĘZIE ODMOWY (49% gałęzi,
// 46 niepokrytych linii do 31.08.2026).
//
// SKĄD LUKA. Jedyny test dotykający dotąd tego modułu (`-webhook.test.ts`)
// jedzie SZCZĘŚLIWĄ ŚCIEŻKĄ trasy HTTP: zdarzenie poprawne, ładunek pełny,
// baza odpowiada bez błędu. Poza zasięgiem został cały ruch, którym system
// odmawia: spóźniona i powtórzona dostawa, zdarzenie nieznanego typu,
// uszkodzony ładunek, zamówienie z INNEGO ŚRODOWISKA, korekty rozliczeniowe
// (zwroty i spory) oraz błędy bazy w strażniku kolejności.
//
// DLACZEGO TO JEST RYZYKO, A NIE POKRYCIE DLA POKRYCIA. Ten plik jest jedynym
// miejscem, przez które pieniądze zamieniają się w uprawnienia. Każda gałąź
// odmowy pilnuje innego pieniężnego błędu:
//   * POWTÓRKA. Operator ponawia dostarczenie tego samego zdarzenia, a panel
//     admina potrafi je odtworzyć ręcznie. Drugi przebieg NIE MOŻE zdublować
//     skutku ani cofnąć nowszego stanu - ale zdarzenie, którego skutki PADŁY,
//     musi przejść jeszcze raz (strażnik: para `last_event_at` +
//     `last_event_id`; remis w obrębie sekundy rozstrzyga stan z API).
//   * CUDZE ZAMÓWIENIE. Webhook sandboxa nie ma prawa zrealizować zamówienia
//     ze środowiska produkcyjnego (karta testowa -> prawdziwy bilet), a na
//     wdrożeniu produkcyjnym nie nadaje niczego w ogóle (PAY-05).
//   * USZKODZONY ŁADUNEK. Ma polec GŁOŚNO (dziennik zapisze `failed`), a nie
//     zapisać połowę skutku.
//   * NIEZNANY TYP. Ma być `skipped` bez ANI JEDNEGO zapytania do bazy -
//     operator wysyła dziesiątki typów, których integracja nie obsługuje.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta Supabase (`client.server`) i SDK
// operatora (`stripe.server`). Sąsiedzi z `@/lib/billing/*` i
// `@/lib/organizations/*` biegną PRAWDZIWYM kodem - inaczej test dowodziłby
// tylko tego, że dispatch woła własne atrapy. Żadne żądanie nie wychodzi do
// sieci: klient operatora jest atrapą, a warstwa mailowa nie ma w teście
// klienta serwisowego (`sendTxEmail` kończy się `supabase_unavailable`).
//
// RODO: wszystkie adresy są syntetyczne (`example.com`), identyfikatory
// operatora zmyślone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type TableResponder,
} from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { rowStore, type RowStore } from "@/test/billing/rowStore";
import type { SubscriptionData, TransactionData } from "@/lib/billing/webhookDispatch.server";

let db: SupabaseFromStub;
let rpc: SupabaseRpcStub;
/** Klient operatora wyłącznie dla remisu znaczników - domyślnie brak (bezpiecznik). */
let stripeClient: { subscriptions: { retrieve: (id: string) => Promise<unknown> } } | null = null;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => db.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => rpc.rpc(name, args),
  },
}));

/**
 * Odczyt subskrypcji z API operatora - JEDYNE wyjście do operatora, na które
 * pozwalamy (remis w obrębie sekundy). `null` = przypadek nie ma prawa wołać.
 */
const stripeApi = vi.hoisted(() => ({
  retrieve: null as null | ((id: string, params?: unknown) => Promise<unknown>),
  calls: [] as Array<{ id: string; params: unknown }>,
}));

// Granica operatora. Atrapa jest tu BEZPIECZNIKIEM: gdyby któraś ścieżka
// (np. zwrot za nadkomplet miejsc) sięgnęła po klienta Stripe, test ma polec
// z jawnym komunikatem, a nie wyjść do sieci z kluczem ze środowiska. Reszta
// modułu (`environmentGrantsAccess`) zostaje PRAWDZIWA - to czysta funkcja,
// o której dyspozytor decyduje, co zdarzenie może nadać.
vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getConnectionApiKey: () => "test_klucz_atrapy",
  getWebhookSecret: () => "test_sekret_atrapy",
  getStripeClient: async () => {
    if (!stripeClient) throw new Error("test: żaden przypadek nie ma prawa wołać operatora");
    return stripeClient;
  },
  getStripeErrorMessage: (error: unknown) => String(error),
  resolveEnvironment: () => "sandbox",
  verifyWebhook: () => {
    throw new Error("test: weryfikacja podpisu nie należy do tej warstwy");
  },
}));

const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");

/** Tabele, których dotyka rozgałęziona obsługa - domyślnie „pusto, bez błędu". */
const TABLES = [
  "subscriptions",
  "user_subscriptions",
  "access_plans",
  "payment_orders",
  "billing_documents",
  "billing_profiles",
  "donations",
  "notifications",
  "crm_leads",
  "profiles",
  "newsletter_subscribers",
  "member_organizations",
  "event_rsvps",
  "membership_grants",
] as const;

const OCCURRED_AT = "2026-08-30T10:00:00.000Z";
const LATER = "2026-08-30T11:00:00.000Z";

/**
 * Zdarzenie subskrypcji w kształcie, jaki dostaje dispatch PO normalizacji
 * (`stripeEvents.server`): `externalId` ceny to `lookup_key`, a produktu -
 * `metadata.lovable_external_id`. Domyślnie plan spoza cennika zespołowego,
 * żeby przypadek nie wciągał ścieżki miejsc organizacji.
 */
function subscriptionEvent(overrides: Partial<SubscriptionData> = {}): SubscriptionData {
  return {
    id: "sub_atrapa_1",
    customerId: "cus_atrapa_1",
    status: "active",
    customData: { userId: "user-kupujacy" },
    currentBillingPeriod: {
      startsAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-09-01T00:00:00.000Z",
    },
    items: [
      {
        quantity: 1,
        price: { id: "pri_atrapa", externalId: "pro_monthly" },
        product: { id: "prod_atrapa", externalId: "plan_pro" },
      },
    ],
    ...overrides,
  };
}

/** Transakcja (faktura / sesja) w kształcie po normalizacji. */
function transactionEvent(overrides: Partial<TransactionData> = {}): TransactionData {
  return {
    id: "txn_atrapa_1",
    subscriptionId: "sub_atrapa_1",
    customerId: "cus_atrapa_1",
    paymentIntentId: "pi_atrapa_1",
    currencyCode: "PLN",
    customData: null,
    customer: { email: "kupujacy@example.com" },
    details: { totals: { grandTotal: "4900" } },
    ...overrides,
  };
}

interface SubscriptionsPlan {
  /** Czy warunkowy UPDATE strażnika zajął zdarzenie (zwrócił wiersz). */
  claimed?: boolean;
  /** Wiersz oddawany przez `maybeSingle()` (odczyt istniejącej subskrypcji). */
  row?: Record<string, unknown> | null;
  claimError?: string;
  lookupError?: string;
  writeError?: string;
  /**
   * Czy wstawienie-jeśli-brak (`upsert(..., { ignoreDuplicates })
   * .select("id")`) zapisało wiersz. Domyślnie tak (wiersza nie było);
   * `false` = konflikt, wiersz już istnieje.
   */
  inserted?: boolean;
}

/**
 * Jeden responder na tabelę `subscriptions` rozróżnia CZTERY różne zapytania,
 * które robi ta ścieżka: warunkowy UPDATE strażnika kolejności
 * (`update(...).select("id")` - zwraca wiersze), wstawienie-jeśli-brak
 * (`upsert(...).select("id")` - zwraca wstawione wiersze), odczyt stanu
 * (`maybeSingle`) i zwykły zapis (`update`).
 */
function subscriptionsResponder(plan: SubscriptionsPlan): TableResponder {
  return (chain: RecordedChain) => {
    if (chain.has("upsert") && chain.has("select")) {
      if (plan.writeError) return fail(plan.writeError);
      return ok(plan.inserted === false ? [] : [{ id: "row_nowy" }]);
    }
    if (chain.has("update") && chain.has("select")) {
      if (plan.claimError) return fail(plan.claimError);
      return ok(plan.claimed === false ? [] : [{ id: "row_dziennika" }]);
    }
    if (chain.has("maybeSingle")) {
      if (plan.lookupError) return fail(plan.lookupError);
      return ok(plan.row ?? null);
    }
    if (chain.has("update")) {
      return plan.writeError ? fail(plan.writeError) : ok([{ id: "row_dziennika" }]);
    }
    return ok(null);
  };
}

/** Zapytania (ogniwa łańcucha) wykonane na tabeli - do asercji „nic nie tknęło". */
const writesOn = (table: string): RecordedChain[] =>
  db
    .chainsFor(table)
    .filter((c) => c.has("insert") || c.has("update") || c.has("upsert") || c.has("delete"));

/** Ładunek zapisu (pierwszy argument `update`/`insert`/`upsert`) z tabeli. */
function writePayload(table: string, method: "update" | "insert" | "upsert"): unknown {
  return db
    .chainsFor(table)
    .find((c) => c.has(method))
    ?.argsOf(method)?.[0];
}

beforeEach(() => {
  stripeClient = null;
  db = supabaseFromStub();
  rpc = supabaseRpcStub();
  for (const table of TABLES) db.setResponse(table, ok(null));
  stripeApi.retrieve = null;
  stripeApi.calls = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("zdarzenie spoza zakresu integracji", () => {
  it("nieznany typ zdarzenia jest POMIJANY bez jednego zapytania do bazy", async () => {
    // Operator wysyła dziesiątki typów, których nie obsługujemy
    // (`payout.*`, `checkout.session.expired`, ...). Każde takie zdarzenie ma
    // dostać ACK bez śladu w bazie - inaczej integracja płaciłaby zapytaniem
    // za każdy szum z konta operatora, a dziennik pokazywałby ruch, którego
    // nie ma.
    const outcome = await dispatchWebhookEvent({
      eventType: "payout.created",
      data: { id: "po_atrapa", kwota: 1000 },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    expect(db.chains).toHaveLength(0);
    expect(rpc.calls).toHaveLength(0);
  });

  it("nieznany typ ze ŚMIECIOWYM ładunkiem też jest tylko pominięty", async () => {
    // Kolejność ma znaczenie: rozpoznanie typu MUSI iść przed dotknięciem
    // ładunku. Gdyby dispatch zaglądał do danych przed `switch`em, zdarzenie
    // spoza zakresu z pustym ładunkiem wywracałoby obsługę i operator
    // ponawiałby je przez trzy doby.
    const outcome = await dispatchWebhookEvent({
      eventType: "nieznany.typ",
      data: null,
      environment: "sandbox",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    expect(db.chains).toHaveLength(0);
  });

  it("uszkodzony ładunek zdarzenia subskrypcji pada GŁOŚNO i nic nie zapisuje", async () => {
    // Ładunek `null` przy typie, który obsługujemy, znaczy „normalizacja albo
    // dziennik są zepsute". Odmowa musi być wyjątkiem, bo tylko wtedy trasa
    // zapisze zdarzenie jako `failed` i pokaże je w panelu. Cichy `skipped`
    // udawałby zdarzenie spoza zakresu i sprawa zniknęłaby z oczu.
    await expect(
      dispatchWebhookEvent({
        eventType: "subscription.updated",
        data: null,
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow();

    expect(db.chains).toHaveLength(0);
  });
});

/** Wiersz `subscriptions` w tabeli w pamięci - stan po poprzednim zdarzeniu. */
function storedSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub-baza-1",
    provider_subscription_id: "sub_atrapa_1",
    environment: "live",
    user_id: "user-kupujacy",
    tenant_id: "tenant-alfa",
    price_id: "pro_monthly",
    product_id: "plan_pro",
    status: "active",
    current_period_end: "2026-09-01T00:00:00.000Z",
    last_event_at: "2026-08-29T10:00:00.000Z",
    last_event_id: "evt_poprzednie",
    ...overrides,
  };
}

/** Tabela `subscriptions` w pamięci: strażnik działa na prawdziwej semantyce. */
function subscriptionsTable(rows: Record<string, unknown>[] = []): RowStore {
  const store = rowStore({
    rows,
    unique: ["provider_subscription_id"],
    timestamps: ["last_event_at"],
  });
  db.setResponse("subscriptions", (chain) => store.respond(chain));
  return store;
}

/** Plan płatny w najemcy subskrypcji - odwzorowanie ceny na plan. */
const PLAN_PRO = { id: "plan-pro-m", tenant_id: "tenant-alfa", price_cents: 9900, currency: "PLN" };

describe("strażnik kolejności zdarzeń subskrypcji (idempotencja)", () => {
  it("pierwsza dostawa: zdarzenie zajmuje wiersz parą (znacznik, identyfikator) i przenosi stan", async () => {
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({
        claimed: true,
        // Subskrypcja bez właściciela: skutki uprawnień mają własne testy,
        // tutaj interesuje nas SAM strażnik i zapis stanu.
        row: { user_id: null, price_id: "pro_monthly", status: "active", current_period_end: null },
      }),
    );

    const outcome = await dispatchWebhookEvent({
      eventId: "evt_past_due",
      eventType: "subscription.past_due",
      data: subscriptionEvent({ status: "past_due" }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    const claim = db.chainsFor("subscriptions")[0];
    // Para strażnika ląduje JEDNYM zapisem: znacznik i identyfikator zdarzenia,
    // którego skutki właśnie startują.
    expect(claim?.argsOf("update")?.[0]).toEqual({
      last_event_at: OCCURRED_AT,
      last_event_id: "evt_past_due",
    });
    // Warunek atomowy: zajmujemy wyłącznie wiersz starszy niż zdarzenie.
    expect(claim?.argsOf("or")?.[0]).toBe(`last_event_at.is.null,last_event_at.lt.${OCCURRED_AT}`);
    const stateWrite = db.chainsFor("subscriptions").find(isStateWrite);
    expect(stateWrite?.argsOf("update")?.[0]).toMatchObject({ status: "past_due" });
    // Zapis stanu jest WARUNKIEM na to zajęcie (1.0): nowsze zdarzenie, które
    // przejęło wiersz w trakcie skutków, nie zostanie nadpisane.
    expect(stateWrite?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["provider_subscription_id", "sub_atrapa_1"],
      ["environment", "live"],
      ["last_event_at", OCCURRED_AT],
      ["last_event_id", "evt_past_due"],
    ]);
  });

  it("POWTÓRZONA dostawa tego samego zdarzenia nie dubluje skutku", async () => {
    // Idempotencja stoi na warunku `last_event_at < occurredAt`: przy DRUGIM
    // przebiegu tego samego zdarzenia znacznik jest już równy, więc warunkowy
    // UPDATE nie zajmuje wiersza. Bez tej gałęzi ponowna dostawa (albo
    // ponowienie z panelu admina) przeliczałaby uprawnienia i CRM po raz drugi.
    // Wiersz po PIERWSZYM przebiegu: znacznik tego zdarzenia i jego stan.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({
        claimed: false,
        row: {
          id: "sub-baza-1",
          last_event_at: OCCURRED_AT,
          status: "active",
          price_id: "pro_monthly",
          quantity: 1,
          current_period_start: "2026-08-01T00:00:00.000Z",
          current_period_end: "2026-09-01T00:00:00.000Z",
          trial_ends_at: null,
          cancel_at_period_end: false,
          pause_collection_behavior: null,
        },
      }),
      environment: "live" as const,
      occurredAt: OCCURRED_AT,
    };

    await expect(dispatchWebhookEvent(renewal)).rejects.toThrow(
      "entitlement sync: update failed (sub_atrapa_1): connection reset",
    );
    // Wiersz NIESIE zdarzenie, którego skutki wystartowały - i nic więcej.
    expect(subscriptions.rows[0]).toMatchObject({
      last_event_at: OCCURRED_AT,
      last_event_id: "evt_odnowienie",
    });

    // Ponowna dostawa (operator po 500, panel albo zamiatarka): to samo zdarzenie.
    const outcome = await dispatchWebhookEvent(renewal);

    expect(outcome).toBe("processed");
    expect(entitlementWrites).toBe(2);
    const entitlement = db
      .chainsFor("user_subscriptions")
      .filter((c) => c.has("update"))
      .at(-1);
    expect(entitlement?.argsOf("update")?.[0]).toMatchObject({
      status: "active",
      current_period_end: "2026-10-01T00:00:00.000Z",
    });
    expect(subscriptions.rows[0]).toMatchObject({
      current_period_end: "2026-10-01T00:00:00.000Z",
      last_event_id: "evt_odnowienie",
    });
  });

  it("to samo zdarzenie po UDANEJ obsłudze: skutki idempotentne - jedno uprawnienie, jeden dzwonek", async () => {
    // Ponowienie zamkniętego zdarzenia z panelu (admin świadomie otwiera wiersz
    // `processed`) przechodzi obsługę jeszcze raz. Widoczne skutki NIE mogą się
    // zdublować: uprawnienie ma klucz `external_ref` (unikalny), a przejście
    // stanu (dzwonek, mail, CRM) liczy się od ZAPISANEGO statusu, który po
    // pierwszym przebiegu jest już nowy.
    const subscriptions = subscriptionsTable([storedSubscription({ status: "paused" })]);
    db.setResponse("access_plans", ok(PLAN_PRO));
    db.setResponse("profiles", ok({ email: "kupujacy@example.com", tenant_id: "tenant-alfa" }));
    const entitlements = rowStore({
      rows: [{ id: "us-1", external_ref: "sub_atrapa_1", status: "canceled" }],
      unique: ["external_ref"],
    });
    db.setResponse("user_subscriptions", (chain) => entitlements.respond(chain));
    const resumed = {
      eventId: "evt_wznowienie",
      eventType: "subscription.resumed",
      data: subscriptionEvent({ status: "active" }),
      environment: "live" as const,
      occurredAt: OCCURRED_AT,
    };

    expect(await dispatchWebhookEvent(resumed)).toBe("processed");
    expect(await dispatchWebhookEvent(resumed)).toBe("processed");

    expect(subscriptions.rows).toHaveLength(1);
    expect(entitlements.rows).toHaveLength(1);
    expect(entitlements.rows[0]).toMatchObject({ status: "active" });
    // Dzwonek „wznowiona" tylko po pierwszym przebiegu.
    expect(db.chainsFor("notifications").filter((c) => c.has("insert"))).toHaveLength(1);
  });

  it("SPÓŹNIONE zdarzenie (starszy znacznik) jest pomijane i nie dotyka stanu", async () => {
    // `past_due` sprzed odnowienia dostarczone PO nim cofnęłoby klienta do
    // zaległości. Zapisany stan jest nowszy - zdarzenie tylko się loguje.
    const subscriptions = subscriptionsTable([
      storedSubscription({ last_event_at: LATER, last_event_id: "evt_nowsze" }),
    ]);

    const outcome = await dispatchWebhookEvent({
      eventId: "evt_starsze",
      eventType: "subscription.past_due",
      data: subscriptionEvent({ status: "past_due" }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    expect(subscriptions.rows[0]).toMatchObject({
      status: "active",
      last_event_at: LATER,
      last_event_id: "evt_nowsze",
    });
    expect(writesOn("user_subscriptions")).toHaveLength(0);
    expect(writesOn("crm_leads")).toHaveLength(0);
    expect(writesOn("notifications")).toHaveLength(0);
  });

  it("remis znaczników z RÓŻNYM stanem pyta operatora; subskrypcji nieznanej operatorowi nie stosuje", async () => {
    // Dwa różne zdarzenia z tej samej sekundy: kolejności nie da się odczytać
    // z czasu, więc decyduje żywy stan operatora. Gdy operator już jej nie zna
    // (np. usunięta w piaskownicy), nie ma czego stosować - bez zgadywania.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({
        claimed: false,
        row: {
          id: "sub-baza-1",
          last_event_at: OCCURRED_AT,
          status: "active",
          price_id: "pro_monthly",
          quantity: 1,
          current_period_start: "2026-08-01T00:00:00.000Z",
          current_period_end: "2026-09-01T00:00:00.000Z",
          trial_ends_at: null,
          cancel_at_period_end: true,
          pause_collection_behavior: null,
        },
      }),
    );
    const retrieve = vi.fn(async () => {
      throw Object.assign(new Error("No such subscription"), { code: "resource_missing" });
    });
    stripeClient = { subscriptions: { retrieve } };

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.updated",
      data: subscriptionEvent(),
      environment: "sandbox",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    expect(retrieve).toHaveBeenCalledWith("sub_atrapa_1", { expand: ["items.data.price.product"] });
    const stateWrites = db
      .chainsFor("subscriptions")
      .filter((c) => c.has("update") && !c.has("select"));
    expect(stateWrites).toHaveLength(0);
  });

  it("SPÓŹNIONA rezygnacja nie cofa nowszego stanu subskrypcji", async () => {
    // `subscription.canceled` sprzed godziny dostarczone PO wznowieniu
    // skasowałoby dostęp klientowi, który właśnie zapłacił. Ta sama bramka co
    // wyżej, ale osobna gałąź w `switch` - i osobne pieniądze.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({ claimed: false, row: { id: "sub-baza-1", last_event_at: LATER } }),
    );

    const outcome = await dispatchWebhookEvent({
      eventId: "evt_rezygnacja",
      eventType: "subscription.canceled",
      data: subscriptionEvent({ status: "canceled" }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    expect(subscriptions.rows[0]).toMatchObject({ status: "active", last_event_at: LATER });
  });

  it("REMIS w obrębie sekundy: inne zdarzenie z tym samym znacznikiem bierze stan z API operatora", async () => {
    // Stripe podaje czas z dokładnością do sekundy - `created` i `updated` jednej
    // kasy mają często ten sam znacznik. Dawniej drugie było „spóźnione"
    // i ginęło. Który ładunek jest nowszy, nie wiadomo, więc stan rozstrzyga
    // odczyt subskrypcji u operatora, a nie ładunek zdarzenia.
    const subscriptions = subscriptionsTable([
      storedSubscription({
        status: "incomplete",
        last_event_at: OCCURRED_AT,
        last_event_id: "evt_a",
      }),
    ]);
    stripeApi.retrieve = async () => ({
      id: "sub_atrapa_1",
      customer: "cus_atrapa_1",
      status: "past_due",
      metadata: { userId: "user-kupujacy" },
      items: {
        data: [
          {
            quantity: 1,
            current_period_end: Date.parse("2026-09-01T00:00:00.000Z") / 1000,
            price: { id: "pri_atrapa", lookup_key: "pro_monthly", product: "prod_atrapa" },
          },
        ],
      },
    });

    const outcome = await dispatchWebhookEvent({
      eventId: "evt_b",
      eventType: "subscription.updated",
      // Ładunek mówi `active` - ale to może być starsze z dwóch zdjęć sekundy.
      data: subscriptionEvent({ status: "active" }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(stripeApi.calls).toEqual([
      { id: "sub_atrapa_1", params: { expand: ["items.data.price.product"] } },
    ]);
    expect(subscriptions.rows[0]).toMatchObject({
      status: "past_due",
      last_event_at: OCCURRED_AT,
      last_event_id: "tie:evt_b",
    });
  });

  it("po remisie KAŻDE zdarzenie tej sekundy (także ponowienie zwycięzcy) idzie po stan z API", async () => {
    // Bez znacznika `tie:` ponowienie zwycięzcy remisu wyglądałoby jak zwykłe
    // `replay` i zastosowało WŁASNY ładunek - czyli być może starsze zdjęcie.
    const subscriptions = subscriptionsTable([
      storedSubscription({ last_event_at: OCCURRED_AT, last_event_id: "tie:evt_b" }),
    ]);
    stripeApi.retrieve = async () => ({
      id: "sub_atrapa_1",
      customer: "cus_atrapa_1",
      status: "active",
      metadata: { userId: "user-kupujacy" },
      items: { data: [{ quantity: 1, price: { id: "pri_atrapa", lookup_key: "pro_monthly" } }] },
    });

    const outcome = await dispatchWebhookEvent({
      eventId: "evt_b",
      eventType: "subscription.updated",
      data: subscriptionEvent({ status: "paused" }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(stripeApi.calls).toHaveLength(1);
    expect(subscriptions.rows[0]).toMatchObject({ status: "active", last_event_id: "tie:evt_b" });
  });

  it("remis bez odpowiedzi operatora to wyjątek (operator ponowi), a nie zgadywanie z ładunku", async () => {
    const subscriptions = subscriptionsTable([
      storedSubscription({ status: "active", last_event_at: OCCURRED_AT, last_event_id: "evt_a" }),
    ]);
    stripeApi.retrieve = async () => {
      throw new Error("gateway timeout");
    };

    await expect(
      dispatchWebhookEvent({
        eventId: "evt_b",
        eventType: "subscription.paused",
        data: subscriptionEvent({ status: "paused" }),
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow("subscription tie: provider read failed (sub_atrapa_1): gateway timeout");

    // Stan nietknięty, a znacznik `tie:` każe ponowieniu znów pytać operatora.
    expect(subscriptions.rows[0]).toMatchObject({ status: "active", last_event_id: "tie:evt_b" });
  });

  it("zdarzenie, które wyprzedziło `created`, NIE jest pomijane - zakłada wiersz z parą strażnika", async () => {
    // Zero zajętych wierszy ma kilka znaczeń - „subskrypcji jeszcze nie ma" to
    // jedno z nich (zakładamy ją). Bez tego pierwszy zakup przepadałby po
    // cichu, gdyby operator dostarczył `activated` przed `created`.
    const subscriptions = subscriptionsTable();

    const outcome = await dispatchWebhookEvent({
      eventId: "evt_aktywacja",
      eventType: "subscription.activated",
      data: subscriptionEvent(),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(subscriptions.rows).toEqual([
      expect.objectContaining({
        user_id: "user-kupujacy",
        provider_subscription_id: "sub_atrapa_1",
        price_id: "pro_monthly",
        status: "active",
        last_event_at: OCCURRED_AT,
        last_event_id: "evt_aktywacja",
      }),
    ]);
    // Wstawienie, nie nadpisanie: `ON CONFLICT DO NOTHING`.
    expect(writePayload("subscriptions", "upsert")).toMatchObject({
      last_event_id: "evt_aktywacja",
    });
    const upsert = db.chainsFor("subscriptions").find((c) => c.has("upsert"));
    expect(upsert?.argsOf("upsert")?.[1]).toEqual({
      onConflict: "provider_subscription_id",
      ignoreDuplicates: true,
    });
  });

  it("zdarzenie w kształcie z bramki (produkt jako sam identyfikator) zakłada subskrypcję", async () => {
    // Stripe w webhooku NIE rozwija `price.product` - metadanych produktu
    // w ładunku nie ma. Identyfikator produktu bierzemy wtedy z katalogu po
    // `lookup_key`; bez tego każde `created` z bramki kończyło się
    // „missing lookup_key/metadata" i subskrypcja nie powstawała wcale.
    const subscriptions = subscriptionsTable();

    const outcome = await dispatchWebhookEvent({
      eventId: "evt_utworzenie",
      eventType: "subscription.created",
      data: subscriptionEvent({
        items: [
          { quantity: 1, price: { id: "pri_atrapa", externalId: "pro_monthly" }, product: null },
        ],
      }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(subscriptions.rows[0]).toMatchObject({
      price_id: "pro_monthly",
      product_id: "plan_pro",
    });
  });

  // KRYTERIUM PAY-10 (spóźnione `created`). Dawniej `created` omijało strażnika,
  // a jego upsert nadpisywał wiersz RAZEM z `last_event_at` - spóźnione albo
  // ponowione `created` po `deleted` wskrzeszało anulowaną subskrypcję
  // (status `active`, uprawnienie, mail „subskrypcja aktywna").
  it("spóźnione `created` po rezygnacji nie zmienia stanu (nie wskrzesza subskrypcji)", async () => {
    const canceled = storedSubscription({
      status: "canceled",
      last_event_at: LATER,
      last_event_id: "evt_usuniecie",
    });
    const subscriptions = subscriptionsTable([canceled]);

    const outcome = await dispatchWebhookEvent({
      eventId: "evt_utworzenie",
      eventType: "subscription.created",
      data: subscriptionEvent({ status: "active" }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    expect(subscriptions.rows).toEqual([canceled]);
    expect(writesOn("user_subscriptions")).toHaveLength(0);
    expect(writesOn("notifications")).toHaveLength(0);
    expect(writesOn("crm_leads")).toHaveLength(0);
  });

  // PRZEGLĄD 1.4. Nagrobek dawniej nie nadawał NICZEGO („uprawnienia nigdy
  // nie nadano"), a spóźnione `created` jest `stale` - klient, który zapłacił
  // za okres i od razu zrezygnował (albo zrobił to support), nie dostawał
  // dostępu wcale, choć ta sama rezygnacja na istniejącym wierszu trzyma go do
  // końca okresu. Okres musi być OPŁACONY - rozstrzyga operator.
  describe("rezygnacja BEZ wiersza (nagrobek)", () => {
    const PAID_UNTIL = "2099-01-01T00:00:00.000Z";

    /** Usunięta subskrypcja w API operatora (kształt Basil, faktura rozwinięta). */
    function canceledRemote(over: Record<string, unknown> = {}) {
      return {
        id: "sub_atrapa_1",
        customer: "cus_atrapa_1",
        status: "canceled",
        metadata: { userId: "user-kupujacy" },
        cancellation_details: { reason: "cancellation_requested" },
        latest_invoice: { id: "in_pierwsza", status: "paid" },
        items: {
          data: [
            {
              quantity: 1,
              current_period_start: Date.parse("2026-08-01T00:00:00.000Z") / 1000,
              current_period_end: Date.parse(PAID_UNTIL) / 1000,
              price: { id: "pri_atrapa", lookup_key: "pro_monthly", product: "prod_atrapa" },
            },
          ],
        },
        ...over,
      };
    }

    const deleted = {
      eventId: "evt_usuniecie",
      eventType: "subscription.canceled",
      data: subscriptionEvent({
        status: "canceled",
        currentBillingPeriod: { startsAt: "2026-08-01T00:00:00.000Z", endsAt: PAID_UNTIL },
      }),
      environment: "live" as const,
      occurredAt: LATER,
    };
    const lateCreated = {
      eventId: "evt_utworzenie",
      eventType: "subscription.created",
      data: subscriptionEvent({ status: "active" }),
      environment: "live" as const,
      occurredAt: OCCURRED_AT,
    };

    let entitlements: RowStore;
    beforeEach(() => {
      db.setResponse("access_plans", ok(PLAN_PRO));
      db.setResponse("profiles", ok({ email: "kupujacy@example.com", tenant_id: "tenant-alfa" }));
      entitlements = rowStore({ unique: ["external_ref"] });
      db.setResponse("user_subscriptions", (chain) => entitlements.respond(chain));
    });

    it("opłacony okres: nagrobek trzyma dostęp do końca okresu, późniejsze `created` go nie wskrzesza", async () => {
      const subscriptions = subscriptionsTable();
      stripeApi.retrieve = async () => canceledRemote();

      expect(await dispatchWebhookEvent(deleted)).toBe("processed");
      expect(await dispatchWebhookEvent(lateCreated)).toBe("skipped");

      expect(subscriptions.rows).toEqual([
        expect.objectContaining({ status: "canceled", last_event_id: "evt_usuniecie" }),
      ]);
      // Ta sama reguła co rezygnacja z istniejącego wiersza:
      // `mapProviderStatus('canceled', koniec w przyszłości)` = dostęp do końca.
      expect(entitlements.rows).toEqual([
        expect.objectContaining({
          external_ref: "sub_atrapa_1",
          status: "active",
          current_period_end: PAID_UNTIL,
          plan_id: PLAN_PRO.id,
        }),
      ]);
      expect(stripeApi.calls).toEqual([
        { id: "sub_atrapa_1", params: { expand: ["latest_invoice"] } },
      ]);
      // Rezygnacja bez wiersza nie wysyła maili ani dzwonków.
      expect(writesOn("notifications")).toHaveLength(0);
    });

    it.each([
      [
        "nieopłacona faktura (subskrypcja `incomplete` anulowana)",
        { latest_invoice: { status: "open" } },
      ],
      ["anulowanie po nieudanej płatności", { cancellation_details: { reason: "payment_failed" } }],
      ["anulowanie po sporze", { cancellation_details: { reason: "payment_disputed" } }],
      ["faktura nierozwinięta (sam identyfikator)", { latest_invoice: "in_pierwsza" }],
    ])("%s: nagrobek BEZ dostępu", async (_label, over) => {
      const subscriptions = subscriptionsTable();
      stripeApi.retrieve = async () => canceledRemote(over);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(await dispatchWebhookEvent(deleted)).toBe("processed");

      expect(subscriptions.rows).toHaveLength(1);
      expect(writesOn("user_subscriptions")).toHaveLength(0);
      warn.mockRestore();
    });

    it("okres już zakończony: nagrobek bez wiersza uprawnienia", async () => {
      subscriptionsTable();
      stripeApi.retrieve = async () =>
        canceledRemote({
          items: {
            data: [
              {
                quantity: 1,
                current_period_end: Date.parse("2020-01-01T00:00:00.000Z") / 1000,
                price: { id: "pri_atrapa", lookup_key: "pro_monthly", product: "prod_atrapa" },
              },
            ],
          },
        });

      expect(await dispatchWebhookEvent(deleted)).toBe("processed");
      expect(writesOn("user_subscriptions")).toHaveLength(0);
    });

    it("operator nie odpowiada: wyjątek PRZED nagrobkiem - ponowienie rozstrzygnie to samo", async () => {
      const subscriptions = subscriptionsTable();
      stripeApi.retrieve = async () => {
        throw new Error("gateway timeout");
      };

      await expect(dispatchWebhookEvent(deleted)).rejects.toThrow(
        "subscription tombstone: provider read failed (sub_atrapa_1): gateway timeout",
      );
      // Bez nagrobka ponowienie znów trafi w `missing`, a nie w `replay`
      // bez skutków.
      expect(subscriptions.rows).toHaveLength(0);
    });

    it("bez planu najemcy (konto zamknięte) nie pyta operatora i nie nadaje niczego", async () => {
      subscriptionsTable();
      db.setResponse("profiles", ok(null));

      expect(await dispatchWebhookEvent(deleted)).toBe("processed");
      expect(stripeApi.calls).toHaveLength(0);
      expect(writesOn("user_subscriptions")).toHaveLength(0);
    });
  });

  it("rezygnacja po ZAMKNIĘCIU KONTA (właściciel usunięty) nie zapętla ponowień", async () => {
    // Zamknięcie konta anuluje subskrypcję u operatora i kasuje konto - wiersz
    // `subscriptions` znika kaskadą. Spóźnione `deleted` nie ma wtedy komu
    // zostawić nagrobka: wstawienie łamie klucz obcy `user_id` (23503), a
    // wyjątek skazałby zdarzenie na ponowienia przez trzy doby.
    db.setResponse("subscriptions", (chain: RecordedChain) => {
      if (chain.has("upsert")) {
        return fail('insert violates foreign key constraint "subscriptions_user_id_fkey"', "23503");
      }
      return chain.has("update") ? ok([]) : ok(null);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = await dispatchWebhookEvent({
      eventId: "evt_usuniecie",
      eventType: "subscription.canceled",
      data: subscriptionEvent({ status: "canceled" }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(warn).toHaveBeenCalledWith(
      "[payments] subscription owner no longer exists",
      "sub_atrapa_1",
    );
    warn.mockRestore();
  });

  // KRYTERIUM PAY-10 (wyścig). `created` i `updated` tej samej subskrypcji
  // przychodzą równolegle, zanim jest wiersz. Dawniej oba widziały „brak",
  // oba upsertowały `subscriptions`, a uprawnienie powstawało DWA razy
  // (unikalności `external_ref` pilnował tylko kod) - późniejsza rezygnacja
  // trafiała w jedno, drugie dawało dostęp bez płatności.
  //
  // PRZEPLOT ODTWARZAMY DETERMINISTYCZNIE, a nie przez `Promise.all`: vitest 4
  // przy RÓWNOLEGŁYM dynamicznym imporcie zmockowanego modułu oddaje moduł
  // prawdziwy (klient bez kluczy). Druga obsługa biegnie więc w całości
  // dokładnie w punkcie, w którym pierwsza właśnie przeczytała „brak" - to
  // najgorszy przeplot, jaki może dać baza.
  it("równoległe `created` i `updated` bez wiersza: jeden wiersz subskrypcji i jedno uprawnienie", async () => {
    const created = {
      eventId: "evt_utworzenie",
      eventType: "subscription.created",
      data: subscriptionEvent({ status: "trialing" }),
      environment: "live" as const,
      occurredAt: OCCURRED_AT,
    };
    const updated = {
      eventId: "evt_zmiana",
      eventType: "subscription.updated",
      data: subscriptionEvent({ status: "active" }),
      environment: "live" as const,
      occurredAt: LATER,
    };
    const subscriptions = rowStore({
      unique: ["provider_subscription_id"],
      timestamps: ["last_event_at"],
    });
    const entitlements = rowStore({ unique: ["external_ref"] });
    let inner: Promise<unknown> | null = null;
    // Odczyt strażnika `updated` zwrócił „brak wiersza" - w tej chwili całe
    // `created` przechodzi obok i zakłada wiersz oraz uprawnienie.
    db.setResponse("subscriptions", async (chain) => {
      const result = await subscriptions.respond(chain);
      const guardRead = chain.argsOf("select")?.[0] === "last_event_at, last_event_id";
      if (guardRead && !chain.has("update") && inner === null) {
        inner = dispatchWebhookEvent(created);
        await inner;
      }
      return result;
    });
    db.setResponse("access_plans", ok(PLAN_PRO));
    // Najemca nowego wiersza (w bazie przypina go trigger) idzie z profilu.
    db.setResponse("profiles", ok({ email: "kupujacy@example.com", tenant_id: "tenant-alfa" }));
    db.setResponse("user_subscriptions", (chain) => entitlements.respond(chain));

    const outer = await dispatchWebhookEvent(updated);

    expect(await inner).toBe("processed");
    expect(outer).toBe("processed");
    expect(subscriptions.rows).toHaveLength(1);
    // Przegrane wstawienie (`ON CONFLICT DO NOTHING`) wróciło do strażnika
    // i zajęło wiersz jako świeże - wygrywa NOWSZE zdarzenie.
    expect(subscriptions.rows[0]).toMatchObject({
      status: "active",
      last_event_at: LATER,
      last_event_id: "evt_zmiana",
    });
    expect(entitlements.rows).toHaveLength(1);
    expect(entitlements.rows[0]).toMatchObject({ external_ref: "sub_atrapa_1", status: "active" });
  });

  it("równoległy zapis uprawnienia: przegrany wyścig (23505) aktualizuje TEN SAM wiersz", async () => {
    // Drugi przeplot tego samego wyścigu: oba zdarzenia czytają „brak
    // uprawnienia", zanim którekolwiek je wstawi. Indeks unikalny
    // `external_ref` (20261012131300) odrzuca drugie wstawienie, a kod zamienia
    // je w aktualizację - nie w drugi wiersz.
    //
    // Skutki zakładania biegną PRZED wstawieniem wiersza (1.2), więc wiersz
    // subskrypcji zakłada tu NOWSZE `updated`, a starsze `created` przegrywa
    // wstawienie i jest spóźnione. Jego zapis uprawnienia wylądował jednak PO
    // zapisie nowszego - stąd wyrównanie stanem z API operatora (1.0).
    const subscriptions = subscriptionsTable();
    const entitlements = rowStore({ unique: ["external_ref"] });
    stripeApi.retrieve = async () => ({
      id: "sub_atrapa_1",
      customer: "cus_atrapa_1",
      status: "active",
      metadata: { userId: "user-kupujacy" },
      items: {
        data: [
          {
            quantity: 1,
            current_period_start: Date.parse("2026-08-01T00:00:00.000Z") / 1000,
            current_period_end: Date.parse("2026-09-01T00:00:00.000Z") / 1000,
            price: { id: "pri_atrapa", lookup_key: "pro_monthly", product: "prod_atrapa" },
          },
        ],
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let inner: Promise<unknown> | null = null;
    db.setResponse("access_plans", ok(PLAN_PRO));
    db.setResponse("profiles", ok({ email: "kupujacy@example.com", tenant_id: "tenant-alfa" }));
    db.setResponse("user_subscriptions", async (chain) => {
      const result = await entitlements.respond(chain);
      if (chain.has("maybeSingle") && inner === null) {
        inner = dispatchWebhookEvent({
          eventId: "evt_zmiana",
          eventType: "subscription.updated",
          data: subscriptionEvent({ status: "active" }),
          environment: "live",
          occurredAt: LATER,
        });
        await inner;
      }
      return result;
    });

    const outer = await dispatchWebhookEvent({
      eventId: "evt_utworzenie",
      eventType: "subscription.created",
      data: subscriptionEvent({ status: "active" }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outer).toBe("processed");
    expect(await inner).toBe("processed");
    expect(subscriptions.rows).toHaveLength(1);
    expect(subscriptions.rows[0]).toMatchObject({
      last_event_at: LATER,
      last_event_id: "evt_zmiana",
    });
    expect(entitlements.rows).toHaveLength(1);
    expect(entitlements.rows[0]).toMatchObject({ status: "active" });
    const chains = db.chainsFor("user_subscriptions");
    expect(chains.filter((c) => c.has("insert"))).toHaveLength(2);
    // Drugie wstawienie przegrało na indeksie i poszło aktualizacją po kluczu,
    // z zachowaniem reguły „zwrot jest ostateczny".
    const refresh = chains.find((c) => c.has("update"));
    expect(refresh?.argsOf("eq")).toEqual(["external_ref", "sub_atrapa_1"]);
    expect(refresh?.argsOf("neq")).toEqual(["status", "refunded"]);
    // Spóźnione `created`, którego zapis uprawnienia już wylądował, pyta
    // operatora o stan - nie zostawia własnego, starszego zapisu.
    expect(stripeApi.calls).toHaveLength(1);
    warn.mockRestore();
  });

  it("zdarzenie bez wiarygodnego czasu nie blokuje aktualizacji ISTNIEJĄCEJ subskrypcji", async () => {
    // Uszkodzony `occurredAt` nie może zatrzymać obsługi - inaczej ponowienie
    // z panelu admina na wierszu dziennika bez czasu nigdy by nie ruszyło.
    // Strażnik przepuszcza wtedy zdarzenie BEZ zajmowania wiersza (nie ma
    // czym porównać kolejności), a stan i tak trafia do subskrypcji.
    //
    // Zdarzenie jest dodatkowo BEZ pozycji cennika, a wiersz w bazie bez
    // zapisanej ceny - to najuboższy możliwy stan (pauza subskrypcji sprzed
    // migracji cennika). Obsługa ma wtedy zapisać sam stan i nie próbować
    // przeliczać uprawnień z ceny, której nie zna.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({
        row: { user_id: null, status: "active", current_period_end: null },
      }),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.updated",
      data: subscriptionEvent({
        status: "paused",
        items: [{ quantity: 1, price: { id: "pri_atrapa", externalId: null }, product: null }],
      }),
      environment: "live",
      occurredAt: "nie-data",
    });

    expect(outcome).toBe("processed");
    // Pominięty strażnik: pierwsze zapytanie to odczyt istnienia, a nie
    // warunkowy `update(...).select("id")`.
    expect(db.chainsFor("subscriptions")[0]?.has("update")).toBe(false);
    expect(writePayload("subscriptions", "update")).toMatchObject({ status: "paused" });
  });

  // DEFEKT NAPRAWIONY 31.08.2026 (kod produkcyjny).
  //
  // CO BYŁO ZŁE. `claimSubscriptionEvent` miał JAWNĄ decyzję projektową dla
  // zdarzenia bez wiarygodnego czasu: „brak wiarygodnego czasu - nie
  // blokujemy" i przepuszczał je dalej. Trzy kroki niżej ta sama wartość
  // trafiała bez żadnej osłony do `new Date(occurredAt).toISOString()`
  // w `handleCreated` i wywalała `RangeError: Invalid time value`. Moduł sam
  // sobie przeczył: najpierw obiecywał tolerancję, a potem padał na dokładnie
  // tej wartości, którą przepuścił. Trafiała w to WYŁĄCZNIE ścieżka
  // „zdarzenie stanu wyprzedziło `created`" - czyli ta, która istnieje po to,
  // żeby zakup nie przepadł, gdy operator dostarczy zdarzenia w złej
  // kolejności.
  //
  // JAKIE TO BYŁO RYZYKO. Skutkiem był wyjątek zamiast zapisu: trasa zwracała
  // 500, dziennik zapisywał `failed`, operator ponawiał dostawę przez trzy
  // doby (a każda próba padała tak samo), a klient przez ten czas nie miał
  // uprawnienia, za które zapłacił. Ponowienie z panelu admina też nie
  // pomagało, bo idzie tą samą funkcją.
  //
  // JAK NAPRAWIONE. Rozstrzygnięcie czasu zdarzenia zamieszkało w jednej
  // funkcji `eventStamp` (`webhookDispatch.server.ts`): strażnik kolejności
  // i ścieżka zakładania czytają ją tak samo, a czas nie do odczytania znaczy
  // teraz „bez pary strażnika", a nie „wyjątek".
  it("zdarzenie bez wiarygodnego czasu zakłada brakującą subskrypcję", async () => {
    const subscriptions = subscriptionsTable();

    // Obsługa domyka się, zamiast wywalać na dacie, którą strażnik świadomie
    // przepuścił.
    await expect(
      dispatchWebhookEvent({
        eventType: "subscription.activated",
        data: subscriptionEvent(),
        environment: "live",
        occurredAt: "nie-data",
      }),
    ).resolves.toBe("processed");
    expect(subscriptions.rows).toHaveLength(1);
    expect(subscriptions.rows[0]).not.toHaveProperty("last_event_at");
  });

  it("błąd bazy w strażniku przerywa obsługę zamiast zgadywać kolejność", async () => {
    // Gdyby błąd zajęcia był traktowany jak „nie zajęto", zdarzenie zostałoby
    // pominięte i klient nie dostałby uprawnienia mimo obciążenia. Wyjątek
    // wraca do trasy, ta zapisuje `failed`, a operator ponawia dostawę.
    db.setResponse("subscriptions", subscriptionsResponder({ claimError: "deadlock detected" }));

    await expect(
      dispatchWebhookEvent({
        eventType: "subscription.updated",
        data: subscriptionEvent(),
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow("subscription event claim failed: deadlock detected");
  });

  it("błąd bazy przy sprawdzaniu istnienia subskrypcji też przerywa obsługę", async () => {
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({ claimed: false, lookupError: "connection reset" }),
    );

    await expect(
      dispatchWebhookEvent({
        eventType: "subscription.updated",
        data: subscriptionEvent(),
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow("subscription lookup failed: connection reset");
  });

  it("wiersz, który zmienia się między każdym zajęciem a odczytem, kończy się wyjątkiem", async () => {
    // Warunkowy UPDATE nie trafia, a odczyt pokazuje STARSZY znacznik - czyli
    // ktoś pisze w tym samym czasie. Po wyczerpaniu prób zdarzenie ma polec
    // głośno (operator ponowi), a nie zakończyć się cichym `skipped`.
    db.setResponse("subscriptions", (chain: RecordedChain) =>
      chain.has("update")
        ? ok([])
        : ok({ last_event_at: "2026-08-01T00:00:00.000Z", last_event_id: "evt_x" }),
    );

    await expect(
      dispatchWebhookEvent({
        eventId: "evt_y",
        eventType: "subscription.updated",
        data: subscriptionEvent(),
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow("subscription event guard: contention (sub_atrapa_1)");
    // Trzy próby: zajęcie + odczyt w każdej.
    expect(db.chainsFor("subscriptions")).toHaveLength(6);
  });
});

describe("aktualizacja stanu subskrypcji - odmowy i przypadki brzegowe", () => {
  it("nieudany zapis stanu przerywa obsługę zamiast udawać sukces", async () => {
    // Zapis stanu jest tu jedynym śladem zdarzenia. Połknięty błąd oznacza
    // dziennik z `processed` przy subskrypcji, która w bazie ma stary status -
    // czyli panel admina kłamie o tym, za co klient płaci.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({
        claimed: true,
        row: { user_id: null, price_id: "pro_monthly", status: "active", current_period_end: null },
        writeError: "column does not exist",
      }),
    );

    await expect(
      dispatchWebhookEvent({
        eventType: "subscription.paused",
        data: subscriptionEvent({ status: "paused" }),
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow("subscriptions update failed: column does not exist");
  });

  it("cena bez odpowiednika w cenniku nie wywraca obsługi zdarzenia", async () => {
    // Plan wycofany z `access_plans` (albo jeszcze nie wdrożony) zostawia
    // subskrypcję z ceną, dla której nie ma planu. Uprawnienia nie da się
    // wtedy przeliczyć - ale zdarzenie MUSI się domknąć, bo inaczej operator
    // ponawiałby je w kółko za każdą zmianę stanu takiej subskrypcji.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({
        claimed: true,
        // Wiersz bez `status`: poprzedni stan jest nieznany, co samo w sobie
        // jest osobną gałęzią (`previousStatus: null`).
        row: { user_id: "user-kupujacy", price_id: "pro_monthly", current_period_end: null },
      }),
    );
    db.setResponse("access_plans", ok(null));

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.updated",
      data: subscriptionEvent(),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    // Bez planu nie ruszamy warstwy dostępu - lepiej brak zmiany niż
    // uprawnienie bez planu, którego panel nie umie pokazać.
    expect(writesOn("user_subscriptions")).toHaveLength(0);
  });

  it("podniesienie planu przenosi uprawnienie i zawiadamia klienta", async () => {
    // Ścieżka zmiany planu (`plus` -> `pro`) jest jedyną, w której zdarzenie
    // zmienia WARSTWĘ dostępu, a nie tylko datę. Bez niej klient płaciłby za
    // wyższy plan, mając uprawnienia niższego.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({
        claimed: true,
        row: {
          user_id: "user-kupujacy",
          // Najemca subskrypcji zawęża odwzorowanie ceny na plan.
          tenant_id: "tenant-alfa",
          price_id: "plus_monthly",
          status: "active",
          current_period_end: "2026-09-01T00:00:00.000Z",
          // Subskrypcja dawno kupiona: zmiana planu, nie zakup do potwierdzenia.
          purchase_confirmed_at: "2026-07-01T00:00:00.000Z",
        },
      }),
    );
    db.setResponse(
      "access_plans",
      ok({ id: "plan-pro-m", tenant_id: "tenant-alfa", price_cents: 9900, currency: "PLN" }),
    );
    db.setResponse("user_subscriptions", (chain: RecordedChain) =>
      chain.has("maybeSingle") ? ok(null) : ok(null),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.updated",
      data: subscriptionEvent(),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writePayload("subscriptions", "update")).toMatchObject({ last_event_at: OCCURRED_AT });
    // Uprawnienie zakłada się na NOWYM planie.
    expect(writePayload("user_subscriptions", "insert")).toMatchObject({
      user_id: "user-kupujacy",
      plan_id: "plan-pro-m",
    });
    // Dzwonek o zmianie planu - klient ma zobaczyć, że dopłata coś dała.
    expect(writePayload("notifications", "insert")).toMatchObject({ user_id: "user-kupujacy" });
    // Plan szukany W NAJEMCY subskrypcji - katalog cen jest wspólny dla
    // wszystkich organizacji, plany nie (audyt wyd. 11/12).
    const planEqs = db
      .chainsFor("access_plans")
      .flatMap((chain) => chain.calls.filter((c) => c.method === "eq").map((c) => c.args));
    expect(planEqs).toContainEqual(["tenant_id", "tenant-alfa"]);
  });
});

describe("rezygnacja z subskrypcji", () => {
  it("rezygnacja subskrypcji nieznanej w bazie nie odbiera niczyich uprawnień", async () => {
    // `subscription.canceled` dla wiersza, którego u nas nie ma (inne
    // środowisko, subskrypcja sprzed migracji), nie ma komu odebrać dostępu.
    // Brak właściciela MUSI kończyć obsługę, zanim ruszy warstwa uprawnień.
    db.setResponse("subscriptions", subscriptionsResponder({ claimed: true, row: null }));

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.canceled",
      data: subscriptionEvent({ status: "canceled", currentBillingPeriod: null }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("user_subscriptions")).toHaveLength(0);
    expect(writesOn("crm_leads")).toHaveLength(0);
    expect(writesOn("notifications")).toHaveLength(0);
  });

  it("nieudany zapis rezygnacji przerywa obsługę", async () => {
    // Cicha porażka tutaj zostawiłaby subskrypcję jako aktywną po rezygnacji -
    // czyli obietnicę dostępu, za który nikt już nie płaci.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({ claimed: true, row: null, writeError: "permission denied" }),
    );

    await expect(
      dispatchWebhookEvent({
        eventType: "subscription.canceled",
        data: subscriptionEvent({ status: "canceled" }),
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow("subscriptions cancel failed: permission denied");
  });
});

describe("zakładanie subskrypcji - odmowy", () => {
  it("brak `customData.userId` nie zakłada subskrypcji-sieroty", async () => {
    // Bez właściciela wiersz `subscriptions` byłby nie do powiązania z kontem:
    // klient płaci, panel pokazuje subskrypcję bez użytkownika, a uprawnienia
    // nie ma. Lepiej nie zapisać nic i zostawić ślad w logu.
    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.created",
      data: subscriptionEvent({ customData: {} }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chains).toHaveLength(0);
  });

  it("brak identyfikatorów cennika (lookup_key / metadata) nie zapisuje niczego", async () => {
    // `price.externalId` i `product.externalId` to JEDYNE powiązanie ceny
    // operatora z planem w aplikacji. Zapis bez nich dałby subskrypcję, której
    // nie da się przełożyć na warstwę dostępu ani na zmianę planu.
    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.created",
      data: subscriptionEvent({
        items: [{ quantity: 1, price: { id: "pri_atrapa", externalId: null }, product: null }],
      }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chains).toHaveLength(0);
  });

  it("zdarzenie bez okresu rozliczeniowego zapisuje puste daty, a nie zgadywane", async () => {
    // `subscription.created` bez okresu (import subskrypcji, plan bez cyklu)
    // nie może wymyślić daty końca dostępu. Zgadnięta data to albo dostęp
    // gratis, albo odcięcie płacącego klienta - obie pomyłki kosztują.
    db.setResponse("subscriptions", subscriptionsResponder({ claimed: false, row: null }));

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.created",
      data: subscriptionEvent({ currentBillingPeriod: null }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writePayload("subscriptions", "upsert")).toMatchObject({
      current_period_start: null,
      current_period_end: null,
      trial_ends_at: null,
    });
  });

  it("nieudany zapis ISTNIEJĄCEJ subskrypcji przy ponowionym `created` też przerywa obsługę", async () => {
    // Ponowione `created` (wiersz już jest, zdarzenie świeże albo `replay`)
    // aktualizuje stan zamiast wstawiać - i ten zapis też nie ma prawa zginąć.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({ claimed: true, writeError: "statement timeout" }),
    );

    await expect(
      dispatchWebhookEvent({
        eventId: "evt_utworzenie",
        eventType: "subscription.created",
        data: subscriptionEvent(),
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow("subscriptions update failed: statement timeout");
  });

  it("nieudany zapis subskrypcji jest błędem, nie cichym „przetworzono”", async () => {
    // Gdyby ten błąd był połykany, dziennik pokazałby `processed` przy
    // subskrypcji, której w bazie nie ma - czyli najgorszy możliwy stan:
    // pieniądze pobrane, ślad zgubiony, operator nie ponowi.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({ claimed: false, row: null, writeError: "permission denied" }),
    );

    await expect(
      dispatchWebhookEvent({
        eventType: "subscription.created",
        data: subscriptionEvent(),
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow("subscriptions upsert failed: permission denied");
  });
});

describe("subskrypcja darowizny - poza ścieżką uprawnień", () => {
  it("darowizna cykliczna idzie do rejestru wpłat, nie do `subscriptions`", async () => {
    // Darowizna nie jest planem dostępu: nie ma odpowiednika w cenniku i nie
    // nadaje żadnej warstwy. Wpuszczenie jej w zwykłą ścieżkę subskrypcji
    // dałoby wpłacającemu uprawnienia płatnego planu.
    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.updated",
      data: subscriptionEvent({
        status: "active",
        customData: { purpose: "donation", donationId: "don-1" },
      }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chainsFor("subscriptions")).toHaveLength(0);
    expect(writePayload("donations", "update")).toMatchObject({
      provider_subscription_id: "sub_atrapa_1",
      recurring: true,
    });
  });

  it("rezygnacja z darowizny cyklicznej zamyka ją statusem `canceled`", async () => {
    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.canceled",
      data: subscriptionEvent({
        status: "active",
        customData: { purpose: "donation", donationId: "don-1" },
      }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    // Status bierzemy z TYPU zdarzenia, nie z pola `status` ładunku - operator
    // zostawia w nim czasem ostatni znany stan subskrypcji.
    expect(writePayload("donations", "update")).toMatchObject({ status: "canceled" });
  });

  it("darowizna bez identyfikatora wpłaty i bez statusu nie zapisuje nic na ślepo", async () => {
    // Bez `donationId` nie wiadomo, KTÓRĄ wpłatę oznaczyć, a stan inny niż
    // końcowy nie daje podstawy do masowej aktualizacji po samym
    // identyfikatorze subskrypcji. Wybór jest świadomy: lepiej nie ruszyć
    // rejestru wpłat, niż podpiąć cudzą darowiznę pod tę subskrypcję.
    // Ładunek podany LITERAŁEM (a nie fabryką), bo modeluje zdarzenie operatora
    // BEZ pola `status` - typ `SubscriptionData` wymaga tego pola, a obsługa i
    // tak ma na nie zapasowe „active". Wejście `dispatchWebhookEvent` przyjmuje
    // `unknown`, więc żadne rzutowanie nie jest tu potrzebne.
    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.updated",
      data: { id: "sub_atrapa_1", customerId: "cus_atrapa_1", customData: { purpose: "donation" } },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("donations")).toHaveLength(0);
  });
});

describe("windykacja - nieudane i odzyskane obciążenie", () => {
  it("nieudane obciążenie nieznanej subskrypcji nic nie zapisuje", async () => {
    // Zdarzenie o subskrypcji, której u nas nie ma (inne środowisko, konto
    // sprzed migracji), nie może wygenerować windykacji „w powietrze":
    // licznika nie ma czego podbić, a mail poszedłby do nikogo.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.payment_failed",
      data: transactionEvent(),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("subscriptions")).toHaveLength(0);
    expect(writesOn("notifications")).toHaveLength(0);
  });

  it("DRUGIE zdarzenie o tej samej nieudanej transakcji nie podbija licznika", async () => {
    // Operator opisuje jedno odrzucone obciążenie DWOMA zdarzeniami
    // (`payment_failed` i `past_due`). Bez deduplikacji po identyfikatorze
    // transakcji klient dostałby dwa maile i licznik prób skoczyłby o dwa,
    // czyli windykacja skróciłaby się o cały krok.
    db.setResponse(
      "subscriptions",
      ok({
        user_id: "user-kupujacy",
        tenant_id: "tenant-alfa",
        price_id: "pro_monthly",
        current_period_end: "2026-09-01T00:00:00.000Z",
        payment_failure_count: 1,
        last_dunning_transaction_id: "txn_atrapa_1",
      }),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.past_due",
      data: transactionEvent(),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("subscriptions")).toHaveLength(0);
    expect(writesOn("notifications")).toHaveLength(0);
  });

  it("odzyskana płatność nieznanej subskrypcji też nic nie zapisuje", async () => {
    // Ta sama odmowa po stronie sukcesu: `transaction.completed` bez wiersza
    // subskrypcji nie ma czego wyzerować. Przy okazji ładunek jest tu
    // NIEPEŁNY (kwota nieliczbowa, brak waluty) - windykacja ma to przeżyć,
    // bo pola kwotowe służą jej wyłącznie do treści maila.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.completed",
      data: transactionEvent({
        currencyCode: null,
        details: { totals: { grandTotal: "nie-liczba" } },
      }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("subscriptions")).toHaveLength(0);
  });

  it("odnowienie darowizny cyklicznej księguje wpłatę, a nie windykację", async () => {
    // Darowizna cykliczna nie ma planu, uprawnień ani windykacji - każda
    // opłacona faktura to osobna WPŁATA. Wpuszczenie jej w ścieżkę windykacji
    // podbijałoby licznik nieudanych płatności nieistniejącej subskrypcji.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.completed",
      data: transactionEvent({
        // Minimalny ładunek: bez identyfikatora wpłaty, waluty i danych
        // darczyńcy - rejestr ma sobie z tym poradzić.
        currencyCode: null,
        customer: null,
        customData: { purpose: "donation" },
      }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("subscriptions")).toHaveLength(0);
    expect(db.chainsFor("donations").length).toBeGreaterThan(0);
  });

  it("nieudana rata darowizny NIE uruchamia windykacji planu", async () => {
    // Nieudana rata darowizny nie ma czego windykować: nie ma dostępu do
    // odebrania ani planu do przypomnienia. Mail „Twoja subskrypcja wygasa"
    // wysłany darczyńcy byłby zwykłą pomyłką wizerunkową.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.payment_failed",
      data: transactionEvent({ customData: { purpose: "donation", donationId: "don-1" } }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chains).toHaveLength(0);
  });
});

describe("płatność jednorazowa - odmowy realizacji", () => {
  it("odrzucona płatność jednorazowa oznacza zgłoszenie jako NIEOPŁACONE", async () => {
    // Zgłoszenie na wydarzenie zostaje (uczestnik może dopłacić), ale musi być
    // widoczne jako nieopłacone - inaczej organizator wpuściłby na salę osobę,
    // której karta nie przeszła.
    rpc.setData("payments_apply_event_ticket_outcome", { ok: true });

    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.payment_failed",
      data: transactionEvent({ subscriptionId: null, customData: { orderId: "order-1" } }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(rpc.lastCall("payments_apply_event_ticket_outcome")?.args).toMatchObject({
      p_order_id: "order-1",
      p_outcome: "unpaid",
    });
  });

  it("odrzucona płatność bez identyfikatora zamówienia nie rusza żadnego zgłoszenia", async () => {
    // Bez `orderId` nie wiadomo, KTÓRE zgłoszenie miałoby zostać oznaczone -
    // zgadywanie po e-mailu albo kwocie skasowałoby cudzy bilet. Brak całego
    // `custom_data` (transakcja spoza naszego checkoutu) ma dać ten sam skutek
    // co brak samego identyfikatora: nic.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.payment_failed",
      data: transactionEvent({ subscriptionId: null, customData: null }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(rpc.calls).toHaveLength(0);
    expect(db.chains).toHaveLength(0);
  });

  it("zdarzenie SANDBOXA nie realizuje zamówienia ze środowiska produkcyjnego", async () => {
    // Izolacja środowisk (P0): bez niej płatność kartą testową odblokowałaby
    // prawdziwy bilet albo treść premium. Zamówienie zostaje nietknięte.
    db.setResponse("payment_orders", (chain) =>
      chain.has("maybeSingle")
        ? ok({
            id: "order-1",
            user_id: "user-kupujacy",
            tenant_id: "tenant-alfa",
            plan_id: null,
            kind: "event_ticket",
            entity_type: "event",
            entity_id: "event-1",
            amount_cents: 4900,
            currency: "PLN",
            metadata: {},
            environment: "live",
          })
        : ok(null),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.completed",
      data: transactionEvent({
        subscriptionId: null,
        customData: { orderId: "order-1", purpose: "ticket" },
      }),
      environment: "sandbox",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("payment_orders")).toHaveLength(0);
    expect(writesOn("event_rsvps")).toHaveLength(0);
    expect(rpc.calls).toHaveLength(0);
  });

  it("opłacona transakcja bez rozpoznanego `custom_data` nie zakłada niczego", async () => {
    // Płatność spoza naszego checkoutu (ktoś opłacił link wystawiony ręcznie
    // w panelu operatora) nie ma jak zostać przypisana - i nie wolno jej
    // przypisać na oko. Ładunek jest tu GOŁY (bez kwoty, waluty, klienta
    // i danych własnych), bo dokładnie tak wygląda transakcja spoza naszego
    // przepływu - a odczyt każdego z tych pól musi mieć wartość zapasową.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.completed",
      data: { id: "txn_obcy_1" },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("payment_orders")).toHaveLength(0);
    expect(writesOn("membership_grants")).toHaveLength(0);
  });
});

describe("korekty rozliczeniowe (zwroty i spory)", () => {
  it("kredyt (`credit`) nie odbiera dostępu", async () => {
    // Nota kredytowa to korekta księgowa, nie zwrot pieniędzy za dostęp.
    // Odebranie po niej uprawnień skasowałoby dostęp klientowi, który nic nie
    // dostał z powrotem.
    const outcome = await dispatchWebhookEvent({
      eventType: "adjustment.created",
      data: {
        id: "adj_1",
        action: "credit",
        status: "approved",
        transactionId: "txn_atrapa_1",
        totals: { total: "4900", currencyCode: "PLN" },
      },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chains).toHaveLength(0);
  });

  it("korekta bez transakcji i bez subskrypcji nie odbiera niczego na ślepo", async () => {
    const outcome = await dispatchWebhookEvent({
      eventType: "adjustment.updated",
      data: { id: "adj_2", action: "refund", status: "approved" },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chains).toHaveLength(0);
  });

  it("zwrot CZĘŚCIOWY zapisuje kwotę, ale nie oznacza zamówienia jako zwrócone", async () => {
    // Kwoty korekty czytamy z luźnego ładunku operatora (`totals.total` to
    // NARASTAJĄCA suma zwrotów, `totals.captured` - kwota pierwotna). Pomyłka
    // w tym odczycie zamienia korektę ceny w pełny zwrot, czyli odbiera
    // dostęp komuś, kto dostał z powrotem 30 z 300 złotych.
    db.setResponse("payment_orders", (chain) =>
      chain.has("update")
        ? ok(null)
        : ok([
            {
              id: "order-1",
              user_id: "user-kupujacy",
              tenant_id: "tenant-alfa",
              plan_id: null,
              kind: "content",
              entity_type: null,
              entity_id: null,
              metadata: {},
              amount_cents: 30000,
              refunded_amount_cents: 0,
            },
          ]),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "adjustment.created",
      data: {
        id: "adj_3",
        action: "refund",
        status: "approved",
        transactionId: "txn_atrapa_1",
        totals: { total: "3000", captured: "30000", currencyCode: "PLN" },
      },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    const patch = writePayload("payment_orders", "update");
    expect(patch).toMatchObject({ refunded_amount_cents: 3000 });
    expect(patch).not.toHaveProperty("status");
  });

  it("korekta bez identyfikatora i bez nazwanej akcji nie odbiera dostępu", async () => {
    // Ładunek korekty jest LUŹNY - SDK operatora nie daje dla niego stabilnego
    // typu, więc każde pole może nie dojechać. Nierozpoznana akcja ma spaść do
    // `other`, czyli do gałęzi, która NICZEGO nie odbiera: zgadywanie „to
    // pewnie zwrot" kasowałoby dostęp na podstawie nieznanego zdarzenia.
    const outcome = await dispatchWebhookEvent({
      eventType: "adjustment.created",
      data: { transactionId: "txn_atrapa_1", totals: { total: "4900" } },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chains).toHaveLength(0);
  });

  it("identyfikator transakcji spoza kształtu operatora jest ODRZUCANY", async () => {
    // Identyfikator wchodzi do filtra `or(...)` jako tekst. Przecinek albo
    // nawias w nim rozszerzyłby zapytanie na cudze zamówienia - dlatego
    // dopuszczamy wyłącznie znaki identyfikatora operatora.
    const outcome = await dispatchWebhookEvent({
      eventType: "adjustment.created",
      data: {
        id: "adj_4",
        action: "refund",
        status: "approved",
        transactionId: "txn_1,id.eq.order-cudzy",
        totals: { total: "4900" },
      },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chains).toHaveLength(0);
  });
});

describe("dane klienta z portalu operatora", () => {
  it("zmiana danych nieznanego klienta nie tworzy profilu rozliczeniowego", async () => {
    // Profil bez zgody użytkownika nie ma prawa powstać z webhooka - a klient
    // operatora, którego nie ma w `subscriptions`, to najczęściej inne
    // środowisko albo konto sprzed migracji.
    const outcome = await dispatchWebhookEvent({
      eventType: "customer.updated",
      data: { id: "cus_obcy", email: "ktos@example.org", name: "Firma Testowa" },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("billing_profiles")).toHaveLength(0);
    // Powiązanie klienta z użytkownikiem jest zawężone do ŚRODOWISKA - bez
    // tego filtra sandboxowy klient podmieniłby adres na koncie produkcyjnym.
    expect(db.lastChain("subscriptions")?.argsOf("eq")).toEqual([
      "provider_customer_id",
      "cus_obcy",
    ]);
    expect(
      db
        .lastChain("subscriptions")
        ?.calls.filter((c) => c.method === "eq")
        .at(1)?.args,
    ).toEqual(["environment", "live"]);
  });

  it("zmiana adresu rozliczeniowego trafia do profilu z kodem kraju wersalikami", async () => {
    // Kraj rozstrzyga o stawce podatku na fakturze - „pl" i „PL" to dla
    // porównań w bazie dwie różne wartości.
    // Powiązanie klienta z kontem niesie TAKŻE najemcę: profil rozliczeniowy
    // jest jeden na parę (użytkownik, najemca), więc zapis z webhooka bez
    // `tenant_id` nie miałby jak trafić tylko w ten właściwy.
    db.setResponse("subscriptions", ok({ user_id: "user-kupujacy", tenant_id: "tenant-alfa" }));
    db.setResponse("billing_profiles", ok([{ id: "bp-1" }]));

    await dispatchWebhookEvent({
      eventType: "address.updated",
      data: {
        customerId: "cus_atrapa_1",
        firstLine: "ul. Testowa 1",
        city: "Warszawa",
        postalCode: "00-001",
        countryCode: "pl",
      },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(writePayload("billing_profiles", "update")).toMatchObject({
      address_line1: "ul. Testowa 1",
      city: "Warszawa",
      postal_code: "00-001",
      country_code: "PL",
    });
  });

  it("dane firmy przestawiają profil na fakturę B2B", async () => {
    db.setResponse("subscriptions", ok({ user_id: "user-kupujacy", tenant_id: "tenant-alfa" }));
    db.setResponse("billing_profiles", ok([{ id: "bp-1" }]));

    await dispatchWebhookEvent({
      eventType: "business.updated",
      data: { customerId: "cus_atrapa_1", name: "Firma Testowa", taxIdentifier: "PL0000000000" },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(writePayload("billing_profiles", "update")).toMatchObject({
      company: "Firma Testowa",
      is_company: true,
      tax_id: "PL0000000000",
    });
  });

  it("puste pola w ładunku nie kasują zapisanych danych profilu", async () => {
    // Operator wysyła `customer.updated` także przy zmianie pola, którego nie
    // trzymamy. Nadpisanie profilu pustką skasowałoby adres do faktury.
    db.setResponse("subscriptions", ok({ user_id: "user-kupujacy", tenant_id: "tenant-alfa" }));

    await dispatchWebhookEvent({
      eventType: "customer.updated",
      data: { id: "cus_atrapa_1", email: "   ", name: null },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(writesOn("billing_profiles")).toHaveLength(0);
  });
});

describe("dokument rozliczeniowy (`transaction.updated`)", () => {
  it("zdarzenie bez identyfikatora transakcji jest POMIJANE", async () => {
    // `transaction.updated` przychodzi też przy zmianach, które nie dotyczą
    // faktury. Bez identyfikatora nie ma czego zapisać, a `skipped` w
    // dzienniku mówi wprost: zdarzenie odebrane, dokumentu nie było.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.updated",
      data: { subscriptionId: "sub_atrapa_1" },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    expect(writesOn("billing_documents")).toHaveLength(0);
  });

  it("transakcja BEZ WŁAŚCICIELA w naszej bazie nie zakłada dokumentu", async () => {
    // Płatność gościa (albo transakcja z cudzego środowiska) nie ma najemcy
    // ani użytkownika, do którego dokument miałby trafić. Wstawienie go „na
    // sztywno" pokazałoby cudzą fakturę w panelu przypadkowego konta.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.updated",
      data: {
        id: "txn_atrapa_1",
        subscriptionId: "sub_atrapa_1",
        invoiceNumber: "FV/2026/08/0001",
        currencyCode: "PLN",
        status: "completed",
        details: { totals: { grandTotal: "4900" } },
      },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    expect(writesOn("billing_documents")).toHaveLength(0);
  });

  it("numer faktury nadany osobnym zdarzeniem uzupełnia istniejący dokument", async () => {
    // Operator nadaje numer PO `transaction.completed`. Bez tej gałęzi
    // dokument zostawałby w panelu klienta bez numeru, czyli bezużyteczny
    // księgowo.
    db.setResponse("subscriptions", ok({ user_id: "user-kupujacy", tenant_id: "tenant-alfa" }));
    db.setResponse("billing_documents", (chain: RecordedChain) =>
      chain.has("maybeSingle")
        ? ok({ id: "doc-1", number: null, amount_cents: 4900, status: "paid" })
        : ok(null),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.updated",
      data: {
        id: "txn_atrapa_1",
        subscriptionId: "sub_atrapa_1",
        invoiceNumber: "FV/2026/08/0001",
        currencyCode: "PLN",
        status: "completed",
        details: { totals: { grandTotal: "4900" } },
      },
      environment: "live",
      occurredAt: LATER,
    });

    expect(outcome).toBe("processed");
    expect(writePayload("billing_documents", "update")).toMatchObject({
      number: "FV/2026/08/0001",
    });
  });

  it("NIEUDANY zapis rejestru to błąd zdarzenia - Stripe je ponowi", async () => {
    // Zdarzenie zamknięte jako przetworzone mimo braku dokumentu nigdy by nie
    // wróciło: operator ponawia tylko po odpowiedzi innej niż 2xx. Błąd bazy
    // inny niż wyścig (23505) musi więc wyjść z dyspozytora jako wyjątek.
    db.setResponse("subscriptions", ok({ user_id: "user-kupujacy", tenant_id: "tenant-alfa" }));
    db.setResponse("billing_documents", (chain: RecordedChain) =>
      chain.has("maybeSingle") ? ok(null) : fail("check constraint violated", "23514"),
    );

    await expect(
      dispatchWebhookEvent({
        eventType: "transaction.updated",
        data: {
          id: "txn_atrapa_2",
          subscriptionId: "sub_atrapa_1",
          invoiceNumber: "FV/2026/08/0002",
          currencyCode: "PLN",
          status: "completed",
          details: { totals: { grandTotal: "4900" } },
        },
        environment: "live",
        occurredAt: LATER,
      }),
    ).rejects.toThrow("billing document not recorded: txn_atrapa_2");
  });

  it("POWTÓRZONE zdarzenie o niezmienionym dokumencie nie zapisuje nic drugi raz", async () => {
    // Idempotencja po stronie dokumentów: ten sam numer, kwota i status to
    // zdarzenie bez treści. Zapis „na wszelki wypadek" podbijałby `updated_at`
    // i mieszał w audycie księgowym.
    db.setResponse("subscriptions", ok({ user_id: "user-kupujacy", tenant_id: "tenant-alfa" }));
    db.setResponse("billing_documents", (chain: RecordedChain) =>
      chain.has("maybeSingle")
        ? ok({ id: "doc-1", number: "FV/2026/08/0001", amount_cents: 4900, status: "paid" })
        : ok(null),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.updated",
      data: {
        id: "txn_atrapa_1",
        subscriptionId: "sub_atrapa_1",
        invoiceNumber: "FV/2026/08/0001",
        currencyCode: "PLN",
        status: "completed",
        details: { totals: { grandTotal: "4900" } },
      },
      environment: "live",
      occurredAt: LATER,
    });

    expect(outcome).toBe("skipped");
    expect(writesOn("billing_documents")).toHaveLength(0);
  });
});

describe("zdarzenie piaskownicy na wdrożeniu produkcyjnym (PAY-05)", () => {
  // Karta testowa nie może nadać prawdziwego dostępu. `metadata.userId`
  // subskrypcji z piaskownicy potrafi wskazać realne konto, a
  // `user_subscriptions` nie zna środowisk - dawniej sandboxowy webhook na
  // produkcji dawał więc pełne uprawnienie płatnego planu. Zostaje wyłącznie
  // ślad księgowy w `subscriptions` (sonda nocna go czyta), reszta to `skipped`.
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.setResponse("access_plans", ok(PLAN_PRO));
    db.setResponse("profiles", ok({ email: "kupujacy@example.com", tenant_id: "tenant-alfa" }));
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("zmiana stanu subskrypcji z piaskownicy: ślad księgowy, bez uprawnienia, CRM i dzwonka", async () => {
    const subscriptions = subscriptionsTable([
      storedSubscription({ environment: "sandbox", status: "paused" }),
    ]);

    const outcome = await dispatchWebhookEvent({
      eventId: "evt_sandbox_wznowienie",
      eventType: "subscription.resumed",
      data: subscriptionEvent({ status: "active" }),
      environment: "sandbox",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(subscriptions.rows[0]).toMatchObject({
      status: "active",
      last_event_at: OCCURRED_AT,
      last_event_id: "evt_sandbox_wznowienie",
    });
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(db.chainsFor("crm_leads")).toHaveLength(0);
    expect(db.chainsFor("notifications")).toHaveLength(0);
    expect(db.chainsFor("member_organizations")).toHaveLength(0);
    // Jeden wpis w logu na zdarzenie - widać, DLACZEGO nic nie nadano.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[payments] sandbox event on production deployment", {
      eventId: "evt_sandbox_wznowienie",
      eventType: "subscription.resumed",
      environment: "sandbox",
      handling: "bookkeeping_only",
    });
  });

  it("nowa subskrypcja z piaskownicy zakłada wiersz księgowy, ale nie nadaje dostępu", async () => {
    const subscriptions = subscriptionsTable();

    const outcome = await dispatchWebhookEvent({
      eventId: "evt_sandbox_utworzenie",
      eventType: "subscription.created",
      data: subscriptionEvent(),
      environment: "sandbox",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(subscriptions.rows).toEqual([
      expect.objectContaining({ environment: "sandbox", last_event_id: "evt_sandbox_utworzenie" }),
    ]);
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(db.chainsFor("notifications")).toHaveLength(0);
    expect(rpc.calls).toHaveLength(0);
  });

  it("rezygnacja z piaskownicy zapisuje stan, ale nie rusza uprawnień ani maili", async () => {
    const subscriptions = subscriptionsTable([storedSubscription({ environment: "sandbox" })]);

    const outcome = await dispatchWebhookEvent({
      eventId: "evt_sandbox_rezygnacja",
      eventType: "subscription.canceled",
      data: subscriptionEvent({ status: "canceled" }),
      environment: "sandbox",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(subscriptions.rows[0]).toMatchObject({ status: "canceled" });
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(db.chainsFor("crm_leads")).toHaveLength(0);
  });

  it.each([
    [
      "transaction.completed",
      transactionEvent({ subscriptionId: null, customData: { orderId: "o-1" } }),
    ],
    ["transaction.payment_failed", transactionEvent()],
    ["transaction.past_due", transactionEvent()],
    ["transaction.expired", transactionEvent({ subscriptionId: null })],
    ["transaction.updated", { id: "in_1", subscriptionId: "sub_atrapa_1", status: "completed" }],
    ["adjustment.created", { id: "re_1", action: "refund", transactionId: "pi_1" }],
    ["customer.updated", { id: "cus_atrapa_1", email: "ktos@example.com" }],
    ["address.updated", { customerId: "cus_atrapa_1", countryCode: "pl" }],
    ["business.updated", { customerId: "cus_atrapa_1", name: "Firma" }],
  ])("`%s` z piaskownicy jest POMIJANE, zanim dotknie bazy", async (eventType, data) => {
    const outcome = await dispatchWebhookEvent({
      eventId: "evt_sandbox",
      eventType,
      data,
      environment: "sandbox",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    expect(db.chains).toHaveLength(0);
    expect(rpc.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      "[payments] sandbox event on production deployment",
      expect.objectContaining({ eventType, handling: "skipped" }),
    );
  });

  it("darowizna cykliczna z piaskownicy nie trafia do rejestru wpłat", async () => {
    const outcome = await dispatchWebhookEvent({
      eventId: "evt_sandbox_darowizna",
      eventType: "subscription.updated",
      data: subscriptionEvent({ customData: { purpose: "donation", donationId: "don-1" } }),
      environment: "sandbox",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    expect(db.chains).toHaveLength(0);
  });

  it("zdarzenie `live` na produkcji przechodzi pełną ścieżką - uprawnienie się zapisuje", async () => {
    subscriptionsTable([storedSubscription({ status: "paused" })]);
    const entitlements = rowStore({ unique: ["external_ref"] });
    db.setResponse("user_subscriptions", (chain) => entitlements.respond(chain));

    const outcome = await dispatchWebhookEvent({
      eventId: "evt_live_wznowienie",
      eventType: "subscription.resumed",
      data: subscriptionEvent({ status: "active" }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(entitlements.rows).toEqual([
      expect.objectContaining({ external_ref: "sub_atrapa_1", status: "active" }),
    ]);
    expect(warn).not.toHaveBeenCalledWith(
      "[payments] sandbox event on production deployment",
      expect.anything(),
    );
  });
});
