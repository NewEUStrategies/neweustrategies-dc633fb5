// Zamówienie ad-hoc (odblokowanie treści, bilet, darowizna) - 0 z 2 funkcji
// pokrytych do 31.08.2026.
//
// PO CO TEN PLIK ISTNIEJE. To jest ŚCIEŻKA PIENIĘDZY commitu, który deklarował
// domknięcie kasy: `buildAdhocOrder` wylicza kwotę, zakłada wiersz
// `payment_orders` i otwiera sesję u operatora. Audyt pokazał ją jako
// niewykonywaną przez żaden test - czyli reguła „KWOTA NIGDY NIE POCHODZI
// OD KLIENTA" (dla treści i biletów) nie była niczym dowiedziona.
//
// CO TU JEST ATRAPOWANE, A CO NIE. Atrapujemy GRANICE: klienta Supabase
// i operatora płatności (`@/lib/stripe.server`). NIE atrapujemy sąsiadów
// z `@/lib/billing/*` ani reguł biletowych z `@/lib/events/*` - wycena biletu,
// kontrola miejsc, ustawienia checkoutu i stemplowanie sesji wykonują się
// NAPRAWDĘ, bo to one decydują o kwocie. Test, który podmienia wycenę na
// atrapę, dowodzi wyłącznie tego, że atrapa działa.
//
// KAŻDA REGUŁA MA PARĘ: przejście i odmowa. Odmowy są tu ważniejsze - to one
// odróżniają „kasa działa" od „kasę da się oszukać".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/billing/fixtures";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase";

const h = vi.hoisted(() => {
  const fns = {
    customersSearch: vi.fn(),
    customersList: vi.fn(),
    customersUpdate: vi.fn(),
    customersCreate: vi.fn(),
    sessionsCreate: vi.fn(),
  };
  const stripe = {
    customers: {
      search: fns.customersSearch,
      list: fns.customersList,
      update: fns.customersUpdate,
      create: fns.customersCreate,
    },
    checkout: { sessions: { create: fns.sessionsCreate } },
  };
  /** Środowiska, o które moduł poprosił operatora - dowód stemplowania. */
  const envs: string[] = [];
  return { fns, stripe, envs };
});

// GRANICA: operator płatności. Żaden test nie wychodzi do sieci ani nie dotyka
// prawdziwych kluczy.
vi.mock("@/lib/stripe.server", () => ({
  createStripeClient: (env: string) => {
    h.envs.push(env);
    return h.stripe;
  },
  getStripeErrorMessage: (e: unknown) => `stripe_error:${(e as Error).message}`,
  resolveEnvironment: (requested?: string | null) => requested ?? "sandbox",
}));

// GRANICA: klient serwisowy (awaryjna ścieżka stemplowania sesji). Bez tej
// atrapy `markOrderSession` próbowałby zbudować prawdziwego klienta z sekretów.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({}) },
}));

const { buildAdhocOrder } = await import("@/lib/billing/adhocCheckoutOrder.server");
type AdhocArgs = Parameters<typeof buildAdhocOrder>[0];
type AdhocInput = AdhocArgs["data"];

/** Parametry sesji operatora w zakresie, o który pytamy w asercjach. */
interface SessionParams {
  mode: string;
  line_items: Array<{
    quantity: number;
    price_data?: { currency: string; unit_amount: number; product_data: { name: string } };
  }>;
  metadata: Record<string, string>;
  return_url: string;
  locale: string;
}

const USER = "user-kupujacy";
const EVENT = "11111111-1111-4111-8111-111111111111";
const ENTITY = "22222222-2222-4222-8222-222222222222";

let chain: SupabaseFromStub;
let rpc: SupabaseRpcStub;

/**
 * Klient w typie oczekiwanym przez moduł. `as never` (nie `as unknown as`) -
 * konwencja repo dla atrapy klienta Supabase, patrz `paymentOrders.server.test.ts`.
 */
const client = (): SupabaseClient =>
  ({
    from: (table: string) => chain.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => rpc.rpc(name, args),
  }) as never;

