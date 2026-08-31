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
// UWAGA: ten plik zawiera DWA zarejestrowane defekty (`it.fails`) dotyczące
// audytu kuponu. Uzasadnienia stoją przy nich.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const state = {
    prices: [{ id: "price_1", lookup_key: "plus_monthly", type: "recurring" }] as unknown[],
    sessionError: null as Error | null,
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
  return { calls, state, record };
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

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: () => Promise.resolve({ data: true, error: null }) },
}));

vi.mock("@/lib/stripe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe.server")>();
  const { stripeStub } = await import("@/test/billing/fixtures");
  return {
    ...actual,
    createStripeClient: (env: string) => {
      h.calls.push({ method: "createStripeClient", args: [env] });
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
        coupons: { create: h.record("coupons.create", () => h.state.coupon) },
        checkout: {
          sessions: {
            ...base.checkout.sessions,
            create: h.record("checkout.sessions.create", () => {
              if (h.state.sessionError) throw h.state.sessionError;
              return { id: "cs_test_1", client_secret: "cs_test_1_secret" };
            }),
          },
        },
      };
    },
  };
});

const { callServerFn } = await import("@/test/serverFn");
const { createPlanCheckoutSession, createAdhocCheckoutSession } =
  await import("@/lib/billing/stripeCheckout.functions");

// --- kształty ---------------------------------------------------------------

type CouponVerdict = Database["public"]["Functions"]["validate_b2b_coupon"]["Returns"][number];

/** Kolumny planu, które czyta TEN silnik (`select` w kodzie). */
type PlanQuote = Pick<Tables<"access_plans">, "id" | "price_cents" | "currency" | "active">;

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
}

