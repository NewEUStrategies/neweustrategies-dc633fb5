// KUPON B2B W KASIE: rabat liczy BAZA, a handler ma go tylko przenieść -
// i odmówić, kiedy baza odmawia.
//
// DLACZEGO TO JEST PLIK O PIENIĄDZACH. Kupon jest jedynym miejscem, w którym
// kwota zamówienia legalnie SPADA. Gdyby handler przyjmował od klienta rabat
// (albo tolerował odpowiedź bazy, której nie zrozumiał), kod kuponu stałby się
// darmowym tokenem premium: `validate_b2b_coupon` odmawia z konkretnym
// powodem - wyczerpany, po terminie, nieaktywny, w innej walucie, cudzego
// najemcy - a każdy z tych powodów MUSI zatrzymać zamówienie, nie tylko
// zmienić komunikat w interfejsie.
//
// DRUGA POŁOWA TEGO PLIKU TO REZERWACJA UŻYCIA. Rabat jest przyznawany PRZED
// utworzeniem sesji u operatora, więc limit użyć musi być zajmowany atomowo
// (`redeem_b2b_coupon` pod blokadą wiersza), a przegrany wyścig musi unieważnić
// zamówienie. Bez tego dwa równoległe zamówienia zjadają jedno użycie dwa razy.
//
// TRZECIA CZĘŚĆ: WALUTA PREZENTACJI. Konwersja idzie PO kuponie (kupony są
// definiowane per waluta) i konwertuje oryginał oraz finał RAZEM, żeby audyt
// `oryginał = finał + rabat` trzymał się co do grosza. Kurs pochodzi z NBP -
// jedyne wyjście na zewnątrz, więc tu jest zaślepione na poziomie `fetch`.
//
// GRANICE ATRAPOWANE: klient Supabase, rola serwisowa, żądanie frameworka,
// `fetch` do NBP. Sąsiedzi z `@/lib/billing/**` (konwersja waluty, kurs,
// znacznik sesji) jadą PRAWDZIWI.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database, Tables } from "@/integrations/supabase/types";
import {
  fail,
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";

const PLAN_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const ENTITY_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const COUPON_ID = "cccccccc-0000-4000-8000-00000000000c";

const admin = vi.hoisted(() => ({
  rpcCalls: [] as { fn: string; args: unknown }[],
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);

vi.mock("@tanstack/react-start/server", () => ({
  // `origin` i `host` są nagłówkami zabronionymi dla `Request`, więc origin
  // podajemy tak, jak robi to odwrotne proxy w produkcji.
  getRequest: () =>
    new Request("https://kasa.example.org/checkout", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "kasa.example.org" },
    }),
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (fn: string, args: unknown) => {
      admin.rpcCalls.push({ fn, args });
      return Promise.resolve({ data: true, error: null });
    },
  },
}));

const { callServerFn } = await import("@/test/serverFn");
const { createCheckoutOrder } = await import("@/lib/billing/checkout.functions");

// --- kształty z wygenerowanych typów ---------------------------------------

/** Wiersz odpowiedzi `validate_b2b_coupon` - kontrakt bazy, nie zmyślony. */
type CouponVerdict = Database["public"]["Functions"]["validate_b2b_coupon"]["Returns"][number];

type PlanQuote = Pick<
  Tables<"access_plans">,
  | "price_cents"
  | "currency"
  | "name_pl"
  | "name_en"
  | "active"
  | "interval"
  | "trial_days"
  | "tier_key"
  | "volume_threshold_seats"
  | "volume_price_cents"
>;

type OrderInsert = Database["public"]["Tables"]["payment_orders"]["Insert"];

type CheckoutResult =
  | { ok: true; mode: "mock"; url: string; orderId: string }
  | { ok: false; mode: string; error: string };

function planQuote(over: Partial<PlanQuote> = {}): PlanQuote {
  return {
    price_cents: 4900,
    currency: "PLN",
    name_pl: "Członek",
    name_en: "Member",
    active: true,
    interval: "month",
    trial_days: 0,
    tier_key: "member",
    volume_threshold_seats: null,
    volume_price_cents: null,
    ...over,
  };
}