const lastSession = (): SessionParams => {
  const call = h.fns.sessionsCreate.mock.calls.at(-1);
  const params = call?.[0];
  if (typeof params !== "object" || params === null) {
    throw new Error("test: operator nie dostał parametrów sesji");
  }
  return params as SessionParams;
};

/** Ładunek `insert()` na zamówieniu - to on trafiłby do bazy. */
function insertedOrder(): Record<string, unknown> {
  const inserted = chain
    .chainsFor("payment_orders")
    .filter((c) => c.has("insert"))
    .at(-1);
  const payload = inserted?.argsOf("insert")?.[0];
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? { ...payload }
    : {};
}

/** Wiersz wydarzenia w kształcie czytanym przez wycenę biletu. */
function eventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EVENT,
    title_pl: "Decision Lab 2026",
    title_en: "Decision Lab 2026",
    ticket_price_cents: 12000,
    ticket_currency: "PLN",
    status: "published",
    starts_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    ...overrides,
  };
}

/**
 * Odpowiedź tabeli `events`. Ta sama tabela obsługuje DWA różne zapytania:
 * wycenę biletu i kontrolę miejsc (`select("capacity")`), więc rozdzielamy je
 * po liście kolumn - inaczej kontrola miejsc dostałaby wiersz wyceny.
 */
function respondEvents(row: Record<string, unknown> | null, capacity: number | null = null): void {
  chain.setResponse("events", (recorded: RecordedChain) => {
    const columns = String(recorded.argsOf("select")?.[0] ?? "");
    return columns.includes("capacity") ? ok({ capacity }) : ok(row);
  });
}

function args(overrides: Partial<AdhocArgs> = {}): AdhocArgs {
  const data: AdhocInput = {
    purpose: "donation",
    amountCents: 5000,
    returnUrl: "https://nes.example.com/dziekujemy",
    ...overrides.data,
  };
  return {
    environment: "sandbox",
    supabase: client(),
    userId: USER,
    email: "kupujacy@example.com",
    ...overrides,
    data,
  };
}

