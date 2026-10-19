// DRUGI SILNIK KASY. `stripeCheckout.functions.ts` zakłada sesję Embedded
// Checkout niezależnie od `checkout.functions.ts`: dla planu z katalogu
// (`createPlanCheckoutSession`) i dla kwoty ad-hoc (`createAdhocCheckoutSession`).
// Do 31.08.2026 miał ZERO pokrycia - żadna gałąź odmowy nie była dowiedziona.
//
// DLACZEGO TO JEST RYZYKO, A NIE LUKA STATYSTYCZNA. Dwa silniki checkoutu
// oznaczają dwa miejsca, w których można się pomylić co do tych samych reguł:
// nieaktywny plan, kupon wyczerpany albo cudzego najemcy, przegrany wyścig
// o ostatnie użycie kuponu, odmowa operatora i sprzątanie po niej. Reguła
// „limit użyć nie rozjeżdża się między silnikami" jest w komentarzu tego pliku
// produkcyjnego - a komentarz nie jest bramką.
//
// CO ATRAPUJEMY: klienta operatora, klienta Supabase, rolę serwisową i żądanie
// frameworka. `adhocCheckout.server`, `adhocCheckoutOrder.server`,
// `checkoutSettings.server`, `markOrderSession.server` i `checkoutLocale` jadą
// PRAWDZIWE - to one wspólnie stanowią kontrakt tej warstwy.
//
// UWAGA: ten plik zawierał DWA zarejestrowane defekty (`it.fails`) dotyczące
// audytu kuponu. Oba są naprawione 31.08.2026 - opis „co było złe i jak
// zostało naprawione" stoi przy testach, które je pilnują.
//
// AUDYT PAY-01 (12.10.2026): cena, ilość, kwota i tryb nie pochodzą już
// z żądania - wylicza je `planPricing.ts` z wiersza planu, a sesja odmawia,
// gdy cena u operatora nie pasuje do zamówienia (`price_mismatch`). Bloki
// „cena wiązana z planem" niżej są kryterium tej poprawki.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DZIEN } from "@/test/time";

import type { Database, Tables } from "@/integrations/supabase/types";
import {
  fail,
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";

const PLAN_ID = "aaaaaaaa-2222-4000-8000-000000000001";
const EVENT_ID = "bbbbbbbb-2222-4000-8000-000000000002";
const POST_ID = "cccccccc-2222-4000-8000-000000000003";
const COUPON_ID = "dddddddd-2222-4000-8000-00000000000d";
const RETURN_URL = "https://kasa.example.org/checkout/sukces";

const h = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  /**
   * Cena katalogowa w kształcie operatora: `plus_monthly` - 49 zł za sztukę,
   * co miesiąc, rozliczana za ilość. Bramka spójności (PAY-01) porównuje typ,
   * walutę, cykl i kwotę z wyceną planu, więc atrapa niesie wszystkie cztery.
   */
  const catalogPrice = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: "price_1",
    lookup_key: "plus_monthly",
    type: "recurring",
    currency: "pln",
    billing_scheme: "per_unit",
    unit_amount: 4900,
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    ...over,
  });
  const state = {
    prices: [catalogPrice()] as unknown[],
    /** Subskrypcje klienta u operatora (`subscriptions.list`). */
    remoteSubscriptions: [] as unknown[],
    /** Otwarte sesje Checkout klienta (`checkout.sessions.list`, status `open`). */
    openSessions: [] as { id: string }[],
    sessionError: null as Error | null,
    couponError: null as Error | null,
    coupon: { id: "coupon_1" } as Record<string, unknown>,
  };
  const record = (method: string, result: () => unknown) => {
    return (...args: unknown[]) => {
      calls.push({ method, args });
      try {
        return Promise.resolve(result());
      } catch (e) {
        return Promise.reject(e);
      }
    };
  };
  return { calls, state, record, catalogPrice };
});

// Decision Lab jest od v6.2 wyłącznie na zapytanie - `planPurchaseRefusal`
// odmawia go w obu silnikach, zanim kasa dojdzie do wyceny. Mechanika kasy
// JEDNORAZOWEJ zostaje jednak gotowa na produkt samoobsługowy, a jedyną
// pozycją jednorazową katalogu jest dziś Decision Lab. Testy tej mechaniki
// zdejmują więc zamek „na zapytanie" JAWNIE (`enquiry.locked = false`);
// sam zamek dowodzą osobne przypadki i `catalogV62.test.ts`.
const enquiry = vi.hoisted(() => ({ locked: true }));
vi.mock("@/lib/billing/enquiryPlans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/enquiryPlans")>();
  return {
    ...actual,
    isEnquiryOnlyPlan: (plan: Parameters<typeof actual.isEnquiryOnlyPlan>[0]) =>
      enquiry.locked && actual.isEnquiryOnlyPlan(plan),
  };
});

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("https://kasa.example.org/checkout", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "kasa.example.org" },
    }),
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

// Kod rabatowy i rezerwacja jego użycia idą rolą serwisową z jawnym najemcą
// i kontem (`couponRpc.server.ts`, migracja 20261007120200). Atrapa kieruje
// wywołania `*_for_user` do TEJ SAMEJ tabeli odpowiedzi co klient kupującego.
const couponAdmin = vi.hoisted(() => ({
  forward: null as null | ((fn: string, args: Record<string, unknown>) => Promise<unknown>),
}));

vi.mock("@/lib/server/tenant.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/tenant.server")>()),
  resolveTenantIdForHost: async () => "tenant-alfa",
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (fn: string, args: Record<string, unknown>) =>
      couponAdmin.forward !== null && fn.endsWith("_for_user")
        ? couponAdmin.forward(fn, args)
        : Promise.resolve({ data: true, error: null }),
  },
}));

vi.mock("@/lib/stripe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe.server")>();
  const { stripeStub } = await import("@/test/billing/fixtures");
  return {
    ...actual,
    getStripeClient: (env: string) => {
      h.calls.push({ method: "getStripeClient", args: [env] });
      const base = stripeStub();
      return {
        ...base,
        prices: { list: h.record("prices.list", () => ({ data: h.state.prices })) },
        customers: {
          search: h.record("customers.search", () => ({ data: [] })),
          list: h.record("customers.list", () => ({ data: [] })),
          update: h.record("customers.update", () => ({ id: "cus_1" })),
          create: h.record("customers.create", () => ({ id: "cus_1" })),
        },
        subscriptions: {
          ...base.subscriptions,
          list: h.record("subscriptions.list", () => ({ data: h.state.remoteSubscriptions })),
        },
        coupons: {
          create: h.record("coupons.create", () => {
            if (h.state.couponError) throw h.state.couponError;
            return h.state.coupon;
          }),
        },
        checkout: {
          sessions: {
            ...base.checkout.sessions,
            create: h.record("checkout.sessions.create", () => {
              if (h.state.sessionError) throw h.state.sessionError;
              return { id: "cs_test_1", client_secret: "cs_test_1_secret" };
            }),
            list: h.record("checkout.sessions.list", () => ({
              data: h.state.openSessions,
              has_more: false,
            })),
            // Wygaszona sesja znika z listy otwartych - jak u operatora.
            expire: (id: string) => {
              h.calls.push({ method: "checkout.sessions.expire", args: [id] });
              h.state.openSessions = h.state.openSessions.filter((s) => s.id !== id);
              return Promise.resolve({ id, status: "expired" });
            },
          },
        },
      };
    },
  };
});

const { callServerFn } = await import("@/test/serverFn");
const { asServerFn } = await import("@/test/serverFnHarness");
const { minimumChargeCents } = await import("@/lib/billing/chargeMinimum");
const { createPlanCheckoutSession, createAdhocCheckoutSession } =
  await import("@/lib/billing/stripeCheckout.functions");

// --- kształty ---------------------------------------------------------------

/**
 * Odpowiedź `validate_b2b_coupon` - te same pola, które baza składa w werdykt.
 *
 * Typ jest LOKALNY, bo od 20261001210000 walidator oddaje jeden obiekt jsonb
 * i wygenerowane typy mówią o nim tylko `Json`. Pola zostają te same co
 * w dawnym wierszu zbioru, więc te same atrapy grają w obu kształtach: jako
 * obiekt (po migracji) i jako `[wiersz]` (baza sprzed migracji).
 */
interface CouponVerdict {
  ok: boolean;
  coupon_id: string | null;
  discount_cents: number | null;
  discount_kind: string | null;
  discount_percent: number | null;
  error: string | null;
  final_cents: number | null;
  label: string | null;
}

/** Kolumny planu, które czyta TEN silnik (`select` w kodzie). */
type PlanQuote = Pick<
  Tables<"access_plans">,
  | "id"
  | "price_cents"
  | "currency"
  | "active"
  | "for_sale"
  | "trial_days"
  | "tier_key"
  | "interval"
  | "volume_threshold_seats"
  | "volume_price_cents"
>;

type OrderInsert = Database["public"]["Tables"]["payment_orders"]["Insert"];

type SessionResult =
  | { ok: true; clientSecret: string; orderId: string }
  | {
      ok: false;
      error: string;
    };

interface SessionParams {
  mode: string;
  locale: string;
  return_url: string;
  metadata: Record<string, string>;
  line_items: {
    quantity: number;
    price?: string;
    price_data?: { currency: string; unit_amount: number; product_data: { name: string } };
  }[];
  discounts?: { coupon?: string }[];
  allow_promotion_codes?: boolean;
  subscription_data?: { trial_period_days?: number; metadata?: Record<string, string> };
}