/** Werdykt POZYTYWNY: rabat 10 zł od ceny 49 zł. */
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

/** Werdykt ODMOWNY z powodem, który wystawia baza. */
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

function call(payload: Record<string, unknown>): Promise<CheckoutResult> {
  return callServerFn<CheckoutResult>(createCheckoutOrder, payload, context());
}

function planPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "subscription",
    plan_id: PLAN_ID,
    success_path: "/checkout/sukces",
    cancel_path: "/cennik",
    environment: "sandbox",
    coupon_code: "partner-cee",
    ...over,
  };
}

beforeEach(() => {
  admin.rpcCalls.length = 0;
  chain = supabaseFromStub();
  rpcCalls = [];
  rpcResponses = new Map<string, SupabaseResult>();

  vi.stubEnv("LOVABLE_API_KEY", "");
  vi.stubEnv("STRIPE_SANDBOX_API_KEY", "");
  vi.stubEnv("STRIPE_LIVE_API_KEY", "");
  vi.stubEnv("BILLING_ALLOW_MOCK", "");

  // Kurs NBP jest JEDYNYM wyjściem na zewnątrz w tej ścieżce - zaślepiamy je na
  // poziomie `fetch`, żeby `fxRate.ts` (i cała konwersja) jechał prawdziwy.
  vi.stubGlobal("fetch", () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ rates: [{ mid: 4, effectiveDate: "2026-08-28" }] }),
    }),
  );

  chain.setResponse("access_plans", ok(planQuote()));
  chain.setResponse("payment_orders", ok({ id: "order-1", tenant_id: "tenant-alfa" }));
  chain.setResponse(
    "content_access_public",
    ok({ mode: "paid", one_time_price_cents: 1500, one_time_currency: "PLN" }),
  );
  chain.setResponse("posts", ok({ title_pl: "Analiza CEE", title_en: "CEE analysis" }));
  rpcResponses.set("validate_b2b_coupon", ok([couponOk()]));
  rpcResponses.set("redeem_b2b_coupon", ok(true));
  rpcResponses.set("payment_order_mark_session", ok(true));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("createCheckoutOrder - kupon ważny", () => {
  it("kwota końcowa pochodzi z werdyktu bazy, a nie z kodu kuponu podanego przez klienta", async () => {
    await call(planPayload());

    expect(insertedOrder()?.amount_cents).toBe(3900);
  });

  it("kod kuponu jest NORMALIZOWANY do wielkich liter przed walidacją", async () => {
    // Baza porównuje kod dokładnie; gdyby normalizacja siedziała tylko
    // w interfejsie, ten sam kupon działałby lub nie w zależności od tego,
    // skąd przyszło żądanie.
    await call(planPayload({ coupon_code: "partner-cee" }));

    expect(rpcArgs("validate_b2b_coupon")?._code).toBe("PARTNER-CEE");
    expect(orderMetadata().coupon_code).toBe("PARTNER-CEE");
  });

  it("walidacja idzie w ORYGINALNEJ walucie i kwocie planu", async () => {
    await call(planPayload());

    expect(rpcArgs("validate_b2b_coupon")).toMatchObject({
      _amount_cents: 4900,
      _currency: "PLN",
      _plan_id: PLAN_ID,
    });
  });

  it("kupon przy zamówieniu bez planu jedzie do bazy z pustym identyfikatorem planu", async () => {
    // Odblokowanie pojedynczej treści nie ma planu; baza dostaje zerowy UUID,
    // a nie `null`, bo argument RPC jest wymagany. Gdyby handler wysłał tu
    // identyfikator z poprzedniego kroku, kupon „tylko dla planu X" dałby się
    // użyć na zakupie, do którego nie był przeznaczony.
    rpcResponses.set("validate_b2b_coupon", ok([couponRefused("plan_not_eligible")]));

    await call({
      kind: "one_time",
      entity_type: "post",
      entity_id: ENTITY_ID,
      success_path: "/analizy/tekst",
      cancel_path: "/analizy/tekst",
      coupon_code: "PARTNER",
    });

    expect(rpcArgs("validate_b2b_coupon")?._plan_id).toBe("00000000-0000-0000-0000-000000000000");
    expect(rpcArgs("validate_b2b_coupon")?._amount_cents).toBe(1500);
  });

  it("audyt kuponu ląduje w metadanych zamówienia - webhook liczy z niego przychód netto", async () => {
    await call(planPayload());

    expect(orderMetadata()).toMatchObject({
      coupon_code: "PARTNER-CEE",
      coupon_id: COUPON_ID,
      coupon_discount_cents: 1000,
      original_amount_cents: 4900,
    });
  });

  it("użycie kuponu jest REZERWOWANE atomowo na tym zamówieniu", async () => {
    await call(planPayload());

    expect(rpcArgs("redeem_b2b_coupon")).toEqual({
      _coupon_id: COUPON_ID,
      _order_id: "order-1",
      _applied_cents: 1000,
      _original_cents: 4900,
      _currency: "PLN",
    });
  });

  it("bez kodu kuponu nie ma ani walidacji, ani rezerwacji, ani metadanych", async () => {
    await call(planPayload({ coupon_code: undefined }));

    expect(rpcCalls.map((c) => c.fn)).not.toContain("validate_b2b_coupon");
    expect(rpcCalls.map((c) => c.fn)).not.toContain("redeem_b2b_coupon");
    expect(orderMetadata()).not.toHaveProperty("coupon_code");
  });

  it("kod z samych spacji jest traktowany jak brak kodu, a nie jak kupon `nie znaleziono`", async () => {
    // Walidator przycina wartość; pusty wynik NIE MOŻE pójść do bazy, bo
    // odmowa „not_found" wywróciłaby zamówienie, którego nikt nie kuponował.
    await call(planPayload({ coupon_code: "   " }));

    expect(rpcCalls.map((c) => c.fn)).not.toContain("validate_b2b_coupon");
    expect(insertedOrder()?.amount_cents).toBe(4900);
  });
});

