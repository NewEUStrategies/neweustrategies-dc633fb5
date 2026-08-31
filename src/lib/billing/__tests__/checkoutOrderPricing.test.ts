// KTO USTALA KWOTĘ. `createCheckoutOrder` jest jedynym miejscem, w którym
// powstaje zamówienie płatnicze - i jedynym, w którym da się pomylić autorytet
// ceny. Klient przysyła WYŁĄCZNIE wskazania (plan, wydarzenie, encja, liczba
// miejsc); kwota, waluta i etykieta muszą pochodzić z bazy. Ten plik pilnuje
// tego rozdziału po stronie ODMOWY: każdy `throw` w handlerze jest tu
// przypadkiem testowym, bo każdy z nich broni innej dziury w kasie.
//
// DLACZEGO ODMOWA, A NIE PRZEJŚCIE. Test „szczęśliwej ścieżki" pokazuje, że
// zamówienie da się złożyć. Nie mówi nic o tym, czy da się złożyć zamówienie,
// którego złożyć NIE WOLNO - a to jest cała wartość tej warstwy: plan
// nieaktywny, wydarzenie po terminie, wyprzedane miejsca, treść bez ceny,
// bilet pokryty pulą planu. Zieleń tych ścieżek to jedyny dowód, że kasa nie
// wypuszcza zamówień, których webhook potem nie ma jak cofnąć.
//
// CO ATRAPUJEMY, A CZEGO NIE. Wyłącznie GRANICE: klient Supabase (atrapa
// łańcucha PostgREST + RPC), rolę serwisową i kontekst żądania frameworka.
// Sąsiedzi z `@/lib/billing/**` i `@/lib/events/**` (katalog cen, pula biletów
// planu, kontrola miejsc, znacznik sesji) jadą PRAWDZIWI - inaczej test
// dowodziłby zgodności handlera z atrapą tego, co sam woła, a nie z regułą.
//
// TRYB DOSTAWCY. Ten plik trzyma bramkę płatności NIESKONFIGUROWANĄ (brak
// kluczy w środowisku), więc handler kończy się tuż po wstawieniu zamówienia.
// Ścieżka sesji operatora ma własny plik (`checkoutStripeSession.test.ts`).
//
// CZEGO TEN PLIK NIE DOWODZI: autoryzacji. Harness server fn nie uruchamia
// middleware - zestawu `requireSupabaseAuth` pilnuje bramka
// `check:authz-snapshot`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database, Tables } from "@/integrations/supabase/types";
import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";

const PLAN_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const EVENT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const TICKET_ID = "cccccccc-0000-4000-8000-000000000003";
const OTHER_EVENT_ID = "dddddddd-0000-4000-8000-000000000004";
const POST_ID = "eeeeeeee-0000-4000-8000-000000000005";
const PAGE_ID = "ffffffff-0000-4000-8000-000000000006";

/** Rola serwisowa jest granicą - handler dotyka jej tylko awaryjnie. */
const admin = vi.hoisted(() => ({
  rpcCalls: [] as { fn: string; args: unknown }[],
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);

// `resolveReturnUrl` czyta origin z żądania. Poza runtime'em frameworka nie ma
// żądania, więc podstawiamy je - sama funkcja zostaje PRAWDZIWA.
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

// --- kształty wierszy z wygenerowanych typów -------------------------------

/** Kolumny planu, które handler naprawdę czyta (`select` w kodzie). */
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

type EventQuote = Pick<
  Tables<"events">,
  "id" | "title_pl" | "title_en" | "ticket_price_cents" | "ticket_currency" | "status" | "starts_at"
>;

type AccessRule = Pick<
  Tables<"content_access_public">,
  "mode" | "one_time_price_cents" | "one_time_currency"
>;

/** Wiersz wstawiany do `payment_orders` - odczytujemy go z zapisanego łańcucha. */
type OrderInsert = Database["public"]["Tables"]["payment_orders"]["Insert"];

/** Kształt odpowiedzi handlera, na której zależy asercjom tego pliku. */
type CheckoutResult =
  | { ok: true; mode: "mock"; url: string; orderId: string }
  | { ok: true; mode: "stripe"; clientSecret: string; orderId: string }
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

function eventQuote(over: Partial<EventQuote> = {}): EventQuote {
  return {
    id: EVENT_ID,
    title_pl: "Kongres CEE",
    title_en: "CEE Congress",
    ticket_price_cents: 15000,
    ticket_currency: "PLN",
    status: "published",
    starts_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    ...over,
  };
}

function accessRule(over: Partial<AccessRule> = {}): AccessRule {
  return { mode: "paid", one_time_price_cents: 1500, one_time_currency: "PLN", ...over };
}

/** Odpowiedź `event_ticket_checkout_quote` (RPC oddaje `Json`). */
function ticketQuote(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticket_type_id: TICKET_ID,
    event_id: EVENT_ID,
    amount_cents: 15000,
    list_price_cents: 15000,
    currency: "PLN",
    name_pl: "Bilet",
    name_en: "Ticket",
    event_title_pl: "Kongres CEE",
    event_title_en: "CEE Congress",
    phase: null,
    ...over,
  };
}

// --- atrapa klienta Supabase ------------------------------------------------

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
  return {
    supabase: client(),
    userId: "user-kupujacy",
    claims: { email: "kupujacy@example.org" },
  };
}