beforeEach(() => {
  chain = supabaseFromStub();
  rpc = supabaseRpcStub();

  // Domyślnie: pusta pula biletowa (pełna cena), sala bez limitu, sesja
  // stemplowana bez awarii.
  rpc.setData("my_ticket_allowance", { granted: 0, used: 0, discount_pct: 0, scope: "none" });
  rpc.setData("get_event_rsvp_counts", [{ going: 0, waitlist: 0 }]);
  rpc.setData("payment_order_mark_session", true);

  chain.setResponse("payment_orders", ok({ id: "order-adhoc-1", tenant_id: "tenant-alfa" }));
  chain.setResponse("checkout_settings", ok(null));
  chain.setResponse("event_rsvps", ok(null));
  respondEvents(eventRow());
  chain.setResponse(
    "content_access_public",
    ok({ mode: "paid", one_time_price_cents: 2500, one_time_currency: "PLN" }),
  );
  chain.setResponse("posts", ok({ title_pl: "Analiza tygodnia", title_en: "Weekly analysis" }));
  chain.setResponse("pages", ok({ title_pl: "Raport roczny", title_en: "Annual report" }));

  h.envs.length = 0;
  // Atrapy operatora są współdzielone przez cały plik (fabryka `vi.mock` jest
  // hoistowana), więc BEZ tego zerowania asercja „operator nie został wołany"
  // widziałaby wywołania z poprzednich testów.
  for (const fn of Object.values(h.fns)) fn.mockReset();
  h.fns.customersSearch.mockResolvedValue({ data: [{ id: "cus_znany" }] });
  h.fns.customersList.mockResolvedValue({ data: [] });
  h.fns.customersUpdate.mockResolvedValue({ id: "cus_znany" });
  h.fns.customersCreate.mockResolvedValue({ id: "cus_nowy" });
  h.fns.sessionsCreate.mockResolvedValue({ id: "cs_adhoc_1", client_secret: "cs_secret_adhoc" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// BILET - kwota pochodzi z wydarzenia, nie od klienta
// ---------------------------------------------------------------------------

describe("bilet na wydarzenie - wycena serwerowa", () => {
  it("KWOTA NARZUCONA PRZEZ KLIENTA JEST IGNOROWANA - płaci cenę z wydarzenia", async () => {
    // To jest CAŁY powód istnienia tego modułu. Gdyby `amountCents` z żądania
    // przedostało się do zamówienia albo do sesji operatora, każdy kupiłby
    // bilet za 1 grosz - a zamówienie i tak zostałoby zrealizowane webhookiem.
    const result = await buildAdhocOrder(
      args({
        data: {
          purpose: "event_ticket",
          eventId: EVENT,
          amountCents: 1,
          returnUrl: "https://nes.example.com/ok",
        },
      }),
    );

    expect(result).toEqual({
      ok: true,
      clientSecret: "cs_secret_adhoc",
      orderId: "order-adhoc-1",
    });
    expect(insertedOrder().amount_cents).toBe(12000);
    expect(lastSession().line_items[0].price_data?.unit_amount).toBe(12000);
  });

  it("waluta też pochodzi z wydarzenia, a nie z pola `currency` w żądaniu", async () => {
    respondEvents(eventRow({ ticket_currency: "EUR", ticket_price_cents: 9900 }));

    await buildAdhocOrder(
      args({
        data: {
          purpose: "event_ticket",
          eventId: EVENT,
          currency: "PLN",
          returnUrl: "https://nes.example.com/ok",
        },
      }),
    );

    expect(insertedOrder().currency).toBe("EUR");
    expect(lastSession().line_items[0].price_data?.currency).toBe("eur");
  });

  it("wydarzenie bez waluty i bez tytułu schodzi na wartości zastępcze", async () => {
    // Kasa musi ruszyć nawet przy niekompletnym wydarzeniu: brak waluty to
    // PLN (waluta domyślna instalacji), brak tytułu to etykieta „Bilet".
    // Alternatywą byłoby `undefined` w nazwie pozycji, które operator odrzuca.
    respondEvents(eventRow({ ticket_currency: null, title_pl: null, title_en: null }));

    await buildAdhocOrder(
      args({
        data: { purpose: "event_ticket", eventId: EVENT, returnUrl: "https://nes.example.com/ok" },
      }),
    );

    expect(insertedOrder().currency).toBe("PLN");
    expect(lastSession().line_items[0].price_data?.product_data.name).toBe("Bilet");
  });

  it("pusty tytuł polski schodzi na angielski, a nie na etykietę zastępczą", async () => {
    respondEvents(eventRow({ title_pl: "", title_en: "Decision Lab 2026" }));

    await buildAdhocOrder(
      args({
        data: { purpose: "event_ticket", eventId: EVENT, returnUrl: "https://nes.example.com/ok" },
      }),
    );

    expect(lastSession().line_items[0].price_data?.product_data.name).toBe("Decision Lab 2026");
  });

  it("ODMOWA: bilet bez wskazanego wydarzenia nie dotyka ani bazy, ani operatora", async () => {
    const result = await buildAdhocOrder(
      args({ data: { purpose: "event_ticket", returnUrl: "https://nes.example.com/ok" } }),
    );

    expect(result).toEqual({ ok: false, error: "entity_required" });
    expect(chain.chains).toHaveLength(0);
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });

  it("ODMOWA: wydarzenie nieistniejące albo niewidoczne dla kupującego", async () => {
    // RLS oddaje `null` także wtedy, gdy wydarzenie należy do INNEGO tenanta -
    // dla tej ścieżki to jeden i ten sam przypadek: nie ma czego sprzedać.
    respondEvents(null);

    const result = await buildAdhocOrder(
      args({
        data: { purpose: "event_ticket", eventId: EVENT, returnUrl: "https://nes.example.com/ok" },
      }),
    );

    expect(result).toEqual({ ok: false, error: "ticket_not_available" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("ODMOWA: wydarzenie bez ceny biletu (bezpłatne) nie przechodzi przez kasę", async () => {
    for (const price of [null, 0, -100]) {
      respondEvents(eventRow({ ticket_price_cents: price }));
      const result = await buildAdhocOrder(
        args({
          data: {
            purpose: "event_ticket",
            eventId: EVENT,
            returnUrl: "https://nes.example.com/ok",
          },
        }),
      );
      expect(result, `ticket_price_cents=${price}`).toEqual({
        ok: false,
        error: "ticket_not_available",
      });
    }
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });

  it("ODMOWA: wydarzenie nieopublikowane (szkic, archiwum) nie sprzedaje biletów", async () => {
    for (const status of ["draft", "archived", "cancelled"]) {
      respondEvents(eventRow({ status }));
      const result = await buildAdhocOrder(
        args({
          data: {
            purpose: "event_ticket",
            eventId: EVENT,
            returnUrl: "https://nes.example.com/ok",
          },
        }),
      );
      expect(result, status).toEqual({ ok: false, error: "ticket_not_available" });
    }
  });

  it("ODMOWA: wydarzenie, które już się odbyło", async () => {
    respondEvents(eventRow({ starts_at: new Date(Date.now() - 3_600_000).toISOString() }));

    const result = await buildAdhocOrder(
      args({
        data: { purpose: "event_ticket", eventId: EVENT, returnUrl: "https://nes.example.com/ok" },
      }),
    );

    expect(result).toEqual({ ok: false, error: "event_finished" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("wydarzenie bez daty rozpoczęcia nie jest uznawane za zakończone", async () => {
    respondEvents(eventRow({ starts_at: null }));

    const result = await buildAdhocOrder(
      args({
        data: { purpose: "event_ticket", eventId: EVENT, returnUrl: "https://nes.example.com/ok" },
      }),
    );

    expect(result).toMatchObject({ ok: true });
  });

  it("ODMOWA: bilet w całości pokryty pulą planu nie idzie do kasy", async () => {
    // Kwota zero jest SYGNAŁEM, a nie darmową płatnością: poprawną ścieżką
    // jest `rsvp_event`, które pulę skonsumuje. Sesja na 0 gr byłaby odrzucona
    // przez operatora, a członek zostałby bez biletu i bez komunikatu.
    rpc.setData("my_ticket_allowance", { granted: 1, used: 0, discount_pct: 0, scope: "personal" });

    const result = await buildAdhocOrder(
      args({
        data: { purpose: "event_ticket", eventId: EVENT, returnUrl: "https://nes.example.com/ok" },
      }),
    );

    expect(result).toEqual({ ok: false, error: "ticket_included_in_plan" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("zniżka planu obniża kwotę TĄ SAMĄ regułą, co karta wydarzenia", async () => {
    rpc.setData("my_ticket_allowance", {
      granted: 0,
      used: 0,
      discount_pct: 50,
      scope: "personal",
    });

    await buildAdhocOrder(
      args({
        data: { purpose: "event_ticket", eventId: EVENT, returnUrl: "https://nes.example.com/ok" },
      }),
    );

    expect(insertedOrder().amount_cents).toBe(6000);
  });

  it("awaria odczytu puli nie rozdaje darmowych biletów - schodzi na pełną cenę", async () => {
    // Kierunek degradacji jest tu jedyny dopuszczalny: brak odpowiedzi
    // o benefitach ma kosztować pełną cenę, a nie zero.
    rpc.setError("my_ticket_allowance", "function my_ticket_allowance does not exist");

    await buildAdhocOrder(
      args({
        data: { purpose: "event_ticket", eventId: EVENT, returnUrl: "https://nes.example.com/ok" },
      }),
    );

    expect(insertedOrder().amount_cents).toBe(12000);
  });

  it("kupujący z potwierdzonym miejscem ponawia płatność mimo pełnej sali", async () => {
    chain.setResponse("event_rsvps", ok({ status: "going" }));
    respondEvents(eventRow(), 10);
    rpc.setData("get_event_rsvp_counts", [{ going: 10, waitlist: 3 }]);

    const result = await buildAdhocOrder(
      args({
        data: { purpose: "event_ticket", eventId: EVENT, returnUrl: "https://nes.example.com/ok" },
      }),
    );

    expect(result).toMatchObject({ ok: true });
  });

  it("ODMOWA: błąd odczytu wydarzenia przerywa ścieżkę PRZED założeniem zamówienia", async () => {
    // Zamówienie założone „na wszelki wypadek" zostałoby wiszącym `pending`
    // bez sesji - dokładnie tym, czego szuka panel zamówień płatniczych.
    chain.setResponse("events", fail("permission denied for table events"));

    await expect(
      buildAdhocOrder(
        args({
          data: {
            purpose: "event_ticket",
            eventId: EVENT,
            returnUrl: "https://nes.example.com/ok",
          },
        }),
      ),
    ).rejects.toThrow("permission denied for table events");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ODBLOKOWANIE TREŚCI
// ---------------------------------------------------------------------------

describe("odblokowanie treści - wycena z reguły dostępu", () => {
  const unlock = (over: Partial<AdhocInput> = {}): AdhocArgs =>
    args({
      data: {
        purpose: "content_unlock",
        entityType: "post",
        entityId: ENTITY,
        returnUrl: "https://nes.example.com/ok",
        ...over,
      },
    });

  it("kwota i waluta pochodzą z reguły dostępu, a zamówienie wskazuje treść", async () => {
    const result = await buildAdhocOrder(unlock({ amountCents: 1 }));

    expect(result).toMatchObject({ ok: true, orderId: "order-adhoc-1" });
    expect(insertedOrder()).toMatchObject({
      amount_cents: 2500,
      currency: "PLN",
      entity_type: "post",
      entity_id: ENTITY,
      kind: "one_time",
      status: "pending",
    });
    expect(lastSession().line_items[0].price_data?.product_data.name).toBe("Analiza tygodnia");
  });

  it("czyta tytuł ze STRONY, gdy odblokowywana jest strona", async () => {
    await buildAdhocOrder(unlock({ entityType: "page" }));

    expect(chain.chainsFor("pages")).toHaveLength(1);
    expect(chain.chainsFor("posts")).toHaveLength(0);
    expect(lastSession().line_items[0].price_data?.product_data.name).toBe("Raport roczny");
  });

  it("brak wiersza treści degraduje NAZWĘ, a nie kwotę", async () => {
    chain.setResponse("posts", ok(null));

    await buildAdhocOrder(unlock());

    expect(lastSession().line_items[0].price_data?.product_data.name).toBe("Dostęp do treści");
    expect(insertedOrder().amount_cents).toBe(2500);
  });

  it("reguła bez waluty schodzi na PLN, a tytuł polski ustępuje angielskiemu", async () => {
    chain.setResponse("content_access_public", ok({ mode: "paid", one_time_price_cents: 2500 }));
    chain.setResponse("posts", ok({ title_pl: null, title_en: "Weekly analysis" }));

    await buildAdhocOrder(unlock());

    expect(insertedOrder().currency).toBe("PLN");
    expect(lastSession().line_items[0].price_data?.product_data.name).toBe("Weekly analysis");
  });

  it("ODMOWA: brak wskazania treści", async () => {
    for (const over of [
      { entityType: undefined },
      { entityId: undefined },
    ] as Partial<AdhocInput>[]) {
      const result = await buildAdhocOrder(unlock(over));
      expect(result, JSON.stringify(over)).toEqual({ ok: false, error: "entity_required" });
    }
    expect(chain.chains).toHaveLength(0);
  });

  it("ODMOWA: treść bez reguły płatnej - brak reguły, inny tryb, cena zerowa", async () => {
    const cases: Array<[string, unknown]> = [
      ["brak reguły", null],
      ["tryb wolny", { mode: "free", one_time_price_cents: 2500, one_time_currency: "PLN" }],
      ["tryb subskrypcyjny", { mode: "subscription", one_time_price_cents: 2500 }],
      ["cena zerowa", { mode: "paid", one_time_price_cents: 0 }],
      ["cena pusta", { mode: "paid", one_time_price_cents: null }],
      ["cena ujemna", { mode: "paid", one_time_price_cents: -500 }],
    ];

    for (const [label, rule] of cases) {
      chain.setResponse("content_access_public", ok(rule));
      const result = await buildAdhocOrder(unlock());
      expect(result, label).toEqual({ ok: false, error: "one_time_not_available" });
    }
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });

  it("ODMOWA: błąd odczytu reguły dostępu przerywa ścieżkę", async () => {
    chain.setResponse(
      "content_access_public",
      fail("permission denied for view content_access_public"),
    );

    await expect(buildAdhocOrder(unlock())).rejects.toThrow("permission denied");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DAROWIZNA - jedyna kwota podawana przez wpłacającego
// ---------------------------------------------------------------------------

describe("darowizna - kwota od ofiarodawcy, ale walidowana", () => {
  it("ODMOWA: kwota poniżej minimum operatora nie zakłada zamówienia", async () => {
    for (const amountCents of [undefined, 0, 1, 49, -100]) {
      const result = await buildAdhocOrder(
        args({
          data: { purpose: "donation", amountCents, returnUrl: "https://nes.example.com/ok" },
        }),
      );
      expect(result, `amountCents=${amountCents}`).toEqual({ ok: false, error: "amount_too_low" });
    }
    expect(chain.chains).toHaveLength(0);
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });

  it("przepuszcza dokładnie minimum operatora i zaokrągla grosze", async () => {
    await buildAdhocOrder(
      args({
        data: { purpose: "donation", amountCents: 50, returnUrl: "https://nes.example.com/ok" },
      }),
    );
    expect(insertedOrder().amount_cents).toBe(50);

    await buildAdhocOrder(
      args({
        data: { purpose: "donation", amountCents: 1234.6, returnUrl: "https://nes.example.com/ok" },
      }),
    );
    expect(insertedOrder().amount_cents).toBe(1235);
  });

  it("waluta domyślna to PLN, a wskazana jest respektowana", async () => {
    await buildAdhocOrder(args());
    expect(insertedOrder().currency).toBe("PLN");

    await buildAdhocOrder(
      args({
        data: {
          purpose: "donation",
          amountCents: 5000,
          currency: "EUR",
          returnUrl: "https://nes.example.com/ok",
        },
      }),
    );
    expect(insertedOrder().currency).toBe("EUR");
  });

  it("darowizna nie wskazuje żadnej treści ani wydarzenia", async () => {
    await buildAdhocOrder(args());

    expect(insertedOrder()).toMatchObject({ entity_type: null, entity_id: null });
    expect(lastSession().metadata).not.toHaveProperty("event_id");
  });
});

// ---------------------------------------------------------------------------
// ZAMÓWIENIE I SESJA
// ---------------------------------------------------------------------------

describe("zamówienie i sesja operatora", () => {
  it("zakłada zamówienie OCZEKUJĄCE, ostemplowane środowiskiem i celem zakupu", async () => {
    await buildAdhocOrder(args({ environment: "live" }));

    expect(insertedOrder()).toMatchObject({
      user_id: USER,
      kind: "one_time",
      status: "pending",
      provider: "stripe",
      receipt_email: "kupujacy@example.com",
      environment: "live",
      metadata: { label: "Darowizna", purpose: "donation" },
    });
    // Operator jest pytany DOKŁADNIE o środowisko zamówienia - inaczej sesja
    // opłacona kartą testową domykałaby zamówienie produkcyjne.
    expect(h.envs).toEqual(["live"]);
  });

  it("metadane biletu jadą na zamówienie i do sesji (webhook czyta je z obu)", async () => {
    await buildAdhocOrder(
      args({
        data: { purpose: "event_ticket", eventId: EVENT, returnUrl: "https://nes.example.com/ok" },
      }),
    );

    expect(insertedOrder().metadata).toMatchObject({ purpose: "event_ticket", event_id: EVENT });
    expect(lastSession().metadata).toMatchObject({
      orderId: "order-adhoc-1",
      purpose: "event_ticket",
      userId: USER,
      event_id: EVENT,
    });
  });

  it("czyta ustawienia checkoutu TENANTA ZAMÓWIENIA, nie globalne", async () => {
    await buildAdhocOrder(args());

    const settings = chain.lastChain("checkout_settings")!;
    expect(settings.argsOf("eq")).toEqual(["tenant_id", "tenant-alfa"]);
  });

  it("zamówienie bez czytelnego tenanta czyta ustawienia bez zawężenia", async () => {
    // Klient jest tu nietypowany, więc `tenant_id` bywa czymkolwiek. Zamiast
    // ufać wnioskowaniu, moduł zawęża jawnie - a gdy nie ma czego zawęzić,
    // schodzi na konserwatywne domyślne zamiast wywalać płatność.
    chain.setResponse("payment_orders", ok({ id: "order-adhoc-1", tenant_id: null }));

    const result = await buildAdhocOrder(args());

    expect(result).toMatchObject({ ok: true });
    expect(chain.lastChain("checkout_settings")!.has("eq")).toBe(false);
  });

  it("po udanej sesji zamówienie dostaje identyfikator sesji i stan `processing`", async () => {
    await buildAdhocOrder(args());

    expect(rpc.lastCall("payment_order_mark_session")?.args).toEqual({
      _order_id: "order-adhoc-1",
      _session_id: "cs_adhoc_1",
      _status: "processing",
    });
  });

  it("ODMOWA OPERATORA zamyka zamówienie jako NIEUDANE - nigdy wiszące `pending`", async () => {
    // Wiszące `pending` bez sesji to sygnał, którego szuka panel zamówień;
    // zamówienie po odmowie operatora musi się zamknąć samo.
    h.fns.sessionsCreate.mockRejectedValue(new Error("card_declined"));

    const result = await buildAdhocOrder(args());

    expect(result).toEqual({ ok: false, error: "stripe_error:card_declined" });
    expect(rpc.lastCall("payment_order_mark_session")?.args).toEqual({
      _order_id: "order-adhoc-1",
      _status: "failed",
    });
  });

  it("sesja bez sekretu też zamyka zamówienie jako nieudane", async () => {
    // Bez sekretu nakładka checkoutu nie ruszy - to porażka, mimo że operator
    // odpowiedział 200.
    h.fns.sessionsCreate.mockResolvedValue({ id: "cs_adhoc_1", client_secret: null });

    const result = await buildAdhocOrder(args());

    expect(result).toEqual({ ok: false, error: "session_missing_client_secret" });
    expect(rpc.lastCall("payment_order_mark_session")?.args).toMatchObject({ _status: "failed" });
  });

  it("ODMOWA: błąd zapisu zamówienia przerywa ścieżkę przed dotknięciem operatora", async () => {
    chain.setResponse("payment_orders", fail("new row violates row-level security policy"));

    await expect(buildAdhocOrder(args())).rejects.toThrow("row-level security");
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });

  it("gość bez konta u operatora dostaje sesję na sam adres e-mail", async () => {
    h.fns.customersSearch.mockResolvedValue({ data: [] });
    h.fns.customersList.mockResolvedValue({ data: [] });

    const result = await buildAdhocOrder(args({ email: null }));

    expect(result).toMatchObject({ ok: true });
    expect(h.fns.customersCreate).toHaveBeenCalled();
  });

  it("język ramki operatora jest normalizowany, a nie dziedziczony z żądania", async () => {
    await buildAdhocOrder(args({ locale: "en" }));
    expect(lastSession().locale).toBe("en");

    await buildAdhocOrder(args({ locale: undefined }));
    expect(lastSession().locale).toBe("pl");
  });
});

// ---------------------------------------------------------------------------
// Brak miejsc - jedyna odmowa, która NIE wraca kanałem odmowy
// ---------------------------------------------------------------------------

describe("wyprzedana sala", () => {
  // DEFEKT NAPRAWIONY 31.08.2026 (`adhocCheckoutOrder.server.ts`).
  //
  // CO BYŁO ZŁE. `buildAdhocOrder` ma zadeklarowany kanał odmowy
  // (`{ ok: false, error }`) i korzystał z niego przy KAŻDEJ innej odmowie
  // biletowej: `entity_required`, `ticket_not_available`, `event_finished`,
  // `ticket_included_in_plan`. Jedynym wyjątkiem była pełna sala:
  // `assertSeatAvailable` rzuca `Error("event_full")`, a ta funkcja nie miała
  // wokół wyceny żadnego `try`, więc wyjątek leciał przez server fn na zewnątrz.
  //
  // JAKIE TO BYŁO RYZYKO. To NAJCZĘSTSZA odmowa popularnego wydarzenia -
  // i jedyna, której kupujący nie widział jako zdania. Zamiast komunikatu
  // o braku miejsc dostawał błąd serwera i ogólne „coś poszło nie tak".
  // Skutek operacyjny: kupujący klika ponownie, obsługa dostaje zgłoszenie
  // „kasa nie działa", a w logu leży wyjątek nieodróżnialny od awarii bazy.
  //
  // JAK ZOSTAŁO NAPRAWIONE. Wywołanie `assertSeatAvailable` stoi w `try`,
  // a wyjątek o komunikacie `event_full` (i TYLKO on) zamienia się w odmowę
  // `{ ok: false, error: "event_full" }`. Kod odmowy zostaje ten sam, którym
  // moduł biletów posługuje się od zawsze - dzięki temu drugie wywołanie
  // `assertSeatAvailable` (`oneTimeFulfilment.server.ts`), które celowo ŁAPIE
  // ten wyjątek po nazwie komunikatu, działa bez zmian. Każdy inny wyjątek
  // (np. awaria odczytu miejsc) leci dalej: to nie jest odmowa i nie wolno go
  // pokazywać kupującemu jako „brak miejsc".
  it("brak wolnych miejsc wraca KANAŁEM ODMOWY, a nie wyjątkiem", async () => {
    respondEvents(eventRow(), 10);
    rpc.setData("get_event_rsvp_counts", [{ going: 10, waitlist: 2 }]);

    // Wynik i wyjątek sprowadzone do JEDNEJ wartości, żeby test opisywał
    // KANAŁ odpowiedzi, a nie tylko jej treść.
    const outcome = await buildAdhocOrder(
      args({
        data: { purpose: "event_ticket", eventId: EVENT, returnUrl: "https://nes.example.com/ok" },
      }),
    ).then(
      (value) => value,
      (error: unknown) => ({ rzucono: error instanceof Error ? error.message : String(error) }),
    );

    expect(outcome).toEqual({ ok: false, error: "event_full" });
  });

  it("zamówienie NIE powstaje, gdy sala jest pełna", async () => {
    // Odmowa musi zapaść PRZED zapisem: zamówienie założone dla pełnej sali
    // zostałoby wiszącym `pending` bez sesji, czyli dokładnie tym, czego szuka
    // panel „zamówień wiszących".
    respondEvents(eventRow(), 10);
    rpc.setData("get_event_rsvp_counts", [{ going: 10, waitlist: 2 }]);

    const result = await buildAdhocOrder(
      args({
        data: { purpose: "event_ticket", eventId: EVENT, returnUrl: "https://nes.example.com/ok" },
      }),
    );

    expect(result).toEqual({ ok: false, error: "event_full" });
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
    expect(h.fns.sessionsCreate).not.toHaveBeenCalled();
  });

  it("AWARIA kontroli miejsc NIE jest zamieniana na „brak miejsc”", async () => {
    // Granica poprawki: łapiemy wyłącznie wyjątek o komunikacie `event_full`.
    // Padnięcie transportu w trakcie kontroli miejsc pokazane jako
    // „wyprzedane" byłoby kłamstwem o dostępności biletu - zamknęłoby sprzedaż
    // wydarzenia bez żadnego śladu w logu.
    chain.setResponse("event_rsvps", () => {
      throw new Error("rsvp transport died");
    });

    await expect(
      buildAdhocOrder(
        args({
          data: {
            purpose: "event_ticket",
            eventId: EVENT,
            returnUrl: "https://nes.example.com/ok",
          },
        }),
      ),
    ).rejects.toThrow("rsvp transport died");
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });
});