function planQuote(over: Partial<PlanQuote> = {}): PlanQuote {
  return { id: PLAN_ID, price_cents: 4900, currency: "PLN", active: true, ...over };
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
    { priceId: "plus_monthly", planId: PLAN_ID, returnUrl: RETURN_URL, ...over },
    context(),
  );
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
  h.calls.length = 0;
  h.state.prices = [{ id: "price_1", lookup_key: "plus_monthly", type: "recurring" }];
  h.state.sessionError = null;
  h.state.coupon = { id: "coupon_1" };

  chain = supabaseFromStub();
  rpcCalls = [];
  rpcResponses = new Map<string, SupabaseResult>();

  vi.stubEnv("LOVABLE_API_KEY", "klucz-testowy-bramki");
  vi.stubEnv("STRIPE_SANDBOX_API_KEY", "klucz-testowy-piaskownicy");

  chain.setResponse("access_plans", ok(planQuote()));
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
  rpcResponses.set("validate_b2b_coupon", ok([couponOk()]));
  rpcResponses.set("redeem_b2b_coupon", ok(true));
  rpcResponses.set("release_b2b_coupon", ok(true));
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

    expect(rpcCalls.map((c) => c.fn)).not.toContain("validate_b2b_coupon");
    expect(rpcCalls.map((c) => c.fn)).not.toContain("redeem_b2b_coupon");
    expect(stripeCall("coupons.create")).toBeUndefined();
    expect(orderMetadata()).toEqual({});
  });

  it("kod jest normalizowany i walidowany W BAZIE kwotą i walutą planu", async () => {
    await planCall({ couponCode: "partner-cee" });

    expect(rpcArgs("validate_b2b_coupon")).toEqual({
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
    rpcResponses.set("validate_b2b_coupon", ok([couponRefused(reason)]));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: reason });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("pusta odpowiedź bazy (cudzy najemca) daje `not_found`, a nie zamówienie bez rabatu", async () => {
    rpcResponses.set("validate_b2b_coupon", ok([]));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("odpowiedź `null` zamiast wierszy jest odmową, nie przepustką", async () => {
    // Awaria kształtu odpowiedzi RPC nie może się skończyć zamówieniem bez
    // rabatu ani sesją z kuponem, którego baza nie potwierdziła.
    rpcResponses.set("validate_b2b_coupon", ok(null));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("odmowa bez powodu schodzi na `not_found`", async () => {
    rpcResponses.set("validate_b2b_coupon", ok([{ ...couponRefused(""), error: null }]));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("BŁĄD walidacji kuponu jest zgłaszany", async () => {
    rpcResponses.set("validate_b2b_coupon", fail("function does not exist"));

    await expect(planCall({ couponCode: "PARTNER-CEE" })).rejects.toThrow(
      "function does not exist",
    );
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
      "validate_b2b_coupon",
      ok([couponOk({ discount_cents: 0, final_cents: 4900 })]),
    );

    await planCall({ couponCode: "PARTNER-CEE" });

    expect(stripeCall("coupons.create")).toBeUndefined();
    expect(rpcArgs("redeem_b2b_coupon")).toBeDefined();
  });

  it("odpowiedź operatora bez identyfikatora kuponu nie wywraca sesji", async () => {
    h.state.coupon = {};

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result.ok).toBe(true);
    expect(lastSession()?.discounts).toBeUndefined();
  });

  it("PRZEGRANY WYŚCIG o ostatnie użycie unieważnia założone zamówienie", async () => {
    rpcResponses.set("redeem_b2b_coupon", ok(false));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "limit_reached" });
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "canceled",
    });
    expect(stripeCall("checkout.sessions.create")).toBeUndefined();
  });

  it("BŁĄD rezerwacji jest traktowany jak przegrany wyścig", async () => {
    rpcResponses.set("redeem_b2b_coupon", fail("could not obtain lock"));

    const result = await planCall({ couponCode: "PARTNER-CEE" });

    expect(result).toEqual({ ok: false, error: "limit_reached" });
  });
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

    await planCall({ amountCents: 1, currency: "PLN" });

    expect(insertedOrder()?.amount_cents).toBe(29900);
    expect(insertedOrder()?.currency).toBe("EUR");
  });

  it("liczba miejsc z żądania jedzie do pozycji sesji", async () => {
    await planCall({ quantity: 5 });

    expect(lastSession()?.line_items[0]?.quantity).toBe(5);
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
    expect(stripeCall("createStripeClient")?.args[0]).toBe("live");
  });

  it("konto bez adresu w tokenie nie wywraca kasy - paragon zostaje pusty", async () => {
    // Adres pochodzi WYŁĄCZNIE z tokenu (żądanie go nie zawiera). Konto bez
    // potwierdzonego adresu ma dalej móc zapłacić - brak paragonu jest
    // mniejszym kosztem niż zablokowana płatność.
    const result = await callServerFn<SessionResult>(
      createPlanCheckoutSession,
      { priceId: "plus_monthly", planId: PLAN_ID, returnUrl: RETURN_URL },
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

    expect(rpcArgs("release_b2b_coupon")).toEqual({
      _coupon_id: COUPON_ID,
      _order_id: "order-1",
    });
    logged.mockRestore();
  });

  it("bez kuponu odmowa operatora nie woła zwolnienia", async () => {
    h.state.prices = [];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await planCall();

    expect(rpcCalls.map((c) => c.fn)).not.toContain("release_b2b_coupon");
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

describe("createPlanCheckoutSession - walidacja wejścia", () => {
  it("pusty identyfikator ceny jest odrzucany", async () => {
    await expect(planCall({ priceId: "" })).rejects.toThrow();
    expect(chain.chains).toHaveLength(0);
  });

  it("plan o złym kształcie identyfikatora nie dociera do bazy", async () => {
    await expect(planCall({ planId: "nie-uuid" })).rejects.toThrow();
    expect(chain.chains).toHaveLength(0);
  });

  it("adres powrotu musi być pełnym URL-em", async () => {
    await expect(planCall({ returnUrl: "/checkout/sukces" })).rejects.toThrow();
  });

  it("liczba miejsc spoza zakresu 1..100 jest odrzucana", async () => {
    await expect(planCall({ quantity: 0 })).rejects.toThrow();
    await expect(planCall({ quantity: 101 })).rejects.toThrow();
  });

  it("nieobsługiwany język ramki jest odrzucany", async () => {
    await expect(planCall({ locale: "de" })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DEFEKTY ZAREJESTROWANE (nie naprawiane w tej zmianie - zakres to testy).
// ---------------------------------------------------------------------------

describe("createPlanCheckoutSession - audyt kuponu (defekty zarejestrowane)", () => {
  it.fails(
    "DEFEKT: rezerwacja zapisuje rabat ZERO, więc analityka kuponów zawyża przychód",
    async () => {
      // CO JEST ZŁE
      // `redeem_b2b_coupon` dostaje z tego pliku `_applied_cents: 0`, mimo że
      // baza właśnie policzyła rabat (`validate_b2b_coupon.discount_cents`),
      // a sesja u operatora dostaje ten rabat co do grosza.
      //
      // DLACZEGO TO JEST RYZYKO
      // Semantyka kolumny jest ustalona jawnie w migracji
      // `20260725090200_fix_coupon_analytics_applied_cents_inversion.sql`:
      //   COMMENT ON COLUMN b2b_coupon_redemptions.applied_cents
      //     'RABAT zastosowany przy realizacji kuponu (...), nie kwota zaplacona.
      //      Niezmiennik: original_cents = applied_cents + zaplacone.'
      // Przy zerze niezmiennik pęka: `original_cents - applied_cents` (czyli
      // „przychód netto" w `b2b_coupons_analytics` i w `monetization_dashboard`)
      // wychodzi PEŁNA cena planu, a suma rabatów - zero. Każde zamówienie
      // złożone tym silnikiem jest więc niewidoczne w raporcie kosztu kuponów
      // i zawyża raportowany przychód dokładnie o udzielony rabat. Drugi silnik
      // (`checkout.functions.ts`) przekazuje w tym miejscu `couponDiscountCents`,
      // więc te same kupony liczą się różnie w zależności od tego, którym
      // przyciskiem klient wszedł do kasy.
      //
      // DLACZEGO NIE NAPRAWIAM
      // Zakres tej pracy to testy; zmiana wartości przekazywanej do RPC zmienia
      // dane księgowe (wiersze `b2b_coupon_redemptions` i pochodne raporty),
      // więc wymaga decyzji właściciela modułu i najpewniej korekty danych
      // historycznych. Test stoi jako `it.fails`: zzielenieje sam w dniu
      // poprawki i wtedy trzeba go przełączyć na zwykłe `it`.
      await planCall({ couponCode: "PARTNER-CEE" });

      expect(rpcArgs("redeem_b2b_coupon")).toMatchObject({
        _coupon_id: COUPON_ID,
        _original_cents: 4900,
        // ASERCJA DOCELOWA: rabat, a nie zero.
        _applied_cents: 1000,
      });
    },
  );

  it.fails(
    "DEFEKT: metadane zamówienia nie niosą audytu kuponu, więc historia płatności nie pokaże rabatu",
    async () => {
      // CO JEST ZŁE
      // Zamówienie z tego silnika dostaje w metadanych wyłącznie `coupon_code`.
      // Brakuje `coupon_id`, `coupon_discount_cents` i `original_amount_cents`,
      // które wkłada drugi silnik (`checkout.functions.ts`, linie 409-415).
      //
      // DLACZEGO TO JEST RYZYKO
      // `src/lib/billing/paymentHistory.ts` czyta rabat DOKŁADNIE z tych kluczy
      // (`meta["coupon_discount_cents"] ?? meta["discount_cents"]` oraz
      // `meta["original_amount_cents"]`). Klient, który kupił plan tym silnikiem
      // z kuponem partnerskim, widzi w swojej historii płatności cenę bez
      // śladu rabatu - a to jest dokument, którym tłumaczy sobie kwotę na
      // wyciągu z karty. Ta sama luka utrudnia ręczne dochodzenie przy
      // reklamacji, bo powiązanie zamówienia z konkretnym kuponem
      // (`coupon_id`) istnieje wyłącznie w tabeli realizacji.
      //
      // DLACZEGO NIE NAPRAWIAM
      // To zmiana kształtu danych zapisywanych do `payment_orders.metadata`,
      // czytanych przez historię płatności, panel administratora i webhook -
      // czyli decyzja produktowa o parytecie obu silników, a nie poprawka
      // testowa. Rejestruję ją tutaj, żeby nie zginęła.
      await planCall({ couponCode: "PARTNER-CEE" });

      expect(orderMetadata()).toMatchObject({
        coupon_code: "PARTNER-CEE",
        // ASERCJE DOCELOWE: pełny audyt kuponu, tak jak w drugim silniku.
        coupon_id: COUPON_ID,
        coupon_discount_cents: 1000,
        original_amount_cents: 4900,
      });
    },
  );

  it("kod kuponu (jedyne, co dziś trafia do metadanych) jest zapisany znormalizowany", async () => {
    // Stan FAKTYCZNY, utrwalony świadomie: dopóki defekt wyżej nie jest
    // naprawiony, ten test opisuje, co naprawdę wie zamówienie o kuponie.
    await planCall({ couponCode: "partner-cee" });

    expect(orderMetadata()).toEqual({ coupon_code: "PARTNER-CEE" });
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

  it("darowizna poniżej minimum operatora jest odrzucana", async () => {
    const result = await adhocCall({
      purpose: "donation",
      entityType: undefined,
      entityId: undefined,
      amountCents: 49,
    });

    expect(result).toEqual({ ok: false, error: "amount_too_low" });
  });

  it("darowizna powyżej minimum przechodzi z kwotą OD OFIARODAWCY", async () => {
    // Jedyny przypadek, w którym kwota legalnie pochodzi od klienta - i jedyny,
    // w którym nie ma z czego jej wyliczyć serwerowo.
    const result = await adhocCall({
      purpose: "donation",
      entityType: undefined,
      entityId: undefined,
      amountCents: 5000,
      currency: "EUR",
    });

    expect(result.ok).toBe(true);
    expect(lastSession()?.line_items[0]?.price_data).toMatchObject({
      currency: "eur",
      unit_amount: 5000,
    });
  });

  it("adres powrotu jest przepisywany na własny origin także tutaj", async () => {
    await adhocCall({ returnUrl: "https://zlodziej.example.com/przejmij" });

    expect(lastSession()?.return_url).toBe("https://kasa.example.org/przejmij");
  });

  it("środowisko z żądania wybiera klienta operatora", async () => {
    await adhocCall({ environment: "live" });

    expect(stripeCall("createStripeClient")?.args[0]).toBe("live");
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

  it("waluta spoza listy jest odrzucana", async () => {
    await expect(adhocCall({ currency: "USD" })).rejects.toThrow();
  });

  it("ujemna kwota darowizny jest odrzucana przez walidator", async () => {
    await expect(
      adhocCall({
        purpose: "donation",
        entityType: undefined,
        entityId: undefined,
        amountCents: -100,
      }),
    ).rejects.toThrow();
  });
});