/** Wiersz zamówienia przekazany do `insert` - bez zgadywania kolejności ogniw. */
function insertedOrder(): OrderInsert | undefined {
  const insert = chain.lastChain("payment_orders")?.argsOf("insert");
  const row = insert?.[0];
  return row !== null && typeof row === "object" ? (row as OrderInsert) : undefined;
}

function orderMetadata(): Record<string, unknown> {
  const metadata = insertedOrder()?.metadata;
  return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function call(payload: Record<string, unknown>): Promise<CheckoutResult> {
  return callServerFn<CheckoutResult>(createCheckoutOrder, payload, context());
}

/** Wskazanie planu - kwoty w ładunku NIE MA i nie może być. */
function planPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "subscription",
    plan_id: PLAN_ID,
    success_path: "/checkout/sukces",
    cancel_path: "/cennik",
    environment: "sandbox",
    ...over,
  };
}

function ticketPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "one_time",
    event_id: EVENT_ID,
    success_path: "/events/kongres-cee",
    cancel_path: "/events/kongres-cee",
    environment: "sandbox",
    ...over,
  };
}

function entityPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "one_time",
    entity_type: "post",
    entity_id: POST_ID,
    success_path: "/analizy/tekst",
    cancel_path: "/analizy/tekst",
    environment: "sandbox",
    ...over,
  };
}

beforeEach(() => {
  admin.rpcCalls.length = 0;
  chain = supabaseFromStub();
  rpcCalls = [];
  rpcResponses = new Map<string, SupabaseResult>();

  // Bramka płatności NIESKONFIGUROWANA - handler kończy w trybie mock.
  vi.stubEnv("LOVABLE_API_KEY", "");
  vi.stubEnv("STRIPE_SANDBOX_API_KEY", "");
  vi.stubEnv("STRIPE_LIVE_API_KEY", "");
  vi.stubEnv("BILLING_ALLOW_MOCK", "");

  chain.setResponse("access_plans", ok(planQuote()));
  chain.setResponse("payment_orders", ok({ id: "order-1", tenant_id: "tenant-alfa" }));
  chain.setResponse("content_access_public", ok(accessRule()));
  chain.setResponse("posts", ok({ title_pl: "Analiza CEE", title_en: "CEE analysis" }));
  chain.setResponse("pages", ok({ title_pl: "Strona", title_en: "Page" }));
  chain.setResponse("event_rsvps", ok(null));
  chain.setResponse("events", (query: RecordedChain) =>
    // `assertSeatAvailable` pyta o samą pojemność - to inny odczyt tej tabeli.
    query.argsOf("select")?.[0] === "capacity" ? ok({ capacity: null }) : ok(eventQuote()),
  );
  // Pusta pula planu = pełna cena biletu (kierunek degradacji, patrz
  // `ticketAllowance.server.ts`).
  rpcResponses.set("my_ticket_allowance", ok(null));
  rpcResponses.set("get_event_rsvp_counts", ok([{ event_id: EVENT_ID, going: 0, waitlist: 0 }]));
  rpcResponses.set("event_ticket_checkout_quote", ok(ticketQuote()));
  rpcResponses.set("payment_order_mark_session", ok(true));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createCheckoutOrder - kwotę ustala serwer, nie kupujący", () => {
  it("kwota narzucona w ładunku jest ODRZUCONA - do zamówienia idzie cena planu", async () => {
    // Realne ryzyko: gdyby walidator przepuszczał pola kwotowe, wystarczyłoby
    // dopisać `amount_cents` do żądania, żeby kupić plan za grosz. Zamówienie
    // MUSI dostać cenę z `access_plans`, a nie z ładunku.
    chain.setResponse("access_plans", ok(planQuote({ price_cents: 4900 })));

    await call(planPayload({ amount_cents: 1, currency: "EUR", price_cents: 1 }));

    const order = insertedOrder();
    expect(order?.amount_cents).toBe(4900);
    expect(order?.currency).toBe("PLN");
  });

  it("kwota narzucona przy odblokowaniu treści też nie przechodzi", async () => {
    chain.setResponse("content_access_public", ok(accessRule({ one_time_price_cents: 1500 })));

    await call(entityPayload({ amount_cents: 1 }));

    expect(insertedOrder()?.amount_cents).toBe(1500);
  });

  it("kwota narzucona przy bilecie z wiersza wydarzenia też nie przechodzi", async () => {
    await call(ticketPayload({ amount_cents: 1 }));

    expect(insertedOrder()?.amount_cents).toBe(15000);
  });
});

