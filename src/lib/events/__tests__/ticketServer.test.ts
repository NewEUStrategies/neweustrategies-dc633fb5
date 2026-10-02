// Warstwa serwerowa biletu i miejsc na wydarzenie.
//
// DLACZEGO TO JEST PIERWSZA RZECZ DO NAPISANIA W MODULE 7. pgTAP dowodzi w
// bazie kolejki FIFO listy rezerwowej, promocji po zwolnieniu miejsca, bramki
// tier i zakazu bezpośredniego INSERT-a (`community_events_test.sql`,
// `community_events_waitlist_test.sql`) - i tych reguł tutaj NIE powtarzamy.
// Ale decyzję „czy jest jeszcze miejsce" podejmuje TypeScript, nie SQL, i do
// 18.08.2026 nie miała ani jednego wywołania w testach.
//
// Ta decyzja rozstrzyga o pieniądzach w dwie strony:
//   * `checkout.functions.ts` i `adhocCheckoutOrder.server.ts` pytają PRZED
//     sprzedażą - fałszywe „jest miejsce" sprzedaje wejściówkę, której nie ma;
//   * `oneTimeFulfilment.server.ts` pyta PO zapłacie (`refundIfOversold`) i
//     łapie WYŁĄCZNIE `err.message === "event_full"`, każdy inny błąd rzucając
//     dalej. Zmiana treści tego komunikatu zamienia „zwróć kupującemu pieniądze"
//     w „webhook wybucha i ponawia w kółko", i nie widzi tego żadne inne miejsce
//     w repozytorium. Stąd asercja na DOSŁOWNY napis.
//
// Jedyny istniejący test dotykający tej funkcji (`oneTimeFulfilment.event.test.ts`)
// mockuje ją w całości - czyli dowodzi zwrotu ZAKŁADAJĄC, że bramka miejsc
// działa. Ten plik sprawdza to założenie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ticketCodeFrom } from "@/lib/events/ticketCode";
import {
  EVENT_IDS,
  eventRow,
  fail,
  ok,
  paymentOrderRow,
  profileRow,
  rsvpCountsRow,
  rsvpRow,
  seatStateRow,
  supabaseClientStub,
  type PaymentOrderRow,
  type RecordedChain,
  type SupabaseClientStub,
  type SupabaseResult,
} from "@/test/events/fixtures";

const h = vi.hoisted(() => ({
  /** Argumenty każdego `createClient` - do asercji o kluczu i opcjach. */
  calls: [] as Array<{ url: string; key: string; options: Record<string, unknown> }>,
  /** Klient, który `publicClient()` ma oddać. */
  client: null as unknown,
  /** Wywołania przez `fetchWithTenantHost` - dowód, że odczyt niesie hosta. */
  tenantFetches: 0,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string, key: string, options: Record<string, unknown>) => {
    h.calls.push({ url, key, options });
    return h.client;
  },
}));

// Prawdziwy `fetchWithTenantHost` dokłada nagłówek hosta z kontekstu żądania.
// Tu liczy wywołania i oddaje żądanie globalnemu `fetch` bez zmian - test
// nagłówków klucza widzi dokładnie to, co złożył `publicClient()`.
vi.mock("@/integrations/supabase/tenant-host-fetch", () => ({
  fetchWithTenantHost: (input: RequestInfo | URL, init?: RequestInit) => {
    h.tenantFetches += 1;
    return fetch(input, init);
  },
}));

const { assertSeatAvailable, loadEventSeatState, loadMyEventTicket } =
  await import("@/lib/events/ticket.server");

/** Atrapa klienta w typie, którego oczekuje warstwa serwerowa. */
function asClient(stub: SupabaseClientStub): SupabaseClient {
  return stub.client as unknown as SupabaseClient;
}

/**
 * Stan miejsc z `event_seat_state`. `rows` w wariancie jawnym podaje odpowiedź
 * RPC wprost (także `null` i pustą tablicę - gałęzie obronne muszą być osiągalne).
 */
function seatScenario(
  input: { capacity: number | null; going?: number; waitlist?: number } | { rows: unknown },
): SupabaseClientStub {
  const stub = supabaseClientStub();
  stub.setRpc(
    "event_seat_state",
    ok("rows" in input ? input.rows : seatStateRow({ ...input, capacity: input.capacity })),
  );
  return stub;
}