/** Plan „Członek" miesięczny - w katalogu `plus_monthly`, cena cykliczna. */
function planQuote(over: Partial<PlanQuote> = {}): PlanQuote {
  return {
    id: PLAN_ID,
    price_cents: 4900,
    currency: "PLN",
    active: true,
    for_sale: true,
    trial_days: 0,
    tier_key: "member",
    interval: "month",
    volume_threshold_seats: null,
    volume_price_cents: null,
    ...over,
  };
}

/**
 * Cena katalogowa u operatora - domyślnie zgodna z `planQuote()`. Ta sama
 * atrapa co `h.catalogPrice` (testy audytu SUB-05 używają tej nazwy).
 */
function stripePrice(over: Record<string, unknown> = {}): Record<string, unknown> {
  return h.catalogPrice(over);
}

function couponOk(over: Partial<CouponVerdict> = {}): CouponVerdict {
  return {
    ok: true,
    coupon_id: COUPON_ID,
    discount_cents: 1000,
    discount_kind: "amount",
    discount_percent: 0,
    error: "",
    final_cents: 3900,
    label: "Partner CEE",
    ...over,
  };
}

function couponRefused(reason: string): CouponVerdict {
  return {
    ok: false,
    coupon_id: "",
    discount_cents: 0,
    discount_kind: "",
    discount_percent: 0,
    error: reason,
    final_cents: 0,
    label: "",
  };
}

/**
 * Werdykt POZYTYWNY z dziurą: bez kuponu albo bez kwoty końcowej. Baza takiego
 * nie wystawia - to kształt zepsutej odpowiedzi, którą kasa ma odrzucić.
 */
function couponOkWithout(key: "coupon_id" | "final_cents"): Partial<CouponVerdict> {
  const verdict: Partial<CouponVerdict> = couponOk();
  delete verdict[key];
  return verdict;
}

// --- atrapa klienta ---------------------------------------------------------

let chain: SupabaseFromStub;
let rpcCalls: { fn: string; args: Record<string, unknown> }[];
let rpcResponses: Map<string, SupabaseResult>;

function client() {
  return {
    from: (table: string) => chain.from(table),
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fn, args });
      const planned = rpcResponses.get(fn);
      return Promise.resolve(planned ?? fail(`test: brak zaplanowanej odpowiedzi RPC "${fn}"`));
    },
  };
}

function context() {
  return { supabase: client(), userId: "user-kupujacy", claims: { email: "kupujacy@example.org" } };
}

/** Konto bez adresu w tokenie - paragon nie ma dokąd pójść, ale kasa ma działać. */
function contextWithoutEmail() {
  return { supabase: client(), userId: "user-kupujacy", claims: {} };
}

function insertedOrder(): OrderInsert | undefined {
  const row = chain.lastChain("payment_orders")?.argsOf("insert")?.[0];
  return row !== null && typeof row === "object" ? (row as OrderInsert) : undefined;
}