describe("createCheckoutOrder - odmowy kuponu (powód pochodzi z bazy)", () => {
  it.each([
    ["wyczerpany limit użyć", "max_redemptions_reached"],
    ["po terminie ważności", "expired"],
    ["jeszcze nieaktywny", "not_started"],
    ["wyłączony przez administratora", "inactive"],
    ["w innej walucie niż zamówienie", "currency_mismatch"],
    ["nie dla tego planu", "plan_not_eligible"],
    ["nieznany albo cudzego najemcy", "not_found"],
  ])("kupon %s: zamówienie NIE powstaje, powód wraca bez tłumaczenia", async (_opis, reason) => {
    rpcResponses.set("validate_b2b_coupon", ok([couponRefused(reason)]));

    const result = await call(planPayload());

    expect(result).toEqual({ ok: false, mode: "coupon", error: reason });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(rpcCalls.map((c) => c.fn)).not.toContain("redeem_b2b_coupon");
  });

  it("cudzy najemca: RLS bazy nie oddaje ŻADNEGO wiersza, a to też jest odmowa", async () => {
    // Kupon innego najemcy nie jest „odmówiony" - on po prostu nie istnieje
    // z punktu widzenia wołającego. Pusta odpowiedź MUSI dawać odmowę, nie
    // zamówienie bez rabatu (klient zapłaciłby pełną cenę mimo obietnicy)
    // ani zamówienie z rabatem zerowym przypisanym do cudzego kuponu.
    rpcResponses.set("validate_b2b_coupon", ok([]));

    const result = await call(planPayload());

    expect(result).toEqual({ ok: false, mode: "coupon", error: "not_found" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("odpowiedź `null` z bazy również jest odmową, nie przepustką", async () => {
    rpcResponses.set("validate_b2b_coupon", ok(null));

    const result = await call(planPayload());

    expect(result).toEqual({ ok: false, mode: "coupon", error: "not_found" });
  });

  it("odmowa BEZ powodu schodzi na `not_found`, a nie na pusty komunikat", async () => {
    rpcResponses.set("validate_b2b_coupon", ok([{ ...couponRefused(""), error: null }]));

    const result = await call(planPayload());

    expect(result).toEqual({ ok: false, mode: "coupon", error: "not_found" });
  });

  it("BŁĄD walidacji kuponu jest zgłaszany, a nie zamieniany na „kupon nieważny”", async () => {
    // Różnica jest praktyczna: nieważny kupon to komunikat dla klienta,
    // a awaria bazy to incydent - zamiana jednego w drugie ukrywa awarię.
    rpcResponses.set("validate_b2b_coupon", fail("function validate_b2b_coupon does not exist"));

    await expect(call(planPayload())).rejects.toThrow("validate_b2b_coupon");
  });

  it("rabat schodzący poniżej minimum operatora jest odrzucany", async () => {
    // Rabat 100% dawałby zamówienie na zero, którego dostawca i tak nie
    // przyjmie - a które w trybie mock nadałoby dostęp za darmo.
    rpcResponses.set(
      "validate_b2b_coupon",
      ok([couponOk({ discount_cents: 4900, final_cents: 0 })]),
    );

    const result = await call(planPayload());

    expect(result).toEqual({ ok: false, mode: "coupon", error: "final_amount_too_low" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("kwota końcowa 49 groszy również nie przechodzi", async () => {
    rpcResponses.set(
      "validate_b2b_coupon",
      ok([couponOk({ discount_cents: 4851, final_cents: 49 })]),
    );

    const result = await call(planPayload());

    expect(result).toEqual({ ok: false, mode: "coupon", error: "final_amount_too_low" });
  });

  it("kwota końcowa równa minimum przechodzi - granica jest po stronie dozwolonej", async () => {
    rpcResponses.set(
      "validate_b2b_coupon",
      ok([couponOk({ discount_cents: 4850, final_cents: 50 })]),
    );

    const result = await call(planPayload());

    expect(result.ok).toBe(true);
    expect(insertedOrder()?.amount_cents).toBe(50);
  });
});

describe("createCheckoutOrder - przegrany wyścig o ostatnie użycie kuponu", () => {
  it("odmowa rezerwacji UNIEWAŻNIA założone zamówienie zamiast zostawić je wiszące", async () => {
    // Zamówienie powstaje PRZED rezerwacją, więc przegrany wyścig zostawiłby
    // wiersz `pending` bez sesji - dokładnie ten stan, który panel admina
    // raportuje jako „zamówienie wiszące".
    rpcResponses.set("redeem_b2b_coupon", ok(false));

    const result = await call(planPayload());

    expect(result).toEqual({ ok: false, mode: "coupon", error: "limit_reached" });
    expect(rpcArgs("payment_order_mark_session")).toEqual({
      _order_id: "order-1",
      _status: "canceled",
    });
  });

  it("BŁĄD rezerwacji jest traktowany jak przegrany wyścig, a nie jak sukces", async () => {
    rpcResponses.set("redeem_b2b_coupon", fail("could not obtain lock on row"));

    const result = await call(planPayload());

    expect(result).toEqual({ ok: false, mode: "coupon", error: "limit_reached" });
    expect(rpcCalls.map((c) => c.fn)).toContain("payment_order_mark_session");
  });

  it("gdy nawet unieważnienie przez RPC zawiedzie, domyka je rola serwisowa", async () => {
    // `markOrderSession` ma świadomy zapas: bez niego zamówienie zostaje
    // `pending` mimo odmowy kuponu i wygląda na czekające na płatność.
    rpcResponses.set("redeem_b2b_coupon", ok(false));
    rpcResponses.set("payment_order_mark_session", fail("schema cache stale"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await call(planPayload());

    expect(result).toEqual({ ok: false, mode: "coupon", error: "limit_reached" });
    logged.mockRestore();
  });
});

describe("createCheckoutOrder - waluta prezentacji", () => {
  /**
   * Konwersja dotyczy zamówień z kwotą wyliczoną SERWEROWO. Zakup jednorazowy
   * planu jest takim zamówieniem; subskrypcja NIE JEST (jej walutę rozstrzyga
   * cennik operatora) i ma osobny przypadek na końcu bloku.
   */
  function oneTimePlanPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
    return planPayload({ kind: "one_time", ...over });
  }

  it("wersja angielska rozlicza w euro po kursie NBP, licząc oryginał i finał RAZEM", async () => {
    // Niezmiennik audytu: oryginał = finał + rabat, DOKŁADNIE w walucie
    // docelowej. Konwersja każdej kwoty osobno rozjeżdża go o grosz przy
    // zaokrągleniu, a to grosz w księgach.
    const result = await call(oneTimePlanPayload({ display_currency: "EUR" }));

    expect(result.ok).toBe(true);
    const order = insertedOrder();
    expect(order?.currency).toBe("EUR");
    expect(order?.amount_cents).toBe(975);
    expect(orderMetadata().original_amount_cents).toBe(1225);
    expect(orderMetadata().coupon_discount_cents).toBe(250);
    expect(Number(orderMetadata().original_amount_cents)).toBe(
      Number(order?.amount_cents) + Number(orderMetadata().coupon_discount_cents),
    );
  });

  it("audyt użycia kuponu jest zapisywany w TEJ SAMEJ walucie co zamówienie", async () => {
    await call(oneTimePlanPayload({ display_currency: "EUR" }));

    expect(rpcArgs("redeem_b2b_coupon")).toMatchObject({
      _applied_cents: 250,
      _original_cents: 1225,
      _currency: "EUR",
    });
  });

  it("waluta zgodna z ceną planu nie zmienia kwoty", async () => {
    const result = await call(oneTimePlanPayload({ display_currency: "PLN" }));

    expect(result.ok).toBe(true);
    expect(insertedOrder()?.currency).toBe("PLN");
    expect(insertedOrder()?.amount_cents).toBe(3900);
  });

  it("bez wskazania waluty prezentacji zamówienie zostaje w walucie planu", async () => {
    await call(oneTimePlanPayload());

    expect(insertedOrder()?.currency).toBe("PLN");
    expect(insertedOrder()?.amount_cents).toBe(3900);
  });

  it("kupon jest walidowany PRZED konwersją - kupony są definiowane per waluta", async () => {
    await call(oneTimePlanPayload({ display_currency: "EUR" }));

    expect(rpcArgs("validate_b2b_coupon")).toMatchObject({
      _amount_cents: 4900,
      _currency: "PLN",
    });
  });

  it("SUBSKRYPCJA nie jest przeliczana lokalnie - walutę rozstrzyga cennik operatora", async () => {
    // Subskrypcja powstaje z ceny katalogowej u operatora (`unit_price_overrides`
    // + lokalizacja). Lokalna konwersja rozjechałaby zamówienie z faktyczną
    // kwotą obciążenia - klient zobaczyłby na fakturze inną liczbę niż w kasie.
    const result = await call(planPayload({ display_currency: "EUR" }));

    expect(result.ok).toBe(true);
    expect(insertedOrder()?.currency).toBe("PLN");
    expect(insertedOrder()?.amount_cents).toBe(3900);
  });

  it("awaria kursu NBP nie wywraca kasy - konwersja idzie po ostatniej znanej kotwicy", async () => {
    // Kierunek degradacji jest tu jedyny dopuszczalny: brak kursu nie może
    // zablokować płatności, ale też nie może dać kwoty przypadkowej - stąd
    // kotwica zamiast zera.
    // `setEurPlnRateForTests` unieważnia świeżość cache, więc handler NAPRAWDĘ
    // idzie po kurs (i naprawdę dostaje po nosie) zamiast odczytać wynik
    // wcześniejszego przypadku z tego pliku.
    const { setEurPlnRateForTests } = await import("@/lib/billing/fxRate");
    setEurPlnRateForTests(4);
    vi.stubGlobal("fetch", () => Promise.reject(new Error("NBP unreachable")));
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpcResponses.set(
      "validate_b2b_coupon",
      ok([couponOk({ discount_cents: 0, final_cents: 4900 })]),
    );

    const result = await call(oneTimePlanPayload({ display_currency: "EUR" }));

    expect(result.ok).toBe(true);
    expect(insertedOrder()?.currency).toBe("EUR");
    // Ostatnia znana kotwica (1 EUR = 4 PLN), a nie zero i nie kwota w PLN.
    expect(insertedOrder()?.amount_cents).toBe(1225);
    expect(warned).toHaveBeenCalled();
    warned.mockRestore();
  }, 20_000);
});