beforeEach(() => {
  h.calls.length = 0;
  h.client = null;
  h.tenantFetches = 0;
  vi.stubEnv("SUPABASE_URL", "https://db.example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_abc123");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Arytmetyka miejsc
// ---------------------------------------------------------------------------

describe("loadEventSeatState - arytmetyka miejsc", () => {
  it("brak pojemności oznacza brak limitu, nie zero miejsc", async () => {
    h.client = seatScenario({ capacity: null, going: 120 }).client;
    const state = await loadEventSeatState(EVENT_IDS.event);
    expect(state.capacity).toBeNull();
    expect(state.seatsLeft).toBeNull();
    expect(state.isFull).toBe(false);
  });

  it("pojemność 0 to BRAK limitu, a nie wyprzedanie", async () => {
    // Pułapka warta asercji: `capacity > 0` w `seatState` sprawia, że zero
    // znaczy „bez limitu". Odwrócenie tego warunku przy refaktorze zamknęłoby
    // sprzedaż KAŻDEGO wydarzenia bez ustawionej pojemności - awaria widoczna
    // wyłącznie jako spadek sprzedaży, nie jako błąd.
    h.client = seatScenario({
      rows: seatStateRow({ capacity: 0, seats_left: 0, going: 5 }),
    }).client;
    const state = await loadEventSeatState(EVENT_IDS.event);
    expect(state.capacity).toBeNull();
    expect(state.isFull).toBe(false);
  });

  it("ujemna pojemność też jest traktowana jak brak limitu", async () => {
    h.client = seatScenario({ rows: seatStateRow({ capacity: -3, seats_left: 0 }) }).client;
    expect((await loadEventSeatState(EVENT_IDS.event)).capacity).toBeNull();
  });

  it("liczy pozostałe miejsca przy częściowo zapełnionej sali", async () => {
    h.client = seatScenario({ capacity: 10, going: 3, waitlist: 2 }).client;
    const state = await loadEventSeatState(EVENT_IDS.event);
    expect(state).toMatchObject({
      eventId: EVENT_IDS.event,
      capacity: 10,
      going: 3,
      waitlist: 2,
      seatsLeft: 7,
      isFull: false,
    });
  });

  it("JEDNO ŹRÓDŁO: wolne miejsca to `seats_left` z reguły bazy, nie `capacity - going`", async () => {
    // Najważniejsza asercja sekcji. Reguła `_event_page_seats_left` bierze
    // MNIEJSZĄ z puli zgłoszeń i puli legacy. Gdyby kod znów odejmował sam
    // (`capacity - going` z jednej puli), strona pokazałaby 7 wolnych miejsc
    // obok nagłówka mówiącego o dwóch - a kasa sprzedałaby piąte z nich.
    h.client = seatScenario({
      rows: seatStateRow({ capacity: 10, going: 3, seats_left: 2 }),
    }).client;
    const state = await loadEventSeatState(EVENT_IDS.event);
    expect(state.seatsLeft).toBe(2);
    expect(state.isFull).toBe(false);
  });

  it("komplet według reguły bazy jest kompletem, choć pula legacy ma wolne", async () => {
    h.client = seatScenario({
      rows: seatStateRow({ capacity: 10, going: 4, seats_left: 0 }),
    }).client;
    const state = await loadEventSeatState(EVENT_IDS.event);
    expect(state.seatsLeft).toBe(0);
    expect(state.isFull).toBe(true);
  });

  it("sala pełna co do miejsca - isFull przy dokładnie zerze wolnych", async () => {
    h.client = seatScenario({ capacity: 10, going: 10 }).client;
    const state = await loadEventSeatState(EVENT_IDS.event);
    expect(state.seatsLeft).toBe(0);
    expect(state.isFull).toBe(true);
  });

  it("ujemne `seats_left` nie daje UJEMNEJ liczby wolnych miejsc", async () => {
    // Gdyby `Math.max(0, ...)` zniknął, UI pokazałby „-2 miejsca", a `isFull`
    // (porównanie z zerem) zrobiłoby się FAŁSZEM - czyli przepełnione
    // wydarzenie znów zaczęłoby sprzedawać.
    h.client = seatScenario({
      rows: seatStateRow({ capacity: 10, going: 12, seats_left: -2 }),
    }).client;
    const state = await loadEventSeatState(EVENT_IDS.event);
    expect(state.seatsLeft).toBe(0);
    expect(state.isFull).toBe(true);
  });

  it("brak wiersza (wydarzenie niewidoczne) to brak limitu, a nie awaria", async () => {
    h.client = seatScenario({ rows: null }).client;
    const state = await loadEventSeatState(EVENT_IDS.event);
    expect(state).toMatchObject({ capacity: null, seatsLeft: null, going: 0, waitlist: 0 });
    expect(state.isFull).toBe(false);
  });

  it("pusta tablica z RPC czyta się tak samo jak brak wiersza", async () => {
    h.client = seatScenario({ rows: [] }).client;
    const state = await loadEventSeatState(EVENT_IDS.event);
    expect(state.going).toBe(0);
    expect(state.seatsLeft).toBeNull();
  });

  it("liczniki podane jako napisy są konwertowane na liczby", async () => {
    // PostgREST potrafi oddać `bigint` jako napis. Bez `Number()` porównanie
    // z zerem nie zadziałałoby, a `isFull` byłoby fałszem.
    h.client = seatScenario({
      rows: [{ capacity: "10", seats_left: "6", going: "4", waitlist: "1" }],
    }).client;
    const state = await loadEventSeatState(EVENT_IDS.event);
    expect(state.going).toBe(4);
    expect(state.waitlist).toBe(1);
    expect(state.seatsLeft).toBe(6);
  });

  it("znacznik odczytu jest poprawną datą ISO-8601", async () => {
    // Klient pokazuje, jak świeża jest liczba miejsc - napis musi dać się sparsować.
    h.client = seatScenario({ capacity: 5 }).client;
    const state = await loadEventSeatState(EVENT_IDS.event);
    expect(Number.isNaN(Date.parse(state.checkedAt))).toBe(false);
    expect(state.checkedAt).toBe(new Date(state.checkedAt).toISOString());
  });

  it("JEDNO wywołanie: pojemność jedzie w wierszu RPC, bez osobnego odczytu tabeli", async () => {
    const stub = seatScenario({ capacity: 5 });
    h.client = stub.client;
    await loadEventSeatState(EVENT_IDS.event);
    expect(stub.rpcCalls).toEqual([
      { fn: "event_seat_state", args: { p_event_id: EVENT_IDS.event } },
    ]);
    expect(stub.db.chainsFor("events")).toHaveLength(0);
  });

  it("odmowa bazy RZUCA - awaria odczytu nie jest „brakiem limitu”", async () => {
    // Wcześniej błąd RPC był czytany jako „zero zajętych": bramka sprzedaży
    // przepuszczała wtedy KAŻDY bilet. Teraz wołający dostaje wyjątek.
    const stub = supabaseClientStub();
    stub.setRpc("event_seat_state", fail("canceling statement due to statement timeout", "57014"));
    h.client = stub.client;
    await expect(loadEventSeatState(EVENT_IDS.event)).rejects.toThrow(
      "seat_state_unavailable: canceling statement due to statement timeout",
    );
  });

  it.each(["PGRST202", "42883"])(
    "okno wdrożenia (%s): bez nowej funkcji liczy dawną regułą, zamiast stawać",
    async (code) => {
      // Kod może wejść przed migracją 20261002210000. Kasa nie może wtedy
      // stanąć dla wszystkich biletów - liczymy tak jak przed zmianą.
      const stub = supabaseClientStub();
      stub.setRpc("event_seat_state", fail("Could not find the function", code));
      stub.db.setResponse("events", ok({ capacity: 10 }));
      stub.setRpc("get_event_rsvp_counts", ok(rsvpCountsRow(4, 2)));
      h.client = stub.client;

      const state = await loadEventSeatState(EVENT_IDS.event);

      expect(state).toMatchObject({ capacity: 10, going: 4, waitlist: 2, seatsLeft: 6 });
      expect(stub.rpcCalls.map((call) => call.fn)).toEqual([
        "event_seat_state",
        "get_event_rsvp_counts",
      ]);
    },
  );

  it("okno wdrożenia zachowuje dawne brzegi: brak liczników to zero zajętych", async () => {
    const stub = supabaseClientStub();
    stub.setRpc("event_seat_state", fail("Could not find the function", "PGRST202"));
    stub.db.setResponse("events", ok({ capacity: 3 }));
    stub.setRpc("get_event_rsvp_counts", ok(null));
    h.client = stub.client;

    expect((await loadEventSeatState(EVENT_IDS.event)).seatsLeft).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Klient publiczny - nagłówki klucza publikowalnego
// ---------------------------------------------------------------------------

describe("publicClient - nagłówki klucza publikowalnego", () => {
  /** Wyciąga `fetch` wstrzyknięty do klienta i woła go jak PostgREST. */
  async function callInjectedFetch(init?: RequestInit): Promise<Headers> {
    const stub = seatScenario({ capacity: 1 });
    h.client = stub.client;
    await loadEventSeatState(EVENT_IDS.event);

    const spy = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", spy);

    const options = h.calls[0]!.options as { global: { fetch: typeof fetch } };
    await options.global.fetch("https://db.example.supabase.co/rest/v1/events", init);
    const [, passed] = spy.mock.calls[0] as unknown as [string, { headers: Headers }];
    return passed.headers;
  }

  it("klucz sb_ nie jedzie w nagłówku Authorization", async () => {
    // Klucze `sb_` są nieprzezroczyste (nie są JWT). PostgREST przyjmuje je
    // WYŁĄCZNIE w `apikey`; zostawienie `Authorization: Bearer sb_...` daje 401
    // na całym publicznym odczycie miejsc - awaria widoczna dopiero na
    // produkcji, bo lokalnie bywa klucz w kształcie JWT.
    const headers = await callInjectedFetch({
      headers: { Authorization: "Bearer sb_publishable_abc123" },
    });
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("apikey")).toBe("sb_publishable_abc123");
  });

  it("klucz w kształcie JWT zachowuje nagłówek Authorization", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "eyJhbGciOiJIUzI1NiJ9.payload.sig");
    const headers = await callInjectedFetch({
      headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig" },
    });
    expect(headers.get("Authorization")).toBe("Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig");
    expect(headers.get("apikey")).toBe("eyJhbGciOiJIUzI1NiJ9.payload.sig");
  });

  it("cudzy nagłówek Authorization przy kluczu sb_ zostaje nietknięty", async () => {
    // Warunek porównuje z WŁASNYM kluczem, więc token użytkownika przechodzi.
    const headers = await callInjectedFetch({ headers: { Authorization: "Bearer user-jwt" } });
    expect(headers.get("Authorization")).toBe("Bearer user-jwt");
  });

  it("apikey jest dokładany także wtedy, gdy żądanie nie ma żadnych nagłówków", async () => {
    const headers = await callInjectedFetch();
    expect(headers.get("apikey")).toBe("sb_publishable_abc123");
  });

  it("żądanie idzie przez `fetchWithTenantHost` - odczyt liczy miejsca najemcy z hosta", async () => {
    // `event_seat_state` rozpoznaje najemcę po `public_tenant_id()`, czyli po
    // nagłówku hosta. Bez niego odczyt z domeny najemcy B liczyłby miejsca
    // najemcy domyślnego - dla wydarzenia B: brak wiersza, czyli „bez limitu".
    await callInjectedFetch();
    expect(h.tenantFetches).toBe(1);
  });

  it("brak zmiennych środowiskowych daje puste napisy, a nie `undefined`", async () => {
    // `createClient(undefined, undefined)` rzuca w supabase-js. Fallbacki `?? ""`
    // sprawiają, że w środowisku bez konfiguracji odczyt miejsc kończy się
    // czytelnym błędem sieci, a nie wywrotką przy budowie klienta.
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    h.client = seatScenario({ capacity: 1 }).client;
    await loadEventSeatState(EVENT_IDS.event);
    expect(h.calls[0]).toMatchObject({ url: "", key: "" });
  });

  it("klient publiczny nie utrwala sesji ani jej nie odświeża", async () => {
    // Odczyt anonimowy w SSR nie ma prawa zapisać sesji w środowisku serwera.
    h.client = seatScenario({ capacity: 1 }).client;
    await loadEventSeatState(EVENT_IDS.event);
    expect(h.calls[0]!.options.auth).toEqual({
      persistSession: false,
      autoRefreshToken: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Bramka miejsc przed sprzedażą
// ---------------------------------------------------------------------------

describe("assertSeatAvailable - bramka przed sprzedażą biletu", () => {
  /** Scenariusz: mój status RSVP + pojemność i liczniki sali. */
  function gate(input: {
    mine: { status: string } | null;
    capacity: number | null;
    going?: number;
  }): SupabaseClientStub {
    const stub = supabaseClientStub();
    stub.db.setResponse("event_rsvps", ok(input.mine));
    stub.setRpc(
      "event_seat_state",
      ok(seatStateRow({ capacity: input.capacity, going: input.going ?? 0 })),
    );
    return stub;
  }

  it("kto ma już potwierdzone miejsce, nie zajmuje drugiego", async () => {
    // NAJWAŻNIEJSZA REGUŁA PLIKU. Bez niej ponowienie nieopłaconego zamówienia
    // przez tę samą osobę liczyłoby się jako druga rezerwacja i przy ostatnim
    // wolnym miejscu blokowałoby ją przed jej WŁASNYM biletem.
    const stub = gate({ mine: { status: "going" }, capacity: 1, going: 1 });
    await expect(
      assertSeatAvailable(asClient(stub), EVENT_IDS.event, EVENT_IDS.user),
    ).resolves.toBeUndefined();
  });

  it("wraca NATYCHMIAST - nie liczy w ogóle miejsc dla kogoś, kto już wszedł", async () => {
    // Dowód, że to skrót, a nie zbieg okoliczności: przy pełnej sali funkcja
    // nie tyka ani tabeli `events`, ani RPC liczników.
    const stub = gate({ mine: { status: "going" }, capacity: 1, going: 99 });
    await assertSeatAvailable(asClient(stub), EVENT_IDS.event, EVENT_IDS.user);
    expect(stub.db.chainsFor("events")).toHaveLength(0);
    expect(stub.rpcCalls).toHaveLength(0);
  });

  it.each(["waitlist", "interested", "cancelled"])(
    "status %s NIE liczy się jako zajęte miejsce - bramka sprawdza salę",
    async (status) => {
      const stub = gate({ mine: { status }, capacity: 1, going: 1 });
      await expect(
        assertSeatAvailable(asClient(stub), EVENT_IDS.event, EVENT_IDS.user),
      ).rejects.toThrow("event_full");
    },
  );

  it("brak wiersza RSVP prowadzi do sprawdzenia sali", async () => {
    const stub = gate({ mine: null, capacity: 2, going: 1 });
    await expect(
      assertSeatAvailable(asClient(stub), EVENT_IDS.event, EVENT_IDS.user),
    ).resolves.toBeUndefined();
    expect(stub.rpcCalls).toHaveLength(1);
  });

  it("pełna sala rzuca DOKŁADNIE `event_full`", async () => {
    // `refundIfOversold` porównuje `err.message === "event_full"` i rzuca dalej
    // wszystko inne. Inny napis = webhook płatności wybucha zamiast zwrócić
    // pieniądze za nieistniejące miejsce.
    const stub = gate({ mine: null, capacity: 2, going: 2 });
    await expect(
      assertSeatAvailable(asClient(stub), EVENT_IDS.event, EVENT_IDS.user),
    ).rejects.toThrow(new Error("event_full"));
  });

  it("wydarzenie bez limitu przepuszcza nawet przy tłumie", async () => {
    const stub = gate({ mine: null, capacity: null, going: 10_000 });
    await expect(
      assertSeatAvailable(asClient(stub), EVENT_IDS.event, EVENT_IDS.user),
    ).resolves.toBeUndefined();
  });

  it("pełna sala WEDŁUG REGUŁY BAZY blokuje sprzedaż, choć pula legacy ma wolne", async () => {
    // Sedno poprawki: bramka sprzedaży biletu legacy liczyła tylko RSVP, więc
    // przy sali zapełnionej formularzem zgłoszeń sprzedawała miejsce, którego
    // nie ma. Teraz pyta tę samą regułę, co nagłówek strony.
    const stub = supabaseClientStub();
    stub.db.setResponse("event_rsvps", ok(null));
    stub.setRpc("event_seat_state", ok(seatStateRow({ capacity: 10, going: 2, seats_left: 0 })));
    await expect(
      assertSeatAvailable(asClient(stub), EVENT_IDS.event, EVENT_IDS.user),
    ).rejects.toThrow(new Error("event_full"));
  });

  it("awaria odczytu miejsc NIE jest `event_full` - zwrot po zapłacie jej nie łapie", async () => {
    // `refundIfOversold` zwraca pieniądze WYŁĄCZNIE na `event_full`; inny
    // wyjątek ponawia webhook. Awaria nie może więc ani przepuścić sprzedaży,
    // ani udawać kompletu.
    const stub = supabaseClientStub();
    stub.db.setResponse("event_rsvps", ok(null));
    stub.setRpc("event_seat_state", fail("permission denied for function event_seat_state"));
    const outcome = await assertSeatAvailable(asClient(stub), EVENT_IDS.event, EVENT_IDS.user).then(
      () => "przepuszczono",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(outcome).toMatch(/^seat_state_unavailable: /);
  });

  it("czyta WŁASNY wiersz RSVP - filtruje po wydarzeniu i po użytkowniku", async () => {
    // Bez obu filtrów bramka mogłaby przeczytać cudzą rezerwację i wpuścić
    // osobę bez miejsca (albo odwrotnie).
    const stub = gate({ mine: null, capacity: 5 });
    await assertSeatAvailable(asClient(stub), EVENT_IDS.event, EVENT_IDS.user);
    const chain = stub.db.lastChain("event_rsvps");
    const filters = chain?.calls.filter((call) => call.method === "eq").map((call) => call.args);
    expect(filters).toEqual([
      ["event_id", EVENT_IDS.event],
      ["user_id", EVENT_IDS.user],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Bilet zalogowanego użytkownika
// ---------------------------------------------------------------------------

/**
 * Tabela `payment_orders` w zachowaniu PostgREST: filtry `eq` (także ścieżka
 * JSON `metadata->>event_id`), sortowanie po `paid_at` malejąco, `limit`
 * i `maybeSingle`. Atrapa odpowiada TAK, JAK odpowiedziałaby baza na złożone
 * zapytanie - więc test dowodzi, że to zapytanie wybiera właściwe zamówienie,
 * a nie że kod przefiltruje cokolwiek, co dostanie.
 */
function ordersTable(rows: readonly PaymentOrderRow[]): (chain: RecordedChain) => SupabaseResult {
  return (chain) => {
    const filters = chain.calls.filter((call) => call.method === "eq").map((call) => call.args);
    let out = rows.filter((row) =>
      filters.every(([column, value]) => {
        if (column === "metadata->>event_id") return row.metadata?.["event_id"] === value;
        if (column === "status") return row.status === value;
        return true; // `user_id` - atrapa trzyma wyłącznie zamówienia wołającego
      }),
    );
    if (chain.has("order")) {
      out = [...out].sort((a, b) => Date.parse(b.paid_at ?? "") - Date.parse(a.paid_at ?? ""));
    }
    const limit = chain.argsOf("limit")?.[0];
    if (typeof limit === "number") out = out.slice(0, limit);
    return ok(chain.has("maybeSingle") ? (out[0] ?? null) : out);
  };
}

describe("loadMyEventTicket", () => {
  /** Pełny scenariusz czterech odczytów: RSVP -> wydarzenie -> zamówienia -> profil. */
  function ticketScenario(input: {
    rsvp?: { id: string; status: string } | null;
    event?: ReturnType<typeof eventRow> | null;
    orders?: unknown;
    profile?: ReturnType<typeof profileRow> | null;
  }): SupabaseClientStub {
    const stub = supabaseClientStub();
    stub.db.setResponse("event_rsvps", ok(input.rsvp === undefined ? rsvpRow() : input.rsvp));
    stub.db.setResponse("events", ok(input.event === undefined ? eventRow() : input.event));
    stub.db.setResponse(
      "payment_orders",
      Array.isArray(input.orders)
        ? ordersTable(input.orders as PaymentOrderRow[])
        : ok("orders" in input ? input.orders : null),
    );
    stub.db.setResponse("profiles", ok(input.profile === undefined ? profileRow() : input.profile));
    return stub;
  }

  it("bez wiersza RSVP nie ma biletu", async () => {
    const stub = ticketScenario({ rsvp: null });
    await expect(
      loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event),
    ).resolves.toBeNull();
  });

  it.each(["waitlist", "interested", "cancelled"])(
    "status %s nie daje biletu - wejściówkę ma tylko `going`",
    async (status) => {
      // Osoba z listy rezerwowej nie może dostać dokumentu, który wygląda jak
      // wejściówka. Kod QR prowadziłby do weryfikacji, która i tak ją odrzuci -
      // przy wejściu, po podróży.
      const stub = ticketScenario({ rsvp: rsvpRow({ status }) });
      await expect(
        loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event),
      ).resolves.toBeNull();
    },
  );

  it("brak wydarzenia nie daje biletu", async () => {
    const stub = ticketScenario({ event: null });
    await expect(
      loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event),
    ).resolves.toBeNull();
  });

  it("bilet bezpłatny wyprowadza numer z wiersza RSVP i nie ma danych płatności", async () => {
    const stub = ticketScenario({ orders: [] });
    const ticket = await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    expect(ticket).toMatchObject({
      transactionId: null,
      amountCents: null,
      currency: null,
      paidAt: null,
    });
    expect(ticket?.code).toBe(ticketCodeFrom(EVENT_IDS.rsvp));
  });

  it("bilet opłacony wyprowadza numer z ZAMÓWIENIA, nie z RSVP", async () => {
    // Numer biletu jest jednocześnie numerem, który obsługa zestawia z
    // płatnością. Dla biletu płatnego musi wskazywać zamówienie.
    const stub = ticketScenario({ orders: [paymentOrderRow()] });
    const ticket = await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    expect(ticket?.code).toBe(ticketCodeFrom(EVENT_IDS.order));
    expect(ticket).toMatchObject({
      transactionId: "pi_test_123",
      amountCents: 12000,
      currency: "PLN",
      paidAt: "2026-08-01T10:00:00.000Z",
    });
  });

  it("wybiera zamówienie TEGO wydarzenia, a nie najnowsze z listy", async () => {
    // Uczestnik dwóch płatnych wydarzeń nie może dostać na bilecie kwoty
    // i numeru transakcji z tego drugiego.
    const stub = ticketScenario({
      orders: [
        paymentOrderRow({
          id: EVENT_IDS.otherOrder,
          amount_cents: 99900,
          provider_intent_id: "pi_inne_wydarzenie",
          paid_at: "2026-08-10T10:00:00.000Z",
          metadata: { event_id: EVENT_IDS.otherEvent },
        }),
        paymentOrderRow(),
      ],
    });
    const ticket = await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    expect(ticket?.transactionId).toBe("pi_test_123");
    expect(ticket?.amountCents).toBe(12000);
    expect(ticket?.code).toBe(ticketCodeFrom(EVENT_IDS.order));
  });

  it("zamówienie starsze niż 20 nowszych zakupów NADAL trafia na bilet", async () => {
    // Najcenniejsza asercja pliku. Wcześniej brało się 20 ostatnich opłaconych
    // zamówień użytkownika i dopasowanie po `metadata.event_id` szło w pamięci:
    // członek, który po zakupie biletu opłacił składkę i kilka innych biletów,
    // dostawał bilet BEZ kwoty i z numerem z RSVP - a obsługa przy wejściu
    // nie miała jak zestawić go z płatnością.
    const newer = Array.from({ length: 25 }, (_, index) =>
      paymentOrderRow({
        id: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
        provider_intent_id: `pi_nowsze_${index}`,
        paid_at: new Date(Date.UTC(2026, 8, 1 + index, 10)).toISOString(),
        metadata: index % 2 === 0 ? { event_id: EVENT_IDS.otherEvent } : { plan: "membership" },
      }),
    );
    const stub = ticketScenario({ orders: [...newer, paymentOrderRow()] });
    const ticket = await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    expect(ticket?.transactionId).toBe("pi_test_123");
    expect(ticket?.code).toBe(ticketCodeFrom(EVENT_IDS.order));
  });

  it("dwa opłacone zamówienia tego wydarzenia - na bilecie stoi NAJNOWSZE", async () => {
    // Dzień później niż zamówienie z fikstury - bez nowego literału daty.
    const first = paymentOrderRow({ provider_intent_id: "pi_pierwsze" });
    const later = new Date(Date.parse(first.paid_at ?? "") + 86_400_000).toISOString();
    const stub = ticketScenario({
      orders: [
        first,
        paymentOrderRow({
          id: EVENT_IDS.otherOrder,
          provider_intent_id: "pi_ponowione",
          paid_at: later,
        }),
      ],
    });
    const ticket = await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    expect(ticket?.transactionId).toBe("pi_ponowione");
  });

  it("zamówienia innych wydarzeń nie robią z biletu bezpłatnego biletu płatnego", async () => {
    const stub = ticketScenario({
      orders: [paymentOrderRow({ metadata: { event_id: EVENT_IDS.otherEvent } })],
    });
    const ticket = await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    expect(ticket?.transactionId).toBeNull();
    expect(ticket?.code).toBe(ticketCodeFrom(EVENT_IDS.rsvp));
  });

  it("brak zamówienia czyta się jak bilet bezpłatny", async () => {
    const stub = ticketScenario({ orders: null });
    const ticket = await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    expect(ticket?.amountCents).toBeNull();
  });

  it("filtr wydarzenia, statusu i właściciela idzie DO BAZY, a nie do pamięci", async () => {
    const stub = ticketScenario({});
    await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    const chain = stub.db.lastChain("payment_orders");
    expect(chain?.calls.filter((call) => call.method === "eq").map((call) => call.args)).toEqual([
      ["user_id", EVENT_IDS.user],
      ["status", "paid"],
      // Ten sam filtr, którym `rsvp_event()` sprawdza opłacenie biletu.
      ["metadata->>event_id", EVENT_IDS.event],
    ]);
    expect(chain?.argsOf("order")).toEqual(["paid_at", { ascending: false, nullsFirst: false }]);
    expect(chain?.argsOf("limit")).toEqual([1]);
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  it("bez potwierdzonego miejsca nie pyta ani o zamówienie, ani o profil", async () => {
    const stub = ticketScenario({ rsvp: rsvpRow({ status: "waitlist" }) });
    await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    expect(stub.db.chainsFor("payment_orders")).toHaveLength(0);
    expect(stub.db.chainsFor("profiles")).toHaveLength(0);
  });

  it("posiadacza podpisuje imieniem i nazwiskiem", async () => {
    const stub = ticketScenario({});
    const ticket = await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    expect(ticket?.holderName).toBe("Anna Kowalska");
    expect(ticket?.holderEmail).toBe("anna@example.org");
  });

  it("samo imię nie zostawia spacji na końcu nazwiska", async () => {
    const stub = ticketScenario({ profile: profileRow({ last_name: null }) });
    expect(
      (await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event))?.holderName,
    ).toBe("Anna");
  });

  it("bez imienia i nazwiska podpisuje nazwą wyświetlaną", async () => {
    const stub = ticketScenario({
      profile: profileRow({ first_name: null, last_name: null }),
    });
    expect(
      (await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event))?.holderName,
    ).toBe("anna.k");
  });

  it("pusty profil daje bilet bez podpisu, a nie bilet z napisem `null`", async () => {
    const stub = ticketScenario({
      profile: profileRow({ first_name: null, last_name: null, display_name: null, email: null }),
    });
    const ticket = await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    expect(ticket?.holderName).toBeNull();
    expect(ticket?.holderEmail).toBeNull();
  });

  it("brak wiersza profilu nie blokuje wydania biletu", async () => {
    const stub = ticketScenario({ profile: null });
    const ticket = await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    expect(ticket).not.toBeNull();
    expect(ticket?.holderName).toBeNull();
  });

  it("przepisuje opis wydarzenia na bilet", async () => {
    const stub = ticketScenario({});
    const ticket = await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    expect(ticket).toMatchObject({
      eventId: EVENT_IDS.event,
      slug: "szczyt-energetyczny",
      titlePl: "Szczyt energetyczny",
      titleEn: "Energy summit",
      startsAt: "2026-09-01T08:00:00.000Z",
      endsAt: "2026-09-01T16:00:00.000Z",
      timezone: "Europe/Warsaw",
      location: "Bruksela",
    });
  });

  it("puste pola wydarzenia dają puste napisy, nie `undefined` na bilecie", async () => {
    const stub = ticketScenario({
      event: eventRow({ slug: "", title_pl: "", title_en: "", timezone: null, location: null }),
    });
    const ticket = await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    expect(ticket?.slug).toBe("");
    expect(ticket?.titlePl).toBe("");
    expect(ticket?.timezone).toBeNull();
  });

  it("NULL-e w kolumnach wydarzenia nie wyciekają na bilet jako `null`", async () => {
    // Wiersz z bazy może mieć NULL w każdej z tych kolumn (migracja dodająca
    // kolumnę zostawia NULL dla istniejących wierszy). Bez `?? ""` na bilecie
    // pojawiłby się napis „null" w miejscu tytułu, a `String(null)` to właśnie
    // „null", nie pusty napis - stąd asercja na PUSTY napis, nie na brak pola.
    const stub = ticketScenario({});
    stub.db.setResponse(
      "events",
      ok({
        id: EVENT_IDS.event,
        slug: null,
        title_pl: null,
        title_en: null,
        starts_at: null,
        ends_at: null,
        timezone: null,
        location: null,
      }),
    );
    const ticket = await loadMyEventTicket(asClient(stub), EVENT_IDS.user, EVENT_IDS.event);
    expect(ticket).toMatchObject({
      slug: "",
      titlePl: "",
      titleEn: "",
      startsAt: null,
      endsAt: null,
    });
  });
});