function orderMetadata(): Record<string, unknown> {
  const metadata = insertedOrder()?.metadata;
  return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function rpcArgs(fn: string): Record<string, unknown> | undefined {
  return rpcCalls.find((c) => c.fn === fn)?.args;
}

function stripeCall(method: string): { method: string; args: unknown[] } | undefined {
  return h.calls.find((c) => c.method === method);
}

function lastSession(): SessionParams | undefined {
  const params = h.calls.filter((c) => c.method === "checkout.sessions.create").at(-1)?.args?.[0];
  return params !== null && typeof params === "object" ? (params as SessionParams) : undefined;
}

function planCall(over: Record<string, unknown> = {}): Promise<SessionResult> {
  return callServerFn<SessionResult>(
    createPlanCheckoutSession,
    { planId: PLAN_ID, returnUrl: RETURN_URL, ...over },
    context(),
  );
}

/** Drugi argument wywołania operatora (`RequestOptions`, klucz idempotencji). */
function requestOptions(method: string): unknown {
  return h.calls.filter((c) => c.method === method).at(-1)?.args[1];
}

function adhocCall(over: Record<string, unknown> = {}): Promise<SessionResult> {
  return callServerFn<SessionResult>(
    createAdhocCheckoutSession,
    {
      purpose: "content_unlock",
      entityType: "post",
      entityId: POST_ID,
      returnUrl: RETURN_URL,
      ...over,
    },
    context(),
  );
}

beforeEach(() => {
  enquiry.locked = true;
  h.calls.length = 0;
  h.state.prices = [h.catalogPrice()];
  h.state.remoteSubscriptions = [];
  h.state.openSessions = [];
  h.state.sessionError = null;
  h.state.couponError = null;
  h.state.coupon = { id: "coupon_1" };

  chain = supabaseFromStub();
  rpcCalls = [];
  rpcResponses = new Map<string, SupabaseResult>();
  couponAdmin.forward = (fn, args) => client().rpc(fn, args);

  // Host wdrożenia testowego MUSI być zadeklarowany, odkąd `resolveReturnUrl`
  // przechodzi przez bramkę dozwolonych hostów (`lib/billing/returnUrl.server`).
  // Bez tej linii przypadki o adresie powrotu dowodziłyby tylko tego, że
  // `kasa.example.org` NIE jest naszą domeną - a mają dowodzić, że klient nie
  // wybiera domeny powrotu.
  vi.stubEnv("BILLING_RETURN_HOSTS", "kasa.example.org");
  vi.stubEnv("LOVABLE_API_KEY", "klucz-testowy-bramki");
  vi.stubEnv("STRIPE_SANDBOX_API_KEY", "klucz-testowy-piaskownicy");

  chain.setResponse("access_plans", ok(planQuote()));
  // Kupujący bez historii subskrypcji (lustro `subscriptions` pod RLS).
  chain.setResponse("subscriptions", ok([]));
  chain.setResponse("payment_orders", ok({ id: "order-1", tenant_id: "tenant-alfa" }));
  chain.setResponse(
    "checkout_settings",
    ok({
      allow_promotion_codes: true,
      automatic_tax: false,
      tax_id_collection: true,
      billing_address_collection: "auto",
      invoice_creation: true,
    }),
  );
  chain.setResponse(
    "content_access_public",
    ok({ mode: "paid", one_time_price_cents: 1500, one_time_currency: "PLN" }),
  );
  chain.setResponse("posts", ok({ title_pl: "Analiza CEE", title_en: "CEE analysis" }));
  chain.setResponse("events", ok(null));
  rpcResponses.set("validate_b2b_coupon_for_user", ok([couponOk()]));
  rpcResponses.set("redeem_b2b_coupon_for_user", ok(true));
  rpcResponses.set("release_b2b_coupon_for_user", ok(true));
  rpcResponses.set("payment_order_mark_session", ok(true));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createPlanCheckoutSession - odmowy na planie", () => {
  it("BŁĄD odczytu planu jest zgłaszany, a nie zamieniany na `plan_not_found`", async () => {
    chain.setResponse("access_plans", fail("permission denied for table access_plans"));

    await expect(planCall()).rejects.toThrow("permission denied");
  });

  it("plan nieistniejący: sesja NIE powstaje i zamówienie też nie", async () => {
    chain.setResponse("access_plans", ok(null));

    const result = await planCall();

    expect(result).toEqual({ ok: false, error: "plan_not_found" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("plan NIEAKTYWNY nie jest do kupienia mimo istniejącego wiersza", async () => {
    chain.setResponse("access_plans", ok(planQuote({ active: false })));

    const result = await planCall();

    expect(result).toEqual({ ok: false, error: "plan_not_found" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("plan WYCOFANY ZE SPRZEDAŻY (v6.2) - odmowa bez sesji i bez zamówienia", async () => {
    chain.setResponse(
      "access_plans",
      ok(
        planQuote({ tier_key: "business", interval: "month", price_cents: 99000, for_sale: false }),
      ),
    );

    const result = await planCall();

    expect(result).toEqual({ ok: false, error: "plan_not_for_sale" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("Decision Lab (na zapytanie) - odmowa także przy for_sale=true", async () => {
    chain.setResponse(
      "access_plans",
      ok(
        planQuote({
          tier_key: "decision_lab",
          interval: "one_time",
          price_cents: 1_600_000,
          for_sale: true,
        }),
      ),
    );

    const result = await planCall();

    expect(result).toEqual({ ok: false, error: "plan_enquiry_only" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("plan INNEGO NAJEMCY jest niewidoczny pod RLS - handler odmawia", async () => {
    // Zapytanie idzie klientem użytkownika (RLS), więc cudzy plan wraca jako
    // brak wiersza. Sprawdzamy też zawężenie po identyfikatorze - bez niego
    // `maybeSingle()` oddałby pierwszy lepszy plan tenanta.
    chain.setResponse("access_plans", ok(null));

    await planCall();

    expect(chain.lastChain("access_plans")?.argsOf("eq")).toEqual(["id", PLAN_ID]);
  });

  it("BŁĄD zapisu zamówienia jest zgłaszany", async () => {
    chain.setResponse("payment_orders", fail("null value in column tenant_id"));

    await expect(planCall()).rejects.toThrow("null value in column");
  });
});

describe("createPlanCheckoutSession - kupon: ta sama ścieżka co w drugim silniku", () => {
  it("bez kodu kuponu nie ma walidacji, rezerwacji ani rabatu u operatora", async () => {
    await planCall();

    expect(rpcCalls.map((c) => c.fn)).not.toContain("validate_b2b_coupon_for_user");
    expect(rpcCalls.map((c) => c.fn)).not.toContain("redeem_b2b_coupon_for_user");
    expect(stripeCall("coupons.create")).toBeUndefined();
    expect(orderMetadata()).toEqual({ quantity: 1 });
  });

  it("kod jest normalizowany i walidowany W BAZIE kwotą i walutą planu", async () => {
    await planCall({ couponCode: "partner-cee" });

    // Rola serwisowa z jawnym najemcą, kontem i solonym skrótem adresu
    // (20261007120200) - surowy adres nie trafia do bazy.
    expect(rpcArgs("validate_b2b_coupon_for_user")).toEqual({
      _tenant_id: "tenant-alfa",
      _user_id: "user-kupujacy",
      _probe_subject: expect.stringMatching(/^ip:[0-9a-f]{32}$/),
      _code: "PARTNER-CEE",
      _plan_id: PLAN_ID,
      _amount_cents: 4900,
      _currency: "PLN",
    });
  });

  it.each([
    ["wyczerpany limit użyć", "max_redemptions_reached"],
    ["po terminie ważności", "expired"],
    ["nieaktywny", "inactive"],
    ["inna waluta", "currency_mismatch"],
    ["nieznany albo cudzego najemcy", "not_found"],
  ])("kupon %s: sesja NIE powstaje, zamówienie NIE powstaje", async (_opis, reason) => {
    rpcResponses.set("validate_b2b_coupon_for_user", ok([couponRefused(reason)]));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: reason });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("pusta odpowiedź bazy (cudzy najemca) daje `not_found`, a nie zamówienie bez rabatu", async () => {
    rpcResponses.set("validate_b2b_coupon_for_user", ok([]));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("odpowiedź `null` zamiast wierszy jest odmową, nie przepustką", async () => {
    // Awaria kształtu odpowiedzi RPC nie może się skończyć zamówieniem bez
    // rabatu ani sesją z kuponem, którego baza nie potwierdziła.
    rpcResponses.set("validate_b2b_coupon_for_user", ok(null));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("odmowa bez powodu schodzi na `not_found`", async () => {
    rpcResponses.set("validate_b2b_coupon_for_user", ok([{ ...couponRefused(""), error: null }]));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("BŁĄD walidacji kuponu jest zgłaszany", async () => {
    rpcResponses.set("validate_b2b_coupon_for_user", fail("function does not exist"));

    await expect(planCall({ couponCode: "PARTNER-CEE" })).rejects.toThrow(
      "function does not exist",
    );
  });

  it("limit prób kodów z bazy wraca WŁASNYM powodem, nie wyjątkiem „płatności nieskonfigurowane”", async () => {
    rpcResponses.set(
      "validate_b2b_coupon_for_user",
      fail("rate_limited: too many code attempts, try again later"),
    );

    expect(await planCall({ couponCode: "PARTNER-CEE" })).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });

  it("ważny kupon zakłada u operatora rabat jednorazowy o kwocie z BAZY", async () => {
    await planCall({ couponCode: "PARTNER-CEE" });

    expect(stripeCall("coupons.create")?.args[0]).toMatchObject({
      amount_off: 1000,
      currency: "pln",
      duration: "once",
    });
    expect(lastSession()?.discounts).toEqual([{ coupon: "coupon_1" }]);
  });

  it("kupon o zerowym rabacie nie zakłada rabatu u operatora, ale REZERWUJE użycie", async () => {
    // Kupon bez rabatu kwotowego (np. nadający wyłącznie warstwę członkostwa)
    // nadal zużywa limit - inaczej dałoby się go użyć bez ograniczeń.
    rpcResponses.set(
      "validate_b2b_coupon_for_user",
      ok([couponOk({ discount_cents: 0, final_cents: 4900 })]),
    );

    await planCall({ couponCode: "PARTNER-CEE" });

    expect(stripeCall("coupons.create")).toBeUndefined();
    expect(rpcArgs("redeem_b2b_coupon_for_user")).toBeDefined();
  });

  it("rabat, którego operator nie założył, to ODMOWA - nie sesja po cenie bez zniżki", async () => {
    // Zamówienie zapisuje kwotę PO kuponie. Sesja bez rabatu pobrałaby więcej,
    // niż pokazała kasa - zamówienie zamyka się jako `failed`, a użycie kuponu
    // wraca do puli.
    h.state.coupon = {};

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "discount_unavailable" });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "failed",
    });
    expect(rpcArgs("release_b2b_coupon_for_user")).toMatchObject({ _order_id: "order-1" });
  });

  it("awaria operatora przy zakładaniu rabatu zamyka zamówienie i zwalnia kupon", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    h.state.couponError = new Error("rate_limit");

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("rate_limit");
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    expect(rpcArgs("payment_order_mark_session")).toMatchObject({ _status: "failed" });
    expect(rpcArgs("release_b2b_coupon_for_user")).toMatchObject({ _order_id: "order-1" });
    logged.mockRestore();
  });

  it("PRZEGRANY WYŚCIG o ostatnie użycie unieważnia założone zamówienie", async () => {
    rpcResponses.set("redeem_b2b_coupon_for_user", ok(false));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "limit_reached" });
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "canceled",
    });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    // Rabat u operatora powstaje DOPIERO po udanej rezerwacji - przegrany
    // wyścig nie zostawia na wspólnym koncie kuponu bez zamówienia.
    expect(stripeCall("coupons.create")).toBeUndefined();
  });

  it("BŁĄD rezerwacji jest traktowany jak przegrany wyścig", async () => {
    rpcResponses.set("redeem_b2b_coupon_for_user", fail("could not obtain lock"));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "limit_reached" });
  });
});

describe("createPlanCheckoutSession - werdykt jako JEDEN obiekt jsonb (od 20261001210000)", () => {
  // Po migracji walidator oddaje obiekt zamiast zbioru wierszy. Ten silnik ma
  // czytać go tak samo jak drugi (`checkout.functions.ts`) i tak samo jak
  // dawny `[wiersz]` - inaczej po wdrożeniu migracji ważny kupon dawałby tu
  // `not_found`, a w drugim silniku rabat.
  it("ważny kupon jako obiekt: rabat u operatora, rezerwacja i audyt jak przy wierszu", async () => {
    rpcResponses.set("validate_b2b_coupon_for_user", ok(couponOk()));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result.ok).toBe(true);
    expect(stripeCall("coupons.create")?.args[0]).toMatchObject({
      amount_off: 1000,
      currency: "pln",
      duration: "once",
    });
    expect(lastSession()?.discounts).toEqual([{ coupon: "coupon_1" }]);
    expect(rpcArgs("redeem_b2b_coupon_for_user")).toMatchObject({
      _coupon_id: COUPON_ID,
      _applied_cents: 1000,
      _original_cents: 4900,
    });
    expect(orderMetadata()).toEqual({
      quantity: 1,
      coupon_code: "PARTNER-CEE",
      coupon_id: COUPON_ID,
      coupon_discount_cents: 1000,
      original_amount_cents: 4900,
    });
  });

  it("odmowa jako obiekt: sesja i zamówienie NIE powstają, powód z bazy", async () => {
    rpcResponses.set("validate_b2b_coupon_for_user", ok(couponRefused("expired")));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "expired" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it.each([
    ["coupon_id", "obiekt"],
    ["final_cents", "obiekt"],
    ["coupon_id", "wiersz"],
    ["final_cents", "wiersz"],
  ] as const)(
    "sukces bez `%s` (%s) to `not_found`: bez zamówienia, rabatu u operatora i rezerwacji",
    async (key, shape) => {
      // `ok: true` bez kuponu nie wskazuje, czyje użycie zarezerwować, a bez
      // kwoty końcowej werdykt nie jest pełny. Przepuszczenie go dałoby rabat
      // u operatora, którego baza nie przypisała do żadnego kuponu.
      const verdict = couponOkWithout(key);
      rpcResponses.set(
        "validate_b2b_coupon_for_user",
        ok(shape === "obiekt" ? verdict : [verdict]),
      );

      const result = await planCall({ couponCode: "PARTNER-CEE" });

      expect(result).toEqual({ ok: false, error: "not_found" });
      expect(chain.chainsFor("payment_orders")).toHaveLength(0);
      expect(stripeCall("coupons.create")).toBeUndefined();
      expect(rpcCalls.map((c) => c.fn)).not.toContain("redeem_b2b_coupon_for_user");
    },
  );
});

describe("createPlanCheckoutSession - sesja u operatora i sprzątanie po odmowie", () => {
  it("sesja powstaje z ceny katalogowej, a zamówienie dostaje jej identyfikator", async () => {
    const result = await planCall();

    expect(result).toEqual({
      ok: true,
      clientSecret: "cs_test_1_secret",
      orderId: "order-1",
    });
    expect(lastSession()?.line_items[0]?.price).toBe("price_1");
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _session_id: "cs_test_1",
      _status: "processing",
    });
  });

  it("kwota zamówienia pochodzi Z PLANU - żądanie nie zawiera i nie może zawierać ceny", async () => {
    chain.setResponse("access_plans", ok(planQuote({ price_cents: 29900, currency: "EUR" })));
    h.state.prices = [h.catalogPrice({ currency: "eur", unit_amount: 29900 })];

    await planCall({ amountCents: 1, currency: "PLN" });

    expect(insertedOrder()?.amount_cents).toBe(29900);
    expect(insertedOrder()?.currency).toBe("EUR");
  });

  it("OKRES PRÓBNY planu trafia do sesji subskrypcji (audyt wyd. 11/12, defekt wysoki)", async () => {
    // U Stripe trial NIE siedzi na cenie - katalog trzyma `trial_days` tylko
    // w metadanych ceny. Bez `subscription_data.trial_period_days` trasa
    // `/checkout/$planId` obciążała kartę od razu, choć cennik obiecywał
    // okres próbny. Drugi silnik (`checkout.functions.ts`) robił to dobrze.
    chain.setResponse("access_plans", ok(planQuote({ trial_days: 14 })));

    await planCall();

    expect(chain.lastChain("access_plans")?.argsOf("select")?.[0]).toContain("trial_days");
    expect(lastSession()?.subscription_data?.trial_period_days).toBe(14);
  });

  it("plan BEZ okresu próbnego nie wysyła `trial_period_days` (0 to u operatora błąd)", async () => {
    await planCall();

    expect(lastSession()?.subscription_data).toBeDefined();
    expect(lastSession()?.subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("wiersz planu BEZ kolumny okresu próbnego nie wysyła `NaN` dni (ta sama reguła co drugi silnik)", async () => {
    // Nieaktualny cache schematu PostgREST potrafi oddać wiersz bez kolumny;
    // `Number(undefined)` to NaN, którego operator nie przyjmie jako dni triala.
    chain.setResponse("access_plans", ok(planQuote({ trial_days: undefined })));

    const result = await planCall();

    expect(result.ok).toBe(true);
    expect(lastSession()?.subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("ujemny okres próbny z bazy jest zaciskany do braku triala", async () => {
    chain.setResponse("access_plans", ok(planQuote({ trial_days: -3 })));

    await planCall();

    expect(lastSession()?.subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("liczba miejsc planu ZA MIEJSCE jedzie do pozycji sesji i do kwoty zamówienia", async () => {
    chain.setResponse("access_plans", ok(planQuote({ tier_key: "team", price_cents: 9900 })));
    h.state.prices = [
      h.catalogPrice({ id: "price_team", lookup_key: "team_monthly_seat", unit_amount: 9900 }),
    ];

    await planCall({ seats: 5 });

    expect(lastSession()?.line_items[0]).toMatchObject({ price: "price_team", quantity: 5 });
    expect(insertedOrder()?.amount_cents).toBe(49500);
    expect(orderMetadata()).toEqual({ quantity: 5 });
  });

  it("plan NIE rozliczany za miejsce ignoruje liczbę miejsc z żądania", async () => {
    await planCall({ seats: 5 });

    expect(lastSession()?.line_items[0]?.quantity).toBe(1);
    expect(insertedOrder()?.amount_cents).toBe(4900);
  });

  it("próg wolumenowy przecenia WSZYSTKIE miejsca - tak samo jak drugi silnik", async () => {
    chain.setResponse(
      "access_plans",
      ok(
        planQuote({
          tier_key: "team",
          price_cents: 9900,
          volume_threshold_seats: 11,
          volume_price_cents: 7900,
        }),
      ),
    );
    // Cena u operatora jest schodkowa (`volume`) - tak ją zakłada catalogSync.
    h.state.prices = [
      h.catalogPrice({
        id: "price_team",
        lookup_key: "team_monthly_seat",
        billing_scheme: "tiered",
        tiers_mode: "volume",
        unit_amount: null,
        tiers: [
          { up_to: 10, unit_amount: 9900, flat_amount: null },
          { up_to: null, unit_amount: 7900, flat_amount: null },
        ],
      }),
    ];

    await planCall({ seats: 11 });

    expect(insertedOrder()?.amount_cents).toBe(86900);
    expect(lastSession()?.line_items[0]?.quantity).toBe(11);
  });

  it("liczba miejsc z żądania NIE mnoży planu jednostkowego", async () => {
    // Zmienione zachowanie (audyt SUB-05): `quantity: 5` szło dotąd wprost do
    // pozycji sesji przy zamówieniu za JEDNĄ sztukę - operator pobierał
    // 5 × cena, zamówienie zapisywało 1 × cena. Ten test wcześniej utrwalał
    // to zachowanie jako poprawne.
    await planCall({ quantity: 5 });

    expect(lastSession()?.line_items[0]?.quantity).toBe(1);
    expect(insertedOrder()?.amount_cents).toBe(4900);
  });

  it("plan rozliczany za miejsce: liczba miejsc jedzie do sesji I do kwoty zamówienia", async () => {
    chain.setResponse("access_plans", ok(planQuote({ tier_key: "team", price_cents: 9900 })));
    h.state.prices = [stripePrice({ lookup_key: "team_monthly_seat", unit_amount: 9900 })];

    const result = await planCall({ priceId: "team_monthly_seat", quantity: 5 });

    expect(result.ok).toBe(true);
    expect(lastSession()?.line_items[0]?.quantity).toBe(5);
    expect(insertedOrder()?.amount_cents).toBe(5 * 9900);
  });

  it("bez liczby miejsc pozycja ma jedną sztukę", async () => {
    await planCall();

    expect(lastSession()?.line_items[0]?.quantity).toBe(1);
  });

  it("język ramki operatora jedzie z żądania - checkout nie zna naszego i18n", async () => {
    await planCall({ locale: "en" });

    expect(lastSession()?.locale).toBe("en");
  });

  it("bez wskazania języka ramka jest polska", async () => {
    await planCall();

    expect(lastSession()?.locale).toBe("pl");
  });

  it("adres powrotu jest przepisywany na WŁASNY origin", async () => {
    await planCall({ returnUrl: "https://zlodziej.example.com/przejmij" });

    expect(lastSession()?.return_url).toBe("https://kasa.example.org/przejmij");
  });

  it("KONTRPRZYKŁAD: host żądania SPOZA listy nie zostaje originem powrotu", async () => {
    vi.stubEnv("BILLING_RETURN_HOSTS", "");

    await planCall({ returnUrl: "https://zlodziej.example.com/przejmij" });

    expect(lastSession()?.return_url).toBe("https://neweuropeanstrategies.com/przejmij");
  });

  it("ustawienia checkoutu są czytane dla TENANTU ZAMÓWIENIA", async () => {
    chain.setResponse("payment_orders", ok({ id: "order-1", tenant_id: "tenant-beta" }));

    await planCall();

    expect(chain.lastChain("checkout_settings")?.argsOf("eq")).toEqual([
      "tenant_id",
      "tenant-beta",
    ]);
  });

  it("środowisko z żądania stempluje zamówienie i wybiera klienta operatora", async () => {
    await planCall({ environment: "live" });

    expect(insertedOrder()?.environment).toBe("live");
    expect(stripeCall("getStripeClient")?.args[0]).toBe("live");
  });

  it("konto bez adresu w tokenie nie wywraca kasy - paragon zostaje pusty", async () => {
    // Adres pochodzi WYŁĄCZNIE z tokenu (żądanie go nie zawiera). Konto bez
    // potwierdzonego adresu ma dalej móc zapłacić - brak paragonu jest
    // mniejszym kosztem niż zablokowana płatność.
    const result = await callServerFn<SessionResult>(
      createPlanCheckoutSession,
      { planId: PLAN_ID, returnUrl: RETURN_URL },
      contextWithoutEmail(),
    );

    expect(result.ok).toBe(true);
    expect(insertedOrder()?.receipt_email).toBeNull();
  });

  it("brak ceny u operatora: zamówienie dostaje `failed`, nie zostaje wiszące", async () => {
    h.state.prices = [];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await planCall();

    expect(result).toEqual({ ok: false, error: "price_missing" });
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "failed",
    });
    logged.mockRestore();
  });

  it("zarezerwowane użycie kuponu WRACA DO PULI po odmowie operatora", async () => {
    h.state.prices = [];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await planCall({ couponCode: "PARTNER-CEE" });

    // Zwolnienie idzie rolą serwisową w najemcy ZAMÓWIENIA i dla konta z sesji
    // (20261007140200) - baza oddaje użycie tylko nieopłaconemu zamówieniu.
    expect(rpcArgs("release_b2b_coupon_for_user")).toEqual({
      _tenant_id: "tenant-alfa",
      _user_id: "user-kupujacy",
      _coupon_id: COUPON_ID,
      _order_id: "order-1",
    });
    logged.mockRestore();
  });

  it("NIEUDANE zwolnienie kuponu nie zmienia odmowy - zamówienie `failed`, ślad w logu", async () => {
    // Zwolnienie jest sprzątaniem po odmowie operatora: jego porażka nie może
    // zamienić czytelnej odmowy w wyjątek, ale musi zostawić ślad - użycie
    // kodu zostało zarezerwowane za zamówienie, którego nikt nie opłaci.
    h.state.prices = [];
    rpcResponses.set("release_b2b_coupon_for_user", fail("deadlock detected"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "price_missing" });
    expect(rpcArgs("payment_order_mark_session")).toMatchObject({ _status: "failed" });
    expect(logged).toHaveBeenCalledWith(
      "[stripe-checkout] coupon release failed",
      "order-1",
      "deadlock detected",
    );
    logged.mockRestore();
  });

  it("bez kuponu odmowa operatora nie woła zwolnienia", async () => {
    h.state.prices = [];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await planCall();

    expect(rpcCalls.map((c) => c.fn)).not.toContain("release_b2b_coupon_for_user");
    logged.mockRestore();
  });

  it("wyjątek operatora wraca jako czytelny komunikat", async () => {
    h.state.sessionError = new Error("card_declined");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await planCall();

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("card_declined");
    logged.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// AUDYT SUB-05: cenę i ilość wyprowadza serwer z planu; kwota zamówienia musi
// zgadzać się z ceną operatora.
// ---------------------------------------------------------------------------

describe("createPlanCheckoutSession - cena z planu, nie z żądania (audyt SUB-05)", () => {
  it("`priceId` z żądania innego niż pozycja planu: odmowa, zamówienie NIE powstaje", async () => {
    // Plan „Plus" z `priceId: "student_monthly"` dawał zamówienie Plus
    // opłacone u operatora ceną studencką.
    const result = await planCall({ priceId: "student_monthly" });

    expect(result).toEqual({ ok: false, error: "plan_price_mismatch" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
  });

  it("plan bez pozycji w swoim cyklu (np. kwartalny Pro): odmowa zamiast ceny miesięcznej", async () => {
    chain.setResponse("access_plans", ok(planQuote({ tier_key: "pro", interval: "quarter" })));

    const result = await planCall({ priceId: "pro_monthly" });

    expect(result).toEqual({ ok: false, error: "plan_price_missing" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("cena operatora RÓŻNA od kwoty planu najemcy: sesja NIE powstaje, zamówienie `failed`", async () => {
    // Cena wspólna (najemca domyślny) 59 zł, plan najemcy zamówienia 49 zł:
    // zamówienie zapisałoby 49 zł, operator pobrałby 59 zł.
    h.state.prices = [stripePrice({ unit_amount: 5900 })];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "price_mismatch" });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "failed",
    });
    // Kupon zarezerwowany przed sesją wraca do puli.
    expect(rpcArgs("release_b2b_coupon_for_user")).toMatchObject({ _order_id: "order-1" });
    logged.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// AUDYT SUB-13: druga subskrypcja i trial raz na konto.
// ---------------------------------------------------------------------------

describe("createPlanCheckoutSession - druga subskrypcja i ponowny trial (audyt SUB-13)", () => {
  it("ŻYWA subskrypcja planu w lustrze: odmowa `subscription_exists` PRZED zamówieniem", async () => {
    chain.setResponse("subscriptions", ok([{ status: "active" }]));

    const result = await planCall();

    expect(result).toEqual({ ok: false, error: "subscription_exists" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("historia jest czytana dla konta z SESJI i środowiska zamówienia (zakres najemcy daje RLS)", async () => {
    await planCall({ environment: "live" });

    const history = chain.lastChain("subscriptions");
    expect(history?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["user_id", "user-kupujacy"],
      ["environment", "live"],
    ]);
  });

  it("drugi trial NIE przysługuje: wcześniejsza (anulowana) subskrypcja zdejmuje okres próbny", async () => {
    chain.setResponse("access_plans", ok(planQuote({ trial_days: 14 })));
    chain.setResponse("subscriptions", ok([{ status: "canceled" }]));

    const result = await planCall();

    expect(result.ok).toBe(true);
    expect(lastSession()?.subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("pierwszy zakup DOSTAJE trial", async () => {
    chain.setResponse("access_plans", ok(planQuote({ trial_days: 14 })));

    await planCall();

    expect(lastSession()?.subscription_data?.trial_period_days).toBe(14);
  });

  it("żywa subskrypcja widoczna TYLKO u operatora (przed webhookiem): odmowa i zamówienie `failed`", async () => {
    h.state.remoteSubscriptions = [{ id: "sub_1", status: "trialing", metadata: {} }];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await planCall();

    expect(result).toEqual({ ok: false, error: "subscription_exists" });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    expect(rpcArgs("payment_order_mark_session")).toMatchObject({ _status: "failed" });
    logged.mockRestore();
  });

  it("otwarta sesja z poprzedniej karty jest wygaszana, a JEJ zamówienie anulowane (audyt #18)", async () => {
    // Bez tego obie sesje dało się opłacić: dwie subskrypcje, dwa obciążenia.
    h.state.openSessions = [
      {
        id: "cs_karta_1",
        mode: "subscription",
        status: "open",
        created: 1,
        metadata: { userId: "user-kupujacy", planId: PLAN_ID, orderId: "ord-karta-1" },
      } as { id: string },
    ];

    const result = await planCall();

    expect(result.ok).toBe(true);
    expect(stripeCall("checkout.sessions.expire")?.args).toEqual(["cs_karta_1"]);
    const marks = rpcCalls.filter((c) => c.fn === "payment_order_mark_session").map((c) => c.args);
    expect(marks).toContainEqual({ _order_id: "ord-karta-1", _status: "canceled" });
    // Nowe zamówienie idzie dalej normalnie.
    expect(marks.at(-1)).toMatchObject({ _session_id: "cs_test_1", _status: "processing" });
  });

  it("Pro -> Zespół (inny model rozliczenia) nie jest blokowany przez lustro (audyt #19)", async () => {
    chain.setResponse(
      "access_plans",
      ok(planQuote({ tier_key: "team", price_cents: 8900, trial_days: 14 })),
    );
    chain.setResponse("subscriptions", ok([{ status: "active", price_id: "pro_monthly" }]));
    h.state.prices = [stripePrice({ lookup_key: "team_monthly_seat", unit_amount: 8900 })];

    const result = await planCall({ priceId: "team_monthly_seat", quantity: 2 });

    expect(result.ok).toBe(true);
    // Plan już był - osobny zakup, ale bez drugiego triala.
    expect(lastSession()?.subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("subskrypcja DAROWIZNY u operatora nie blokuje zakupu planu", async () => {
    h.state.remoteSubscriptions = [
      { id: "sub_don", status: "active", metadata: { purpose: "donation" } },
    ];

    const result = await planCall();

    expect(result.ok).toBe(true);
  });

  it("BŁĄD odczytu historii jest zgłaszany - „nie wiem” nie znaczy „brak subskrypcji”", async () => {
    chain.setResponse("subscriptions", fail("permission denied for table subscriptions"));

    await expect(planCall()).rejects.toThrow("subscription history lookup failed");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("plan jednorazowy (Decision Lab) nie przechodzi przez strażnika subskrypcji", async () => {
    // Mechanika produktu jednorazowego, nie oferta Decision Labu (patrz `enquiry`).
    enquiry.locked = false;
    chain.setResponse(
      "access_plans",
      ok(planQuote({ tier_key: "decision_lab", interval: "one_time", price_cents: 1600000 })),
    );
    chain.setResponse("subscriptions", ok([{ status: "active" }]));
    h.state.prices = [
      stripePrice({
        lookup_key: "decision_lab_seat",
        type: "one_time",
        recurring: null,
        unit_amount: 1600000,
      }),
    ];

    const result = await planCall({ priceId: "decision_lab_seat" });

    expect(result.ok).toBe(true);
    expect(chain.chainsFor("subscriptions")).toHaveLength(0);
  });
});

describe("createPlanCheckoutSession - walidacja wejścia", () => {
  it("plan o złym kształcie identyfikatora nie dociera do bazy", async () => {
    await expect(planCall({ planId: "nie-uuid" })).rejects.toThrow();
    expect(chain.chains).toHaveLength(0);
  });

  it("adres powrotu musi być pełnym URL-em", async () => {
    await expect(planCall({ returnUrl: "/checkout/sukces" })).rejects.toThrow();
  });

  it("liczba miejsc spoza zakresu 1..100 jest odrzucana", async () => {
    await expect(planCall({ seats: 0 })).rejects.toThrow();
    await expect(planCall({ seats: 101 })).rejects.toThrow();
    await expect(planCall({ seats: 2.5 })).rejects.toThrow();
    // Dawna nazwa `seats` (klient sprzed zmiany) ma ten sam zakres.
    await expect(planCall({ quantity: 0 })).rejects.toThrow();
    await expect(planCall({ quantity: 101 })).rejects.toThrow();
  });

  it("pusty identyfikator ceny (asercja klienta sprzed zmiany) jest odrzucany", async () => {
    await expect(planCall({ priceId: "" })).rejects.toThrow();
    expect(chain.chains).toHaveLength(0);
  });

  it("`seats` ma pierwszeństwo przed dawnym `quantity`", async () => {
    chain.setResponse("access_plans", ok(planQuote({ tier_key: "team", price_cents: 9900 })));
    h.state.prices = [
      h.catalogPrice({ id: "price_team", lookup_key: "team_monthly_seat", unit_amount: 9900 }),
    ];

    await planCall({ seats: 3, quantity: 7 });

    expect(lastSession()?.line_items[0]).toMatchObject({ price: "price_team", quantity: 3 });
    expect(insertedOrder()?.amount_cents).toBe(3 * 9900);
  });

  it("nieobsługiwany język ramki jest odrzucany", async () => {
    await expect(planCall({ locale: "de" })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// CENA WIĄZANA Z PLANEM - kryterium audytu PAY-01.
// ---------------------------------------------------------------------------

describe("createPlanCheckoutSession - cena wiązana z planem (audyt PAY-01)", () => {
  // CO BYŁO ZŁE. Żądanie niosło `priceId` i `quantity`, a zamówienie
  // dostawało `plan_id`, kwotę `price_cents` i zawsze `kind: subscription`.
  // Ręcznie złożone żądanie z kuponem kwotowym dopasowanym do drogiego planu
  // i `priceId: pro_annual` dawało pierwszą fakturę Pro na 0 zł; plan z ceną
  // jednorazową zakładał zamówienie subskrypcyjne z obcą kwotą, a liczba
  // miejsc nie trafiała do kwoty zamówienia.
  //
  // JAK NAPRAWIONE. Schemat nie zna ceny ani kwoty. Wpis katalogu, ilość,
  // kwotę i tryb liczy `planCheckoutPricing` z wiersza planu (wspólny
  // z drugim silnikiem), a sesja odmawia, gdy cena u operatora ma inny typ
  // albo walutę niż zamówienie. Po scaleniu z audytem SUB-05 `priceId`
  // i `quantity` klienta sprzed zmiany zostają WYŁĄCZNIE jako zgodność wstecz:
  // `priceId` to asercja (inna cena = odmowa, nigdy źródło ceny), `quantity`
  // to dawna nazwa `seats`.
  it("schemat nie przenosi ceny ani kwoty z żądania - `priceId`/`quantity` to tylko pola zgodności", () => {
    const parsed = asServerFn(createPlanCheckoutSession).validator?.({
      planId: PLAN_ID,
      returnUrl: RETURN_URL,
      priceId: "pro_annual",
      quantity: 7,
      amountCents: 1,
      unitAmount: 1,
    });

    expect(parsed).toEqual({
      planId: PLAN_ID,
      returnUrl: RETURN_URL,
      priceId: "pro_annual",
      quantity: 7,
    });
    expect(parsed).not.toHaveProperty("amountCents");
  });

  it("stary klient z `priceId` PLANU i `quantity` dostaje sesję z ceną i ilością z PLANU", async () => {
    // Plan „Członek" nie jest rozliczany za miejsce: `quantity: 7` nie mnoży
    // pozycji, a operator jest pytany o `lookup_key` planu.
    const result = await planCall({ priceId: "plus_monthly", quantity: 7 });

    expect(result.ok).toBe(true);
    expect(stripeCall("prices.list")?.args[0]).toMatchObject({ lookup_keys: ["plus_monthly"] });
    expect(lastSession()?.line_items[0]).toMatchObject({ price: "price_1", quantity: 1 });
    expect(insertedOrder()?.amount_cents).toBe(4900);
  });

  it("`priceId: pro_annual` dla planu spoza Pro to ODMOWA, nie sesja z ceną planu", async () => {
    // Zmienione po scaleniu z audytem SUB-05 (świadomie surowiej): dawniej
    // wskazana cena była po cichu ignorowana; teraz żądanie o inną cenę niż
    // pozycja planu kończy się `plan_price_mismatch` przed kuponem
    // i zamówieniem - kupujący nie dostaje sesji na coś innego, niż widział.
    const result = await planCall({ priceId: "pro_annual", quantity: 7 });

    expect(result).toEqual({ ok: false, error: "plan_price_mismatch" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("cena niezgodna z planem -> odmowa: zamówienie `failed`, rezerwacja kuponu zwolniona", async () => {
    // Pod `lookup_key` planu cyklicznego operator trzyma cenę JEDNORAZOWĄ
    // (ręczna edycja, przeniesiony klucz). Sesja pobrałaby jednorazowo kwotę
    // planu, a zamówienie czekałoby na subskrypcję, która nigdy nie powstanie.
    h.state.prices = [h.catalogPrice({ type: "one_time", recurring: null })];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "price_mismatch" });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "failed",
    });
    expect(rpcArgs("release_b2b_coupon_for_user")).toEqual({
      _tenant_id: "tenant-alfa",
      _user_id: "user-kupujacy",
      _coupon_id: COUPON_ID,
      _order_id: "order-1",
    });
    logged.mockRestore();
  });

  it("cena w INNEJ WALUCIE niż plan -> odmowa `price_mismatch`", async () => {
    h.state.prices = [h.catalogPrice({ currency: "eur" })];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await planCall();

    expect(result).toEqual({ ok: false, error: "price_mismatch" });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    expect(rpcArgs("payment_order_mark_session")).toMatchObject({ _status: "failed" });
    logged.mockRestore();
  });

  it("plan bez spójnej ceny katalogowej: odmowa PRZED kuponem, zamówieniem i operatorem", async () => {
    chain.setResponse("access_plans", ok(planQuote({ tier_key: "warstwa-spoza-katalogu" })));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "plan_price_missing" });
    expect(rpcCalls).toHaveLength(0);
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("plan cykliczny oznaczony jako JEDNORAZOWY nie schodzi na cenę subskrypcji", async () => {
    // `catalogPriceForPlan` bez pary (warstwa, cykl) bierze pierwszy wpis
    // warstwy - dla Pro „jednorazowego" byłaby to subskrypcja miesięczna.
    chain.setResponse("access_plans", ok(planQuote({ tier_key: "pro", interval: "one_time" })));

    const result = await planCall();

    expect(result).toEqual({ ok: false, error: "plan_price_missing" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("plan JEDNORAZOWY zakłada zamówienie `one_time` i sesję `payment` bez okresu próbnego", async () => {
    // Mechanika produktu jednorazowego, nie oferta Decision Labu (patrz `enquiry`).
    enquiry.locked = false;
    chain.setResponse(
      "access_plans",
      ok(planQuote({ tier_key: "decision_lab", interval: "one_time", trial_days: 14 })),
    );
    h.state.prices = [
      h.catalogPrice({
        id: "price_lab",
        lookup_key: "decision_lab_seat",
        type: "one_time",
        recurring: null,
        product: { id: "prod_lab", name: "Decision Lab" },
      }),
    ];

    const result = await planCall();

    expect(result.ok).toBe(true);
    expect(insertedOrder()?.kind).toBe("one_time");
    expect(lastSession()?.mode).toBe("payment");
    expect(lastSession()?.line_items[0]?.price).toBe("price_lab");
    expect(lastSession()?.subscription_data).toBeUndefined();
  });

  it("plan cykliczny zakłada zamówienie `subscription`", async () => {
    await planCall();

    expect(insertedOrder()?.kind).toBe("subscription");
    expect(lastSession()?.mode).toBe("subscription");
  });

  it("kupon jest walidowany od kwoty BRUTTO wyceny (miejsca), nie od `price_cents`", async () => {
    chain.setResponse("access_plans", ok(planQuote({ tier_key: "team", price_cents: 9900 })));
    h.state.prices = [
      h.catalogPrice({ id: "price_team", lookup_key: "team_monthly_seat", unit_amount: 9900 }),
    ];
    rpcResponses.set(
      "validate_b2b_coupon_for_user",
      ok([couponOk({ discount_cents: 2970, final_cents: 26730 })]),
    );

    await planCall({ seats: 3, couponCode: "PARTNER-CEE" });

    expect(rpcArgs("validate_b2b_coupon_for_user")).toMatchObject({ _amount_cents: 29700 });
    expect(rpcArgs("redeem_b2b_coupon_for_user")).toMatchObject({
      _applied_cents: 2970,
      _original_cents: 29700,
    });
    expect(insertedOrder()?.amount_cents).toBe(26730);
    expect(orderMetadata()).toMatchObject({ quantity: 3, original_amount_cents: 29700 });
  });

  it("plan za zero złotych nie rezerwuje kuponu ani nie zakłada zamówienia (`zero_amount`)", async () => {
    chain.setResponse("access_plans", ok(planQuote({ price_cents: 0 })));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "zero_amount" });
    expect(rpcCalls).toHaveLength(0);
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });
});

describe("createPlanCheckoutSession - dokładna para i cena zgodna z planem (przegląd PAY-01, 0.1)", () => {
  // CO BYŁO ZŁE. Plan bez dokładnej pary (warstwa, cykl) w katalogu dostawał
  // pierwszą cenę warstwy, a bramka sesji porównywała wyłącznie typ i walutę.
  // „Pro kwartalny" otwierał subskrypcję `pro_monthly` (co miesiąc, inną
  // kwotą), a cena z dryfem kwoty albo cyklu przechodziła - rozjazd wychodził
  // dopiero w realizacji, po pobraniu pieniędzy.
  it("plan Pro KWARTALNY bez wpisu katalogu: `plan_price_missing`, bez schodzenia na `pro_monthly`", async () => {
    chain.setResponse(
      "access_plans",
      ok(planQuote({ tier_key: "pro", interval: "quarter", price_cents: 12900 })),
    );

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "plan_price_missing" });
    expect(rpcCalls).toHaveLength(0);
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("plan Biznes ROCZNY nie dostaje ceny co dwa tygodnie (`business_2w`)", async () => {
    chain.setResponse("access_plans", ok(planQuote({ tier_key: "business", interval: "year" })));

    expect(await planCall()).toEqual({ ok: false, error: "plan_price_missing" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("DRYF KWOTY u operatora (99 zł za plan 49 zł): `price_mismatch`, zamówienie `failed`, kupon zwolniony", async () => {
    h.state.prices = [h.catalogPrice({ unit_amount: 9900 })];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "price_mismatch" });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "failed",
    });
    expect(rpcArgs("release_b2b_coupon_for_user")).toMatchObject({
      _coupon_id: COUPON_ID,
      _order_id: "order-1",
    });
    logged.mockRestore();
  });

  it("cena planu ROCZNEGO rozliczana co dwa tygodnie u operatora: `price_mismatch`", async () => {
    chain.setResponse("access_plans", ok(planQuote({ interval: "year", price_cents: 49000 })));
    h.state.prices = [
      h.catalogPrice({
        lookup_key: "plus_annual",
        unit_amount: 49000,
        recurring: { interval: "week", interval_count: 2, usage_type: "licensed" },
      }),
    ];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await planCall();

    expect(result).toEqual({ ok: false, error: "price_mismatch" });
    expect(stripeCall("prices.list")?.args[0]).toMatchObject({ lookup_keys: ["plus_annual"] });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    logged.mockRestore();
  });

  it("cena schodkowa Zespołu z INNYM progiem niż plan: `price_mismatch` przed sesją", async () => {
    chain.setResponse(
      "access_plans",
      ok(
        planQuote({
          tier_key: "team",
          price_cents: 9900,
          volume_threshold_seats: 11,
          volume_price_cents: 7900,
        }),
      ),
    );
    h.state.prices = [
      h.catalogPrice({
        id: "price_team",
        lookup_key: "team_monthly_seat",
        billing_scheme: "tiered",
        tiers_mode: "volume",
        unit_amount: null,
        tiers: [
          { up_to: 20, unit_amount: 9900, flat_amount: null },
          { up_to: null, unit_amount: 7900, flat_amount: null },
        ],
      }),
    ];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await planCall({ seats: 11 })).toEqual({ ok: false, error: "price_mismatch" });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
    logged.mockRestore();
  });
});

describe("createPlanCheckoutSession - minimum operatora po kuponie (przegląd PAY-01, 0.3)", () => {
  // CO BYŁO ZŁE. Ten silnik nie miał progu: kupon 100% zakładał zamówienie na
  // 0 zł (plan jednorazowy = dożywotni dostęp za darmo), a kwota poniżej
  // minimum padała u operatora PO zamówieniu i rezerwacji. Drugi silnik od
  // zawsze odmawiał `final_amount_too_low` - teraz oba liczą jedną regułą
  // (`chargeMinimum.ts`), a te same przypadki stoją w `checkoutOrderCoupon`.
  const minimum = minimumChargeCents("PLN");

  it.each([
    ["kupon 100% (0 zł)", 0],
    ["1 grosz", 1],
    ["49 groszy (dawny próg pierwszego silnika)", 49],
    ["grosz pod minimum (1,99 zł)", minimum - 1],
  ])(
    "%s po kuponie: `final_amount_too_low`, bez zamówienia, rezerwacji i rabatu u operatora",
    async (_label, finalCents) => {
      rpcResponses.set(
        "validate_b2b_coupon_for_user",
        ok([couponOk({ discount_cents: 4900 - finalCents, final_cents: finalCents })]),
      );

      const result = await planCall({ couponCode: "PARTNER-CEE" });

      expect(result).toEqual({ ok: false, error: "final_amount_too_low" });
      expect(chain.chainsFor("payment_orders")).toHaveLength(0);
      expect(rpcCalls.map((c) => c.fn)).not.toContain("redeem_b2b_coupon_for_user");
      expect(stripeCall("coupons.create")).toBeUndefined();
    },
  );

  it("kupon 100% na plan JEDNORAZOWY też jest odmową - nie ma darmowego dożywotniego zakupu", async () => {
    // Mechanika produktu jednorazowego, nie oferta Decision Labu (patrz `enquiry`).
    enquiry.locked = false;
    chain.setResponse(
      "access_plans",
      ok(planQuote({ tier_key: "decision_lab", interval: "one_time", price_cents: 1600000 })),
    );
    rpcResponses.set(
      "validate_b2b_coupon_for_user",
      ok([couponOk({ discount_cents: 1600000, final_cents: 0 })]),
    );

    expect(await planCall({ couponCode: "PARTNER-CEE" })).toEqual({
      ok: false,
      error: "final_amount_too_low",
    });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("kwota równa minimum przechodzi - granica jest po stronie dozwolonej", async () => {
    rpcResponses.set(
      "validate_b2b_coupon_for_user",
      ok([couponOk({ discount_cents: 4900 - minimum, final_cents: minimum })]),
    );

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result.ok).toBe(true);
    expect(insertedOrder()?.amount_cents).toBe(minimum);
  });
});

describe("createPlanCheckoutSession - idempotencja u operatora (audyt PAY-16a)", () => {
  // Bez klucza ponowione żądanie (sieć, retry SDK) zakładało drugą sesję albo
  // drugi kupon `amount_off` na wspólnym koncie. Klucz pochodzi z zamówienia,
  // dlatego rabat u operatora powstaje dopiero PO jego założeniu.
  it("sesja dostaje klucz idempotencji z zamówienia", async () => {
    await planCall();

    expect(requestOptions("checkout.sessions.create")).toEqual({
      idempotencyKey: "checkout_session:order-1",
    });
  });

  it("kupon operatora dostaje klucz z zamówienia, inny niż klucz sesji", async () => {
    await planCall({ couponCode: "PARTNER-CEE" });

    expect(requestOptions("coupons.create")).toEqual({
      idempotencyKey: "checkout_coupon:order-1",
    });
  });
});

// ---------------------------------------------------------------------------
// AUDYT KUPONU - bramki po dwóch naprawionych defektach.
// ---------------------------------------------------------------------------

describe("createPlanCheckoutSession - audyt kuponu", () => {
  // DEFEKT NAPRAWIONY 31.08.2026 (`stripeCheckout.functions.ts`).
  //
  // CO BYŁO ZŁE. `redeem_b2b_coupon` dostawał z tego pliku `_applied_cents: 0`,
  // mimo że baza właśnie policzyła rabat (`validate_b2b_coupon.discount_cents`),
  // a sesja u operatora dostawała ten rabat co do grosza.
  //
  // JAKIE TO BYŁO RYZYKO. Semantyka kolumny jest ustalona jawnie w migracji
  // `20260725090200_fix_coupon_analytics_applied_cents_inversion.sql`:
  //   COMMENT ON COLUMN b2b_coupon_redemptions.applied_cents
  //     'RABAT zastosowany przy realizacji kuponu (...), nie kwota zaplacona.
  //      Niezmiennik: original_cents = applied_cents + zaplacone.'
  // Przy zerze niezmiennik pękał: `original_cents - applied_cents` (czyli
  // „przychód netto" w `b2b_coupons_analytics` i w `monetization_dashboard`)
  // wychodził PEŁNĄ cenę planu, a suma rabatów - zero. Każde zamówienie
  // złożone tym silnikiem było więc niewidoczne w raporcie kosztu kuponów
  // i zawyżało raportowany przychód dokładnie o udzielony rabat. Drugi silnik
  // (`checkout.functions.ts`) przekazywał w tym miejscu `couponDiscountCents`,
  // więc te same kupony liczyły się różnie w zależności od tego, którym
  // przyciskiem klient wszedł do kasy.
  //
  // JAK ZOSTAŁO NAPRAWIONE. Rabat z odpowiedzi bazy jedzie do rezerwacji jako
  // `_applied_cents` - dokładnie ta sama wartość, którą dostaje rabat
  // u operatora, więc oba silniki liczą kupony tak samo.
  it("rezerwacja zapisuje RABAT policzony przez bazę, nie zero", async () => {
    await planCall({ couponCode: "PARTNER-CEE" });

    expect(rpcArgs("redeem_b2b_coupon_for_user")).toMatchObject({
      _coupon_id: COUPON_ID,
      _original_cents: 4900,
      _applied_cents: 1000,
    });
  });

  it("kupon o ZEROWYM rabacie rezerwuje użycie z rabatem zero - to nie jest ta sama liczba", async () => {
    // Granica poprawki: zero nadal jest poprawną wartością, ale tylko wtedy,
    // gdy baza faktycznie policzyła zerowy rabat (kupon nadający wyłącznie
    // warstwę członkostwa). Niezmiennik kolumny zostaje spełniony.
    rpcResponses.set(
      "validate_b2b_coupon_for_user",
      ok([couponOk({ discount_cents: 0, final_cents: 4900 })]),
    );

    await planCall({ couponCode: "PARTNER-CEE" });

    expect(rpcArgs("redeem_b2b_coupon_for_user")).toMatchObject({
      _applied_cents: 0,
      _original_cents: 4900,
    });
  });

  // DEFEKT NAPRAWIONY 31.08.2026 (`stripeCheckout.functions.ts`).
  //
  // CO BYŁO ZŁE. Zamówienie z tego silnika dostawało w metadanych wyłącznie
  // `coupon_code`. Brakowało `coupon_id`, `coupon_discount_cents` i
  // `original_amount_cents`, które wkłada drugi silnik
  // (`checkout.functions.ts`).
  //
  // JAKIE TO BYŁO RYZYKO. `src/lib/billing/paymentHistory.ts` czyta rabat
  // DOKŁADNIE z tych kluczy (`meta["coupon_discount_cents"] ??
  // meta["discount_cents"]` oraz `meta["original_amount_cents"]`). Klient,
  // który kupił plan tym silnikiem z kuponem partnerskim, widział w swojej
  // historii płatności cenę bez śladu rabatu - a to jest dokument, którym
  // tłumaczy sobie kwotę na wyciągu z karty. Ta sama luka utrudniała ręczne
  // dochodzenie przy reklamacji, bo powiązanie zamówienia z konkretnym kuponem
  // (`coupon_id`) istniało wyłącznie w tabeli realizacji.
  //
  // JAK ZOSTAŁO NAPRAWIONE. Metadane zamówienia niosą pełny audyt kuponu
  // w tym samym kształcie, co drugi silnik - czyli parytet obu wejść do kasy.
  it("metadane zamówienia niosą PEŁNY audyt kuponu, tak jak w drugim silniku", async () => {
    await planCall({ couponCode: "PARTNER-CEE" });

    expect(orderMetadata()).toEqual({
      quantity: 1,
      coupon_code: "PARTNER-CEE",
      coupon_id: COUPON_ID,
      coupon_discount_cents: 1000,
      original_amount_cents: 4900,
    });
  });

  it("kod kuponu jest zapisany ZNORMALIZOWANY - tak jak poszedł do walidacji", async () => {
    await planCall({ couponCode: "partner-cee" });

    expect(orderMetadata()).toMatchObject({ coupon_code: "PARTNER-CEE" });
  });

  it("kwota pierwotna w metadanych pochodzi Z WYCENY PLANU, a zamówienie zapisuje kwotę PO kuponie", async () => {
    // KONTRAKT KWOT (audyt PAY-01/PAY-06): `amount_cents` to kwota, którą
    // kupujący ma zapłacić za pozycje PO naszym kuponie i PRZED podatkiem -
    // dokładnie tak, jak zapisuje ją drugi silnik (`checkout.functions.ts`).
    // Realizacja porównuje ją z kwotą sesji operatora (`amount_subtotal -
    // amount_discount`); zamówienie z ceną brutto przy sesji z rabatem
    // wyglądałoby jak rozjazd kwot. Brutto zostaje w `original_amount_cents`,
    // rabat w `coupon_discount_cents` - niezmiennik `original = amount + rabat`.
    rpcResponses.set(
      "validate_b2b_coupon_for_user",
      ok([couponOk({ discount_cents: 2500, final_cents: 2400 })]),
    );

    await planCall({ couponCode: "PARTNER-CEE" });

    expect(orderMetadata()).toMatchObject({
      coupon_discount_cents: 2500,
      original_amount_cents: 4900,
    });
    expect(insertedOrder()?.amount_cents).toBe(2400);
  });
});

// ---------------------------------------------------------------------------

describe("createAdhocCheckoutSession - cienki wrapper nad zamówieniem ad-hoc", () => {
  it("odblokowanie treści: kwota pochodzi z REGUŁY DOSTĘPU, nie z żądania", async () => {
    const result = await adhocCall({ amountCents: 1 });

    expect(result).toEqual({
      ok: true,
      clientSecret: "cs_test_1_secret",
      orderId: "order-1",
    });
    expect(insertedOrder()?.amount_cents).toBe(1500);
    expect(lastSession()?.line_items[0]?.price_data?.unit_amount).toBe(1500);
  });

  it("treść bez ceny jednorazowej nie jest na sprzedaż", async () => {
    chain.setResponse("content_access_public", ok({ mode: "members" }));

    const result = await adhocCall();

    expect(result).toEqual({ ok: false, error: "one_time_not_available" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("brak wskazania encji jest odmową bez odczytu reguły", async () => {
    const result = await adhocCall({ entityId: undefined });

    expect(result).toEqual({ ok: false, error: "entity_required" });
  });

  it("bilet na nieistniejące wydarzenie jest odmową", async () => {
    const result = await adhocCall({
      purpose: "event_ticket",
      entityType: undefined,
      entityId: undefined,
      eventId: EVENT_ID,
    });

    expect(result).toEqual({ ok: false, error: "ticket_not_available" });
  });

  it("BILET przez ten wrapper NIE dostaje pola kodu Stripe, choć tenant je włącza", async () => {
    // Ręcznie złożone żądanie `purpose: "event_ticket"` omija `createCheckoutOrder`,
    // a `buildAdhocOrder` podaje ustawienia tenantu (tu: pole kodu WŁĄCZONE) bez
    // zmian. Kod wpisany w nakładce operatora zszedłby wtedy z sesji bez zakresu
    // biletu, limitu użyć i wiersza realizacji - a webhook potwierdziłby miejsce
    // po niższej kwocie. Pole wyłącza sam budowniczy sesji.
    chain.setResponse("events", (recorded) =>
      String(recorded.argsOf("select")?.[0] ?? "").includes("capacity")
        ? ok({ capacity: null })
        : ok({
            id: EVENT_ID,
            title_pl: "Kongres CEE",
            title_en: "CEE Congress",
            ticket_price_cents: 12000,
            ticket_currency: "PLN",
            status: "published",
            // Za miesiąc WZGLĘDEM prawdziwego „teraz" - produkcja porównuje
            // `starts_at` z `Date.now()`, więc stała odległość, a nie literał
            // kalendarzowy, trzyma ten przypadek po właściwej stronie okna.
            starts_at: new Date(Date.now() + 30 * DZIEN).toISOString(),
          }),
    );
    chain.setResponse("event_rsvps", ok(null));
    rpcResponses.set(
      "event_seat_state",
      ok([{ capacity: null, seats_left: null, going: 0, waitlist: 0 }]),
    );
    rpcResponses.set(
      "my_ticket_allowance",
      ok({ granted: 0, used: 0, discount_pct: 0, scope: "none" }),
    );

    const result = await adhocCall({
      purpose: "event_ticket",
      entityType: undefined,
      entityId: undefined,
      eventId: EVENT_ID,
    });

    expect(result.ok).toBe(true);
    expect(lastSession()?.metadata).toMatchObject({ purpose: "event_ticket", event_id: EVENT_ID });
    expect(lastSession()?.line_items[0]?.price_data?.unit_amount).toBe(12000);
    expect(lastSession()?.allow_promotion_codes).toBeUndefined();
  });

  it("odblokowanie treści ZOSTAJE przy polu kodu Stripe z ustawień tenantu", async () => {
    await adhocCall();
    expect(lastSession()?.allow_promotion_codes).toBe(true);
  });

  it("sesja ad-hoc dostaje klucz idempotencji z zamówienia (audyt PAY-16a)", async () => {
    await adhocCall();

    expect(requestOptions("checkout.sessions.create")).toEqual({
      idempotencyKey: "checkout_session:order-1",
    });
  });

  it("adres powrotu jest przepisywany na własny origin także tutaj", async () => {
    await adhocCall({ returnUrl: "https://zlodziej.example.com/przejmij" });

    expect(lastSession()?.return_url).toBe("https://kasa.example.org/przejmij");
  });

  it("środowisko z żądania wybiera klienta operatora", async () => {
    await adhocCall({ environment: "live" });

    expect(stripeCall("getStripeClient")?.args[0]).toBe("live");
  });

  it("odmowa operatora oznacza zamówienie jako `failed`", async () => {
    h.state.sessionError = new Error("gateway timeout");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await adhocCall();

    expect(result.ok).toBe(false);
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "failed",
    });
    logged.mockRestore();
  });

  it("konto bez adresu w tokenie kupuje dalej, tylko bez paragonu", async () => {
    const result = await callServerFn<SessionResult>(
      createAdhocCheckoutSession,
      { purpose: "content_unlock", entityType: "post", entityId: POST_ID, returnUrl: RETURN_URL },
      contextWithoutEmail(),
    );

    expect(result.ok).toBe(true);
    expect(insertedOrder()?.receipt_email).toBeNull();
  });

  it("nieznany cel płatności jest odrzucany przez WALIDATOR", async () => {
    await expect(adhocCall({ purpose: "kryptowaluty" })).rejects.toThrow();
    expect(chain.chains).toHaveLength(0);
  });
});

describe("createAdhocCheckoutSession - darowizna poza kasą ad-hoc (audyt PAY-16b)", () => {
  // CO BYŁO ZŁE. Walidator przyjmował `purpose: "donation"` z kwotą od klienta.
  // Ścieżka zakładała `payment_orders` i sesję, a webhook księguje darowizny
  // wyłącznie po wierszu `donations` (`settleDonation`) - którego tu nie było.
  // Pieniądze wpływały, rozliczenie kończyło się `skipped`, bez zapisu w
  // rejestrze. Darowizny mają własną ścieżkę (`donations.functions.ts`).
  it("walidator odrzuca purpose donation - zanim cokolwiek dotknie bazy i operatora", async () => {
    await expect(
      adhocCall({
        purpose: "donation",
        entityType: undefined,
        entityId: undefined,
        amountCents: 5000,
      }),
    ).rejects.toThrow();
    expect(chain.chains).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("kwota i waluta z żądania nie są częścią kontraktu - odblokowanie płaci cenę reguły", async () => {
    const result = await adhocCall({ amountCents: 1, currency: "EUR" });

    expect(result.ok).toBe(true);
    expect(insertedOrder()?.amount_cents).toBe(1500);
    expect(insertedOrder()?.currency).toBe("PLN");
  });
});