describe("createCheckoutOrder - odmowy na ścieżce planu", () => {
  it("subskrypcja bez wskazanego planu jest odmawiana przed jakimkolwiek odczytem", async () => {
    await expect(call(planPayload({ plan_id: null }))).rejects.toThrow("plan_id_required");
    expect(chain.chains).toHaveLength(0);
  });

  it("plan nieistniejący: baza oddaje pustkę, zamówienie NIE powstaje", async () => {
    chain.setResponse("access_plans", ok(null));

    await expect(call(planPayload())).rejects.toThrow("plan_not_found");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("plan NIEAKTYWNY nie jest do kupienia, choć wiersz istnieje", async () => {
    // Wycofanie planu ze sprzedaży jest decyzją redakcji; gdyby `active`
    // pilnował wyłącznie interfejs, stary link do kasy sprzedawałby dalej.
    chain.setResponse("access_plans", ok(planQuote({ active: false })));

    await expect(call(planPayload())).rejects.toThrow("plan_not_found");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("plan INNEGO NAJEMCY jest dla wołającego niewidoczny - handler odmawia zamiast zgadywać", async () => {
    // Izolację najemcy trzyma RLS: zapytanie idzie klientem użytkownika, więc
    // cudzy plan wraca jako brak wiersza. Ten test pilnuje, żeby handler nie
    // dorobił sobie obejścia (np. odczytu rolą serwisową) i nie potraktował
    // pustki jako „plan darmowy".
    chain.setResponse("access_plans", ok(null));

    await expect(call(planPayload())).rejects.toThrow("plan_not_found");
    expect(chain.lastChain("access_plans")?.argsOf("eq")).toEqual(["id", PLAN_ID]);
    expect(admin.rpcCalls).toHaveLength(0);
  });

  it("BŁĄD ODCZYTU planu jest zgłaszany, a nie zamieniany na brak planu", async () => {
    chain.setResponse("access_plans", fail("permission denied for table access_plans"));

    await expect(call(planPayload())).rejects.toThrow("permission denied");
  });

  it("plan bez odpowiednika w katalogu cen operatora nie zakłada subskrypcji", async () => {
    // Subskrypcja MUSI powstać z ceny katalogowej - inaczej u operatora nie ma
    // cyklu rozliczeniowego ani zdarzeń odnowienia, a klient płaci raz i
    // dostaje dostęp „na zawsze".
    chain.setResponse("access_plans", ok(planQuote({ tier_key: "warstwa-spoza-katalogu" })));

    await expect(call(planPayload())).rejects.toThrow("plan_price_missing");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("plan bez `tier_key` również nie ma ceny katalogowej", async () => {
    chain.setResponse("access_plans", ok(planQuote({ tier_key: null })));

    await expect(call(planPayload())).rejects.toThrow("plan_price_missing");
  });

  it("plan za zero złotych nie zakłada zamówienia (`zero_amount`)", async () => {
    // Darmowy plan nie jest przedmiotem kasy - zamówienie na 0 zł przeszłoby
    // przez webhook jako opłacone i nadało uprawnienie bez płatności.
    chain.setResponse("access_plans", ok(planQuote({ price_cents: 0 })));

    await expect(call(planPayload({ kind: "one_time" }))).rejects.toThrow("zero_amount");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("BŁĄD ZAPISU zamówienia jest zgłaszany - nie ma cichego „udało się”", async () => {
    chain.setResponse("payment_orders", fail("duplicate key value violates unique constraint"));

    await expect(call(planPayload())).rejects.toThrow("duplicate key");
  });
});

describe("createCheckoutOrder - wycena planu", () => {
  it("subskrypcja bierze cenę, walutę i nazwę z wiersza planu", async () => {
    await call(planPayload());

    const order = insertedOrder();
    expect(order?.amount_cents).toBe(4900);
    expect(order?.currency).toBe("PLN");
    expect(order?.plan_id).toBe(PLAN_ID);
    expect(orderMetadata().label).toBe("Członek");
  });

  it("pusta nazwa polska schodzi na angielską - etykieta nigdy nie jest pusta bez powodu", async () => {
    chain.setResponse("access_plans", ok(planQuote({ name_pl: "", name_en: "Member" })));

    await call(planPayload());

    expect(orderMetadata().label).toBe("Member");
  });

  it("plan rozliczany ZA MIEJSCE mnoży cenę przez liczbę miejsc z żądania", async () => {
    chain.setResponse(
      "access_plans",
      ok(planQuote({ tier_key: "team", price_cents: 9900, name_pl: "Zespół" })),
    );

    await call(planPayload({ seats: 4 }));

    expect(insertedOrder()?.amount_cents).toBe(39600);
  });

  it("liczba miejsc jest DOCINANA do setki - żądanie nie ustala skali zamówienia", async () => {
    // Walidator dopuszcza 1..100; docięcie w handlerze jest drugim zamkiem,
    // gdyby kiedyś schemat się rozjechał z regułą operatora.
    chain.setResponse(
      "access_plans",
      ok(planQuote({ tier_key: "team", price_cents: 100, name_pl: "Zespół" })),
    );

    await call(planPayload({ seats: 100 }));

    expect(insertedOrder()?.amount_cents).toBe(10000);
  });

  it("plan ZA MIEJSCE bez podanej liczby miejsc liczy jedno miejsce", async () => {
    chain.setResponse(
      "access_plans",
      ok(planQuote({ tier_key: "team", price_cents: 9900, name_pl: "Zespół" })),
    );

    await call(planPayload());

    expect(insertedOrder()?.amount_cents).toBe(9900);
  });

  it("próg wolumenowy przecenia WSZYSTKIE miejsca, nie tylko nadwyżkę", async () => {
    // Cennik operatora jest schodkowy (`tiers_mode: volume`). Gdyby
    // podsumowanie liczyło inaczej, klient zobaczyłby w kasie inną kwotę niż
    // na fakturze - i to jest spór, nie usterka.
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

    await call(planPayload({ seats: 11 }));

    expect(insertedOrder()?.amount_cents).toBe(86900);
  });

  it("poniżej progu wolumenowego obowiązuje stawka podstawowa", async () => {
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

    await call(planPayload({ seats: 10 }));

    expect(insertedOrder()?.amount_cents).toBe(99000);
  });

  it("próg mniejszy niż dwa miejsca jest ignorowany - to konfiguracja bez sensu", async () => {
    chain.setResponse(
      "access_plans",
      ok(
        planQuote({
          tier_key: "team",
          price_cents: 9900,
          volume_threshold_seats: 1,
          volume_price_cents: 100,
        }),
      ),
    );

    await call(planPayload({ seats: 5 }));

    expect(insertedOrder()?.amount_cents).toBe(49500);
  });

  it("plan NIE rozliczany za miejsce ignoruje liczbę miejsc z żądania", async () => {
    await call(planPayload({ seats: 50 }));

    expect(insertedOrder()?.amount_cents).toBe(4900);
  });

  it("JEDNORAZOWY zakup planu omija katalog cen i idzie ceną wiersza", async () => {
    // `kind=one_time` z planem to zakup dożywotni - nie ma cyklu, więc nie ma
    // po co pytać katalogu operatora o cenę subskrypcyjną.
    chain.setResponse(
      "access_plans",
      ok(planQuote({ tier_key: "warstwa-spoza-katalogu", price_cents: 29900 })),
    );

    const result = await call(planPayload({ kind: "one_time" }));

    expect(result.ok).toBe(true);
    expect(insertedOrder()?.amount_cents).toBe(29900);
    expect(insertedOrder()?.kind).toBe("one_time");
  });
});

describe("createCheckoutOrder - bilet z cennika wydarzenia", () => {
  const withTicketType = (over: Record<string, unknown> = {}) =>
    ticketPayload({ ticket_type_id: TICKET_ID, ...over });

  it("BŁĄD wyceny biletu zatrzymuje zamówienie", async () => {
    rpcResponses.set("event_ticket_checkout_quote", fail("ticket window closed"));

    await expect(call(withTicketType())).rejects.toThrow("ticket window closed");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("nieczytelna wycena (tablica zamiast obiektu) jest odmową, nie ceną zero", async () => {
    rpcResponses.set("event_ticket_checkout_quote", ok([]));

    await expect(call(withTicketType())).rejects.toThrow("ticket_not_available");
  });

  it("wycena bez wydarzenia jest odmową", async () => {
    rpcResponses.set("event_ticket_checkout_quote", ok(ticketQuote({ event_id: null })));

    await expect(call(withTicketType())).rejects.toThrow("ticket_not_available");
  });

  it("wejściówka Z INNEGO wydarzenia jest odrzucana - webhook potwierdziłby cudze RSVP", async () => {
    rpcResponses.set("event_ticket_checkout_quote", ok(ticketQuote({ event_id: OTHER_EVENT_ID })));

    await expect(call(withTicketType())).rejects.toThrow("ticket_not_available");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("bilet pokryty PULĄ PLANU odsyła z kasy - zamówienie na zero nie powstaje", async () => {
    // Pula konsumuje się przez `rsvp_event`, nie przez kasę. Zamówienie na 0 zł
    // przeszłoby jako opłacone i spaliłoby bilet bez żadnej płatności.
    rpcResponses.set("my_ticket_allowance", ok({ granted: 1, used: 0 }));

    await expect(call(withTicketType())).rejects.toThrow("ticket_included_in_plan");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("wycena bez liczbowej kwoty jest traktowana jak zero, a więc jako odmowa", async () => {
    rpcResponses.set("event_ticket_checkout_quote", ok(ticketQuote({ amount_cents: "15000" })));

    await expect(call(withTicketType())).rejects.toThrow("ticket_included_in_plan");
  });

  it("zniżka stawki ulgowej schodzi z kwoty wyceny, a nie z żądania", async () => {
    rpcResponses.set("my_ticket_allowance", ok({ granted: 0, used: 0, discount_pct: 50 }));

    await call(withTicketType());

    expect(insertedOrder()?.amount_cents).toBe(7500);
  });

  it("pusty kod dostępu NIE jedzie do bazy jako pusty napis", async () => {
    // RPC ma własną wartość domyślną; wysłanie `""` znaczyłoby „podano kod",
    // co dla wejściówki chronionej zaproszeniem jest inną ścieżką niż brak kodu.
    await call(withTicketType({ access_code: "" }));

    const quoteCall = rpcCalls.find((c) => c.fn === "event_ticket_checkout_quote");
    expect(quoteCall?.args.p_access_code).toBeUndefined();
  });

  it("podany kod dostępu jedzie do bazy - porównuje go ona, nie serwer aplikacji", async () => {
    await call(withTicketType({ access_code: "ZAPROSZENIE-1" }));

    const quoteCall = rpcCalls.find((c) => c.fn === "event_ticket_checkout_quote");
    expect(quoteCall?.args.p_access_code).toBe("ZAPROSZENIE-1");
  });

  it("waluta i etykieta pochodzą z wyceny bazy", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(ticketQuote({ currency: "EUR", amount_cents: 5000 })),
    );

    await call(withTicketType());

    expect(insertedOrder()?.currency).toBe("EUR");
    expect(orderMetadata().label).toBe("Kongres CEE - Bilet");
  });

  it("wycena bez waluty schodzi na złotówki, nie na pustkę", async () => {
    rpcResponses.set("event_ticket_checkout_quote", ok(ticketQuote({ currency: null })));

    await call(withTicketType());

    expect(insertedOrder()?.currency).toBe("PLN");
  });

  it("bez nazwy wejściówki etykietą jest sam tytuł wydarzenia", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(ticketQuote({ name_pl: null, name_en: null })),
    );

    await call(withTicketType());

    expect(orderMetadata().label).toBe("Kongres CEE");
  });

  it("bez tytułu polskiego etykieta schodzi na angielski", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(ticketQuote({ event_title_pl: null, name_pl: null })),
    );

    await call(withTicketType());

    expect(orderMetadata().label).toBe("CEE Congress - Ticket");
  });

  it("bez żadnego tytułu etykieta jest pusta, a zamówienie i tak powstaje", async () => {
    rpcResponses.set(
      "event_ticket_checkout_quote",
      ok(
        ticketQuote({
          event_title_pl: null,
          event_title_en: null,
          name_pl: null,
          name_en: null,
        }),
      ),
    );

    await call(withTicketType());

    expect(orderMetadata().label).toBe("");
  });
});

describe("createCheckoutOrder - wskazane zgłoszenie etapu 4", () => {
  it("AWARIA sprawdzenia zgłoszenia zatrzymuje kasę - milczące pominięcie byłoby gorsze", async () => {
    // Bez dowiązania po `registration_id` webhook dopasowuje wpłatę PO OSOBIE
    // (`LIMIT 1` po dacie), więc uczestnik z dwoma zgłoszeniami dostaje bilet
    // przypięty do niewłaściwego wiersza. Awaria sprawdzenia MUSI więc być
    // odmową, a nie cichym przejściem na ścieżkę bez klucza.
    rpcResponses.set("event_registration_payment_context", fail("statement timeout"));

    await expect(
      call(
        ticketPayload({
          ticket_type_id: TICKET_ID,
          registration_id: "99999999-0000-4000-8000-000000000009",
        }),
      ),
    ).rejects.toThrow("statement timeout");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });
});

describe("createCheckoutOrder - bilet z wiersza wydarzenia", () => {
  it("BŁĄD odczytu wydarzenia jest zgłaszany", async () => {
    chain.setResponse("events", fail("permission denied for table events"));

    await expect(call(ticketPayload())).rejects.toThrow("permission denied");
  });

  it("nieistniejące wydarzenie nie sprzedaje biletu", async () => {
    chain.setResponse("events", ok(null));

    await expect(call(ticketPayload())).rejects.toThrow("ticket_not_available");
  });

  it("wydarzenie BEZPŁATNE nie przechodzi przez kasę", async () => {
    chain.setResponse("events", ok(eventQuote({ ticket_price_cents: null })));

    await expect(call(ticketPayload())).rejects.toThrow("ticket_not_available");
  });

  it("cena zerowa albo ujemna to nie jest bilet do kupienia", async () => {
    chain.setResponse("events", ok(eventQuote({ ticket_price_cents: -100 })));

    await expect(call(ticketPayload())).rejects.toThrow("ticket_not_available");
  });

  it("wydarzenie NIEOPUBLIKOWANE nie sprzedaje biletów", async () => {
    // Szkic wydarzenia bywa kompletny (ma cenę i termin) - to status decyduje
    // o tym, czy sprzedaż ruszyła.
    chain.setResponse("events", ok(eventQuote({ status: "draft" })));

    await expect(call(ticketPayload())).rejects.toThrow("ticket_not_available");
  });

  it("wydarzenie PO TERMINIE odmawia osobnym powodem, żeby dało się to pokazać kupującemu", async () => {
    chain.setResponse("events", (query: RecordedChain) =>
      query.argsOf("select")?.[0] === "capacity"
        ? ok({ capacity: null })
        : ok(eventQuote({ starts_at: new Date(Date.now() - 86_400_000).toISOString() })),
    );

    await expect(call(ticketPayload())).rejects.toThrow("event_finished");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("wiersz BEZ kolumny daty startu nie jest uznany za zakończony", async () => {
    // `starts_at` jest w schemacie NOT NULL, więc `null` z bazy nie przyjdzie -
    // ale nieaktualny cache schematu PostgREST potrafi oddać wiersz BEZ tej
    // kolumny. Wartość nieokreślona nie może znaczyć „wydarzenie minęło",
    // bo to zablokowałoby sprzedaż wszystkich biletów naraz.
    chain.setResponse("events", (query: RecordedChain) =>
      query.argsOf("select")?.[0] === "capacity"
        ? ok({ capacity: null })
        : ok(eventQuote({ starts_at: undefined })),
    );

    const result = await call(ticketPayload());

    expect(result.ok).toBe(true);
  });

  it("WYPRZEDANE miejsca zatrzymują sprzedaż po stronie serwera, nie przycisku", async () => {
    chain.setResponse("events", (query: RecordedChain) =>
      query.argsOf("select")?.[0] === "capacity" ? ok({ capacity: 10 }) : ok(eventQuote()),
    );
    rpcResponses.set("get_event_rsvp_counts", ok([{ event_id: EVENT_ID, going: 10, waitlist: 3 }]));

    await expect(call(ticketPayload())).rejects.toThrow("event_full");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("kto ma już potwierdzone miejsce, nie zajmuje kolejnego przy ponowieniu płatności", async () => {
    chain.setResponse("event_rsvps", ok({ status: "going" }));
    chain.setResponse("events", (query: RecordedChain) =>
      query.argsOf("select")?.[0] === "capacity" ? ok({ capacity: 1 }) : ok(eventQuote()),
    );
    rpcResponses.set("get_event_rsvp_counts", ok([{ event_id: EVENT_ID, going: 1, waitlist: 0 }]));

    const result = await call(ticketPayload());

    expect(result.ok).toBe(true);
  });

  it("bilet pokryty pulą planu odsyła z kasy także na ścieżce bez cennika", async () => {
    rpcResponses.set("my_ticket_allowance", ok({ granted: 2, used: 1 }));

    await expect(call(ticketPayload())).rejects.toThrow("ticket_included_in_plan");
  });

  it("wiersz BEZ kolumny waluty schodzi na złotówki, a nie na pustą walutę", async () => {
    // Jak wyżej: kolumna jest NOT NULL, więc to zapas na rozjazd schematu.
    // Pusta waluta w sesji operatora jest błędem walidacji, czyli wywróconą
    // kasą - domyślna złotówka jest jedynym bezpiecznym wyjściem.
    chain.setResponse("events", (query: RecordedChain) =>
      query.argsOf("select")?.[0] === "capacity"
        ? ok({ capacity: null })
        : ok(eventQuote({ ticket_currency: undefined })),
    );

    await call(ticketPayload());

    expect(insertedOrder()?.currency).toBe("PLN");
  });

  it("etykieta schodzi z tytułu polskiego na angielski, a potem na pustkę", async () => {
    chain.setResponse("events", (query: RecordedChain) =>
      query.argsOf("select")?.[0] === "capacity"
        ? ok({ capacity: null })
        : ok(eventQuote({ title_pl: "", title_en: "CEE Congress" })),
    );

    await call(ticketPayload());

    expect(orderMetadata().label).toBe("CEE Congress");
  });

  it("bez żadnego tytułu etykieta jest pusta", async () => {
    chain.setResponse("events", (query: RecordedChain) =>
      query.argsOf("select")?.[0] === "capacity"
        ? ok({ capacity: null })
        : ok(eventQuote({ title_pl: "", title_en: "" })),
    );

    await call(ticketPayload());

    expect(orderMetadata().label).toBe("");
  });

  it("`event_id` trafia do metadanych - webhook po nim potwierdza RSVP", async () => {
    await call(ticketPayload());

    expect(orderMetadata().event_id).toBe(EVENT_ID);
    expect(orderMetadata()).not.toHaveProperty("ticket_type_id");
  });
});

describe("createCheckoutOrder - odblokowanie pojedynczej treści", () => {
  it("brak wskazania encji jest odmawiany przed odczytem reguły", async () => {
    await expect(call(entityPayload({ entity_id: null }))).rejects.toThrow("entity_required");
    expect(chain.chains).toHaveLength(0);
  });

  it("brak typu encji też jest odmawiany", async () => {
    await expect(call(entityPayload({ entity_type: null }))).rejects.toThrow("entity_required");
  });

  it("BŁĄD odczytu reguły dostępu jest zgłaszany", async () => {
    chain.setResponse("content_access_public", fail("permission denied"));

    await expect(call(entityPayload())).rejects.toThrow("permission denied");
  });

  it("treść bez reguły dostępu nie jest na sprzedaż", async () => {
    chain.setResponse("content_access_public", ok(null));

    await expect(call(entityPayload())).rejects.toThrow("one_time_not_available");
  });

  it("treść w trybie innym niż płatny nie jest na sprzedaż", async () => {
    // Treść za subskrypcją albo publiczna nie ma ceny jednorazowej - sprzedaż
    // takiego wpisu wzięłaby pieniądze za dostęp, który i tak już przysługuje.
    chain.setResponse("content_access_public", ok(accessRule({ mode: "members" })));

    await expect(call(entityPayload())).rejects.toThrow("one_time_not_available");
  });

  it("reguła płatna bez ceny nie jest na sprzedaż", async () => {
    chain.setResponse("content_access_public", ok(accessRule({ one_time_price_cents: null })));

    await expect(call(entityPayload())).rejects.toThrow("one_time_not_available");
  });

  it("cena niedodatnia nie jest na sprzedaż", async () => {
    chain.setResponse("content_access_public", ok(accessRule({ one_time_price_cents: -1 })));

    await expect(call(entityPayload())).rejects.toThrow("one_time_not_available");
  });

  it("cena i waluta pochodzą z reguły dostępu, tytuł z wpisu", async () => {
    await call(entityPayload());

    const order = insertedOrder();
    expect(order?.amount_cents).toBe(1500);
    expect(order?.currency).toBe("PLN");
    expect(order?.entity_type).toBe("post");
    expect(order?.entity_id).toBe(POST_ID);
    expect(orderMetadata().label).toBe("Analiza CEE");
  });

  it("reguła bez waluty schodzi na złotówki", async () => {
    chain.setResponse("content_access_public", ok(accessRule({ one_time_currency: null })));

    await call(entityPayload());

    expect(insertedOrder()?.currency).toBe("PLN");
  });

  it("strona czyta tytuł z `pages`, wpis z `posts` - to dwie różne tabele", async () => {
    await call(entityPayload({ entity_type: "page", entity_id: PAGE_ID }));

    expect(chain.chainsFor("pages")).toHaveLength(1);
    expect(chain.chainsFor("posts")).toHaveLength(0);
    expect(orderMetadata().label).toBe("Strona");
  });

  it("brak wiersza tytułu daje pustą etykietę, a nie awarię kasy", async () => {
    chain.setResponse("posts", ok(null));

    await call(entityPayload());

    expect(orderMetadata().label).toBe("");
  });

  it("pusty tytuł polski schodzi na angielski", async () => {
    chain.setResponse("posts", ok({ title_pl: "", title_en: "CEE analysis" }));

    await call(entityPayload());

    expect(orderMetadata().label).toBe("CEE analysis");
  });
});

describe("createCheckoutOrder - tryb bez skonfigurowanego dostawcy", () => {
  it("bez dostawcy zamówienie jest stemplowane `mock`, a nie `stripe`", async () => {
    const result = await call(planPayload());

    expect(insertedOrder()?.provider).toBe("mock");
    expect(result).toEqual({
      ok: true,
      mode: "mock",
      url: "/checkout/sukces?order=order-1&mock=1",
      orderId: "order-1",
    });
  });

  it("adres e-mail kupującego jedzie z tokenu, nie z ładunku żądania", async () => {
    await call(planPayload({ receipt_email: "podszywacz@example.com" }));

    expect(insertedOrder()?.receipt_email).toBe("kupujacy@example.org");
  });

  it("konto bez adresu w tokenie daje puste pole paragonu zamiast wywalać kasę", async () => {
    const withoutEmail = {
      supabase: client(),
      userId: "user-kupujacy",
      claims: {},
    };

    await callServerFn<CheckoutResult>(createCheckoutOrder, planPayload(), withoutEmail);

    expect(insertedOrder()?.receipt_email).toBeNull();
  });

  it("PRODUKCJA bez dostawcy ODMAWIA checkoutu zamiast po cichu wpaść w tryb mock", async () => {
    // To jest bezpiecznik P0: błędnie skonfigurowana produkcja rozdawałaby
    // płatne uprawnienia za darmo, bez żadnego sygnału błędu.
    vi.stubEnv("NODE_ENV", "production");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await call(planPayload());

    expect(result).toEqual({
      ok: false,
      mode: "unconfigured",
      error: "billing_unconfigured",
    });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("produkcja z jawną zgodą na tryb mock nadal działa (staging na produkcyjnym buildzie)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_ALLOW_MOCK", "1");

    const result = await call(planPayload());

    expect(result.ok).toBe(true);
    expect(insertedOrder()?.provider).toBe("mock");
  });

  it("środowisko bramki jest rozstrzygane SERWEROWO - w produkcji zawsze `live`", async () => {
    // Gdyby klient mógł wymusić `sandbox` na produkcji, sandboxowy webhook
    // opłacony kartą testową odblokowałby realną treść.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_ALLOW_MOCK", "1");

    await call(planPayload({ environment: "sandbox" }));

    expect(insertedOrder()?.environment).toBe("live");
  });

  it("poza produkcją środowisko z żądania jest respektowane", async () => {
    await call(planPayload({ environment: "live" }));

    expect(insertedOrder()?.environment).toBe("live");
  });

  it("brak wskazania środowiska schodzi na piaskownicę", async () => {
    await call(planPayload({ environment: undefined }));

    expect(insertedOrder()?.environment).toBe("sandbox");
  });
});

describe("createCheckoutOrder - walidacja wejścia", () => {
  it("nieznany rodzaj zamówienia jest odrzucany przez walidator", async () => {
    await expect(call(planPayload({ kind: "darowizna" }))).rejects.toThrow();
    expect(chain.chains).toHaveLength(0);
  });

  it("plan o złym kształcie identyfikatora nie dociera do bazy", async () => {
    await expect(call(planPayload({ plan_id: "nie-uuid" }))).rejects.toThrow();
    expect(chain.chains).toHaveLength(0);
  });

  it("brak ścieżki powrotu jest odrzucany", async () => {
    await expect(call(planPayload({ success_path: "" }))).rejects.toThrow();
  });

  it("liczba miejsc spoza zakresu 1..100 jest odrzucana", async () => {
    await expect(call(planPayload({ seats: 0 }))).rejects.toThrow();
    await expect(call(planPayload({ seats: 101 }))).rejects.toThrow();
  });

  it("waluta prezentacji spoza listy jest odrzucana", async () => {
    await expect(call(planPayload({ display_currency: "USD" }))).rejects.toThrow();
  });
});
