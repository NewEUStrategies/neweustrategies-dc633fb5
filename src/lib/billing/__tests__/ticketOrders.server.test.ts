// Zamówienia biletowe w panelu administratora - 0 z 13 funkcji pokrytych
// do 31.08.2026.
//
// PO CO TEN PLIK ISTNIEJE. To jedyny ekran, na którym człowiek sprawdza, czy
// za bilet FAKTYCZNIE zapłacono: lista zamówień biletowych i oś czasu jednego
// zamówienia (utworzenie, zaksięgowanie, zdarzenia operatora). Moduł czyta
// świadomie klientem ZALOGOWANEGO ADMINA, nie rolą serwisową - RLS jest tu
// jedyną bramką tenanta, więc test nie może udawać, że widzi więcej.
//
// Ryzyko, którego pilnują poniższe testy, jest jednego rodzaju: CICHA UTRATA
// WIERSZA PIENIĘŻNEGO. Zamówienie, które wypadnie z listy albo z osi czasu,
// nie zgłasza się samo - reklamacja przychodzi od kupującego, a panel pokazuje
// wtedy pustkę. Dlatego każda gałąź „nie da się odczytać / nie da się
// dopasować" ma tu swój test, w parze ze ścieżką przejścia.
import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json, Tables } from "@/integrations/supabase/types";

import {
  BILLING_IDS,
  fail,
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
} from "@/test/billing/fixtures";
import { loadTicketOrderHistory, loadTicketOrders } from "@/lib/billing/ticketOrders.server";

/**
 * Kolumny czytane przez moduł, WYPROWADZONE z wygenerowanych typów - ta sama
 * zasada, co w samym module produkcyjnym. Ręczna kopia kształtu wiersza
 * rozjeżdżałaby się z bazą bez żadnego sygnału.
 */
type OrderRecord = Pick<
  Tables<"payment_orders">,
  | "id"
  | "user_id"
  | "anonymized_at"
  | "status"
  | "provider"
  | "provider_intent_id"
  | "amount_cents"
  | "currency"
  | "paid_at"
  | "created_at"
  | "metadata"
>;

/** Kształt wiersza `events`, jaki widzi słownik wydarzeń w module. */
interface EventRecord {
  id: string;
  slug: string | null;
  title_pl: string | null;
  title_en: string | null;
  starts_at: string | null;
}

/** Kształt wiersza `profiles`, jaki widzi słownik kupujących. */
interface ProfileRecord {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

/** Wiersz dziennika operatora dopasowywany po identyfikatorze transakcji. */
interface WebhookRecord {
  id: string;
  event_type: string;
  status: string;
  error: string | null;
  environment: string | null;
  occurred_at: string | null;
  created_at: string;
}

function ticketOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-ticket-1",
    user_id: BILLING_IDS.me,
    anonymized_at: null,
    status: "paid",
    provider: "stripe",
    provider_intent_id: "pi_syntetyczne_1",
    amount_cents: 12000,
    currency: "pln",
    paid_at: "2026-08-18T10:01:00.000Z",
    created_at: "2026-08-18T10:00:00.000Z",
    metadata: { event_id: "event-1", quantity: 2, coupon_code: "NES10" },
    ...overrides,
  };
}

function eventRecord(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event-1",
    slug: "decision-lab-2026",
    title_pl: "Decision Lab 2026",
    title_en: "Decision Lab 2026",
    starts_at: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

function profileRecord(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: BILLING_IDS.me,
    display_name: "Uczestnik Testowy",
    first_name: "Uczestnik",
    last_name: "Testowy",
    email: "uczestnik@example.com",
    ...overrides,
  };
}

function webhookRecord(overrides: Partial<WebhookRecord> = {}): WebhookRecord {
  return {
    id: "evt-row-1",
    event_type: "checkout.session.completed",
    status: "processed",
    error: null,
    environment: "sandbox",
    occurred_at: "2026-08-18T10:00:30.000Z",
    created_at: "2026-08-18T10:00:31.000Z",
    ...overrides,
  };
}

let chain: SupabaseFromStub;

/**
 * Atrapa klienta w typie, jakiego oczekuje moduł.
 *
 * `as never`, a NIE `as unknown as`: to konwencja tego repo dla atrapy klienta
 * Supabase (patrz `paymentOrders.server.test.ts`). `SupabaseClient` jest klasą
 * z dziesiątkami metod, których ten moduł nigdy nie dotyka, więc odtwarzanie
 * jej strukturalnie nic by nie dowiodło - a `as unknown as` jest w tym repo
 * pod ratchetem bramki `check:unknown-casts`.
 */
const client = (): SupabaseClient => ({ from: (table: string) => chain.from(table) }) as never;

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("payment_orders", ok([ticketOrder()]));
  chain.setResponse("events", ok([eventRecord()]));
  chain.setResponse("profiles", ok([profileRecord()]));
  chain.setResponse("payment_webhook_events", ok([]));
});

// ---------------------------------------------------------------------------
// loadTicketOrders - kontrakt zapytania
// ---------------------------------------------------------------------------

describe("loadTicketOrders - kontrakt zapytania", () => {
  it("pyta WYŁĄCZNIE o zamówienia jednorazowe z metadanymi biletu, najnowsze pierwsze", async () => {
    // Gdyby zniknął filtr `kind`, panel biletowy pokazałby faktury
    // subskrypcyjne; gdyby zniknął filtr metadanych - każde zamówienie sklepu.
    await loadTicketOrders(client(), 25);

    const query = chain.lastChain("payment_orders")!;
    expect(query.argsOf("eq")).toEqual(["kind", "one_time"]);
    expect(query.argsOf("not")).toEqual(["metadata->>event_id", "is", null]);
    expect(query.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(query.argsOf("limit")).toEqual([25]);
  });

  it("ODMOWA ODCZYTU jest zgłaszana, nie zamieniana na pustą listę", async () => {
    // Cichy `[]` przy odmowie RLS wygląda dokładnie tak samo jak „brak
    // sprzedaży" - administrator zamknąłby reklamację na podstawie pustki.
    chain.setResponse("payment_orders", fail("permission denied for table payment_orders"));

    await expect(loadTicketOrders(client(), 50)).rejects.toThrow(
      "permission denied for table payment_orders",
    );
  });

  it("brak zamówień kończy pracę bez dopytywania słowników", async () => {
    // Także wtedy, gdy PostgREST odda `null` zamiast pustej tablicy - to ten
    // sam stan „nie ma czego pokazać", a nie powód do wyjątku.
    for (const empty of [ok([]), ok(null)]) {
      chain.setResponse("payment_orders", empty);
      await expect(loadTicketOrders(client(), 50)).resolves.toEqual([]);
    }
    expect(chain.chainsFor("events")).toHaveLength(0);
    expect(chain.chainsFor("profiles")).toHaveLength(0);
  });

  it("słowniki dociąga JEDNYM zapytaniem po unikalnych identyfikatorach", async () => {
    chain.setResponse(
      "payment_orders",
      ok([
        ticketOrder({ id: "o1", metadata: { event_id: "event-1" } }),
        ticketOrder({ id: "o2", metadata: { event_id: "event-1" } }),
        ticketOrder({ id: "o3", user_id: BILLING_IDS.other, metadata: { event_id: "event-2" } }),
      ]),
    );

    await loadTicketOrders(client(), 50);

    expect(chain.chainsFor("events")).toHaveLength(1);
    expect(chain.chainsFor("profiles")).toHaveLength(1);
    expect(chain.lastChain("events")!.argsOf("in")).toEqual(["id", ["event-1", "event-2"]]);
    expect(chain.lastChain("profiles")!.argsOf("in")).toEqual([
      "id",
      [BILLING_IDS.me, BILLING_IDS.other],
    ]);
  });
});

// ---------------------------------------------------------------------------
// loadTicketOrders - odwzorowanie wiersza
// ---------------------------------------------------------------------------

describe("loadTicketOrders - odwzorowanie wiersza", () => {
  it("przepisuje zamówienie na kształt czytelny dla panelu", async () => {
    const rows = await loadTicketOrders(client(), 50);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "order-ticket-1",
      createdAt: "2026-08-18T10:00:00.000Z",
      paidAt: "2026-08-18T10:01:00.000Z",
      status: "paid",
      provider: "stripe",
      transactionId: "pi_syntetyczne_1",
      amountCents: 12000,
      // Waluta z bazy bywa małymi literami - panel pokazuje ją wielkimi.
      currency: "PLN",
      tickets: 2,
      couponCode: "NES10",
      buyerId: BILLING_IDS.me,
      buyerName: "Uczestnik Testowy",
      buyerEmail: "uczestnik@example.com",
      buyerAnonymized: false,
      eventId: "event-1",
      eventTitlePl: "Decision Lab 2026",
      eventSlug: "decision-lab-2026",
      eventStartsAt: "2026-09-01T08:00:00.000Z",
    });
  });

  it("pusta waluta schodzi na PLN zamiast zostawiać pustą kolumnę kwoty", async () => {
    chain.setResponse("payment_orders", ok([ticketOrder({ currency: "" })]));

    const rows = await loadTicketOrders(client(), 50);

    expect(rows[0].currency).toBe("PLN");
  });

  it("liczba biletów: brak, zero, wartość ujemna i tekst schodzą na jeden bilet", async () => {
    // ODMOWA ZGADYWANIA. Jeden RSVP na konto jest regułą produktu, więc każda
    // wartość, której nie da się odczytać jako dodatniej liczby, MUSI dać 1 -
    // a nie `NaN` w kolumnie „bilety" ani zero, które ukrywa sprzedaż.
    const cases: Array<[Json, number]> = [
      [{ event_id: "event-1" }, 1],
      [{ event_id: "event-1", quantity: 0 }, 1],
      [{ event_id: "event-1", quantity: -3 }, 1],
      [{ event_id: "event-1", quantity: "trzy" }, 1],
      [{ event_id: "event-1", quantity: null }, 1],
      [{ event_id: "event-1", quantity: "3" }, 3],
      [{ event_id: "event-1", quantity: 2.9 }, 2],
    ];

    for (const [metadata, expected] of cases) {
      chain.setResponse("payment_orders", ok([ticketOrder({ metadata })]));
      const rows = await loadTicketOrders(client(), 50);
      expect(rows[0].tickets, JSON.stringify(metadata)).toBe(expected);
    }
  });

  it("kod rabatowy złożony z samych spacji jest traktowany jak jego brak", async () => {
    chain.setResponse(
      "payment_orders",
      ok([ticketOrder({ metadata: { event_id: "event-1", coupon_code: "   " } })]),
    );

    const rows = await loadTicketOrders(client(), 50);

    expect(rows[0].couponCode).toBeNull();
  });

  it("nazwa kupującego: pseudonim, potem imię i nazwisko, na końcu brak nazwy", async () => {
    const cases: Array<[Partial<ProfileRecord>, string | null]> = [
      [{}, "Uczestnik Testowy"],
      [{ display_name: "   " }, "Uczestnik Testowy"],
      [{ display_name: null, last_name: null }, "Uczestnik"],
      [{ display_name: null, first_name: null, last_name: null }, null],
    ];

    for (const [overrides, expected] of cases) {
      chain.setResponse("profiles", ok([profileRecord(overrides)]));
      const rows = await loadTicketOrders(client(), 50);
      expect(rows[0].buyerName, JSON.stringify(overrides)).toBe(expected);
    }
  });

  it("zamówienie po anonimizacji RODO nie szuka kupującego i mówi o tym wprost", async () => {
    // ODMOWA DOPYTANIA. Konto usunięte - zamówienie żyje jako dowód księgowy,
    // ale nie wolno go z nikim wiązać. `.in("id", [])` zamiast NULL-a.
    chain.setResponse(
      "payment_orders",
      ok([ticketOrder({ user_id: null, anonymized_at: "2026-08-20T00:00:00.000Z" })]),
    );

    const rows = await loadTicketOrders(client(), 50);

    expect(rows[0]).toMatchObject({
      buyerId: null,
      buyerName: null,
      buyerEmail: null,
      buyerAnonymized: true,
    });
    expect(chain.lastChain("profiles")!.argsOf("in")).toEqual(["id", []]);
  });

  it("wydarzenie niewidoczne dla admina degraduje pola wydarzenia, ale NIE gubi zamówienia", async () => {
    // Pieniądze są ważniejsze niż etykieta: brak wiersza `events` (skasowane
    // wydarzenie, wąska polityka) nie może wymazać dowodu zapłaty.
    chain.setResponse("events", ok([]));

    const rows = await loadTicketOrders(client(), 50);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventId: "event-1",
      eventTitlePl: null,
      eventTitleEn: null,
      eventSlug: null,
      eventStartsAt: null,
    });
  });

  it("awaria słownika kupujących degraduje nazwę, a nie całą listę", async () => {
    chain.setResponse("profiles", fail("permission denied for table profiles"));

    const rows = await loadTicketOrders(client(), 50);

    expect(rows).toHaveLength(1);
    expect(rows[0].buyerName).toBeNull();
    expect(rows[0].buyerEmail).toBeNull();
  });

  it("awaria słownika wydarzeń też degraduje etykiety, a nie dowód zapłaty", async () => {
    chain.setResponse("events", fail("permission denied for table events"));

    const rows = await loadTicketOrders(client(), 50);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventId: "event-1", eventTitlePl: null, eventSlug: null });
    expect(rows[0].amountCents).toBe(12000);
  });

  it("CUDZY PROFIL w odpowiedzi słownika nie podszywa się pod kupującego", async () => {
    // Dopasowanie idzie po identyfikatorze, nie po kolejności - inaczej jeden
    // rozjazd w zapytaniu przypisałby cudze nazwisko do cudzej płatności.
    chain.setResponse(
      "profiles",
      ok([
        profileRecord({
          id: BILLING_IDS.other,
          display_name: "Ktoś Inny",
          email: "inny@example.org",
        }),
      ]),
    );

    const rows = await loadTicketOrders(client(), 50);

    expect(rows[0].buyerName).toBeNull();
    expect(rows[0].buyerEmail).toBeNull();
  });

  it("CUDZE WYDARZENIE w odpowiedzi słownika nie podmienia nazwy biletu", async () => {
    chain.setResponse(
      "events",
      ok([eventRecord({ id: "event-obce", title_pl: "Cudza konferencja" })]),
    );

    const rows = await loadTicketOrders(client(), 50);

    expect(rows[0].eventTitlePl).toBeNull();
    expect(rows[0].eventId).toBe("event-1");
  });
});

// ---------------------------------------------------------------------------
// loadTicketOrders - metadane spoza kontraktu
// ---------------------------------------------------------------------------

describe("loadTicketOrders - metadane spoza kontraktu", () => {
  it("metadane jako tablica albo liczba nie wywracają odczytu", async () => {
    // `metadata` jest kolumną `jsonb`, więc jej typem jest `Json` - także
    // tablica i liczba. Taki wiersz nie ma `event_id` ani po stronie SQL
    // (`->>'event_id'` daje NULL), ani tutaj, więc jego brak na liście jest
    // spójny z filtrem zapytania. Test pilnuje, że nie leci wyjątek.
    chain.setResponse(
      "payment_orders",
      ok([
        ticketOrder({ id: "o-tablica", metadata: ["event-1"] }),
        ticketOrder({ id: "o-liczba", metadata: 7 }),
      ]),
    );

    await expect(loadTicketOrders(client(), 50)).resolves.toEqual([]);
  });

  it("bilet z LICZBOWYM `event_id` zostaje na liście, a nie znika bez śladu", async () => {
    // DEFEKT NAPRAWIONY 31.08.2026 (`ticketOrders.server.ts`).
    //
    // CO BYŁO ZŁE. Zapytanie przepuszcza wiersz filtrem SQL
    // `metadata->>'event_id' IS NOT NULL` - a operator `->>` rzutuje na tekst,
    // więc `{"event_id": 42}` daje `'42'` i wiersz DOJEŻDŻAŁ do warstwy TS.
    // Tam `str()` żądał `typeof value === "string"`, dostawał liczbę, zwracał
    // `null`, a `flatMap` odrzucał całe zamówienie. Filtr bazy i zawężenie
    // w TypeScripcie mówiły więc DWIE RÓŻNE RZECZY o tym samym wierszu.
    //
    // JAKIE TO BYŁO RYZYKO. Zamówienie znikało z jedynego ekranu, na którym
    // ktokolwiek je zobaczy - bez wyjątku, bez ostrzeżenia, bez pozycji
    // w logu. Kupujący miał potwierdzenie zapłaty, panel nie miał zamówienia,
    // a uzgodnienie księgowe pokazywało różnicę, której nie dało się
    // wytłumaczyć. Nagłówek modułu produkcyjnego opisywał DOKŁADNIE ten objaw
    // („zamówienie z nietypowym ładunkiem gubiło `event_id` i wypadało z listy
    // bez śladu") i deklarował, że jawne zawężenie go zamyka - zawężenie
    // naprawiło TYP, ale nie zamknęło cichego zniknięcia.
    //
    // JAK ZOSTAŁO NAPRAWIONE. Osobny czytnik `eventIdOf` czyta to pole tak,
    // jak czyta je baza: liczbę zamienia na tekst (`->>`), pozostałe kształty
    // odrzuca. Wybrane rozwiązanie to WIDOCZNY wiersz, a nie głośna odmowa:
    // taki identyfikator nie dopasuje się do żadnego wydarzenia (klucze są
    // UUID-ami), więc zamówienie pojawia się bez nazwy wydarzenia - da się je
    // zobaczyć i wyjaśnić, zamiast szukać go po zgłoszeniu kupującego.
    chain.setResponse(
      "payment_orders",
      ok([ticketOrder({ id: "order-liczbowy", metadata: { event_id: 42, quantity: 1 } })]),
    );

    const rows = await loadTicketOrders(client(), 50);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("order-liczbowy");
  });

  it("liczbowy identyfikator jest przepisany na tekst - dokładnie jak robi to `->>`", async () => {
    chain.setResponse(
      "payment_orders",
      ok([ticketOrder({ id: "order-liczbowy", metadata: { event_id: 42, quantity: 1 } })]),
    );

    const rows = await loadTicketOrders(client(), 50);

    expect(rows[0].eventId).toBe("42");
    // Nazwa wydarzenia zostaje pusta - nic w bazie nie ma takiego klucza.
    // To jest cena za widoczność wiersza i musi być jawna, a nie domyślana.
    expect(rows[0].eventTitlePl).toBeNull();
  });

  it("wartość logiczna i pusty tekst NIE są identyfikatorem - te wiersze dalej odpadają", async () => {
    // Granica poprawki: dopuszczamy liczbę (bo `->>` daje z niej sensowny
    // tekst), a nie „cokolwiek da się zamienić na napis". `true` czy `""` nie
    // wskazują żadnego wydarzenia, więc udawanie, że wskazują, byłoby gorsze
    // niż odrzucenie.
    chain.setResponse(
      "payment_orders",
      ok([
        ticketOrder({ id: "o-bool", metadata: { event_id: true } }),
        ticketOrder({ id: "o-pusty", metadata: { event_id: "   " } }),
        ticketOrder({ id: "o-obiekt", metadata: { event_id: { id: "event-1" } } }),
      ]),
    );

    await expect(loadTicketOrders(client(), 50)).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// loadTicketOrderHistory
// ---------------------------------------------------------------------------

describe("loadTicketOrderHistory", () => {
  beforeEach(() => {
    chain.setResponse(
      "payment_orders",
      ok({
        id: "order-ticket-1",
        status: "paid",
        created_at: "2026-08-18T10:00:00.000Z",
        paid_at: "2026-08-18T10:02:00.000Z",
        provider_intent_id: "pi_syntetyczne_1",
      }),
    );
  });

  it("zawęża oś czasu do JEDNEGO zamówienia", async () => {
    await loadTicketOrderHistory(client(), "order-ticket-1");

    expect(chain.lastChain("payment_orders")!.argsOf("eq")).toEqual(["id", "order-ticket-1"]);
    expect(chain.lastChain("payment_orders")!.has("maybeSingle")).toBe(true);
  });

  it("CUDZE / NIEISTNIEJĄCE zamówienie daje pustą oś czasu i NIE pyta o zdarzenia operatora", async () => {
    // RLS oddaje `null` zamiast błędu, gdy zamówienie należy do innego tenanta.
    // Wtedy nie wolno dopytywać dziennika operatora - dopasowanie idzie po
    // identyfikatorze transakcji, którego w takim przypadku po prostu nie znamy.
    chain.setResponse("payment_orders", ok(null));

    await expect(loadTicketOrderHistory(client(), "order-cudze")).resolves.toEqual([]);
    expect(chain.chainsFor("payment_webhook_events")).toHaveLength(0);
  });

  it("ODMOWA ODCZYTU zamówienia jest zgłaszana, nie zamieniana na pustą oś", async () => {
    chain.setResponse("payment_orders", fail("permission denied for table payment_orders"));

    await expect(loadTicketOrderHistory(client(), "order-ticket-1")).rejects.toThrow(
      "permission denied for table payment_orders",
    );
  });

  it("zamówienie NIEOPŁACONE ma wyłącznie wpis utworzenia", async () => {
    chain.setResponse(
      "payment_orders",
      ok({
        id: "order-ticket-1",
        status: "pending",
        created_at: "2026-08-18T10:00:00.000Z",
        paid_at: null,
        provider_intent_id: null,
      }),
    );

    const entries = await loadTicketOrderHistory(client(), "order-ticket-1");

    expect(entries).toEqual([
      {
        id: "order-ticket-1:created",
        kind: "order_created",
        label: "order_created",
        status: "pending",
        at: "2026-08-18T10:00:00.000Z",
        error: null,
        environment: null,
      },
    ]);
  });

  it("bez identyfikatora transakcji NIE odpytuje dziennika operatora", async () => {
    chain.setResponse(
      "payment_orders",
      ok({
        id: "order-ticket-1",
        status: "paid",
        created_at: "2026-08-18T10:00:00.000Z",
        paid_at: "2026-08-18T10:02:00.000Z",
        provider_intent_id: null,
      }),
    );

    const entries = await loadTicketOrderHistory(client(), "order-ticket-1");

    expect(entries.map((e) => e.kind)).toEqual(["order_created", "order_paid"]);
    expect(chain.chainsFor("payment_webhook_events")).toHaveLength(0);
  });

  it("dopasowuje zdarzenia operatora po identyfikatorze transakcji z zamówienia", async () => {
    chain.setResponse("payment_webhook_events", ok([webhookRecord()]));

    const entries = await loadTicketOrderHistory(client(), "order-ticket-1");

    const query = chain.lastChain("payment_webhook_events")!;
    expect(query.argsOf("eq")).toEqual(["payload->data->>id", "pi_syntetyczne_1"]);
    expect(query.argsOf("order")).toEqual(["created_at", { ascending: true }]);
    expect(query.argsOf("limit")).toEqual([50]);
    expect(entries.map((e) => e.kind)).toEqual(["order_created", "webhook", "order_paid"]);
  });

  it("zdarzenie bez pól diagnostycznych nie wywraca osi czasu", async () => {
    // Dziennik operatora jest tabelą historyczną - starsze wiersze bywają bez
    // `error` i bez `environment`. Panel ma pokazać wpis, a nie `undefined`.
    chain.setResponse(
      "payment_webhook_events",
      ok([
        {
          id: "evt-stary",
          event_type: "checkout.session.completed",
          status: "processed",
          occurred_at: "2026-08-18T10:00:30.000Z",
          created_at: "2026-08-18T10:00:31.000Z",
        },
      ]),
    );

    const entries = await loadTicketOrderHistory(client(), "order-ticket-1");

    expect(entries[1]).toMatchObject({ id: "evt-stary", error: null, environment: null });
  });

  it("zdarzenie bez czasu wystąpienia jest datowane momentem zapisu", async () => {
    chain.setResponse(
      "payment_webhook_events",
      ok([webhookRecord({ occurred_at: null, created_at: "2026-08-18T10:00:45.000Z" })]),
    );

    const entries = await loadTicketOrderHistory(client(), "order-ticket-1");

    expect(entries[1]).toMatchObject({ kind: "webhook", at: "2026-08-18T10:00:45.000Z" });
  });

  it("oś czasu jest rosnąca niezależnie od kolejności zwróconej przez bazę", async () => {
    chain.setResponse(
      "payment_webhook_events",
      ok([
        webhookRecord({ id: "evt-pozne", occurred_at: "2026-08-18T10:05:00.000Z" }),
        webhookRecord({
          id: "evt-wczesne",
          occurred_at: "2026-08-18T09:59:00.000Z",
          status: "failed",
          error: "signature mismatch",
        }),
      ]),
    );

    const entries = await loadTicketOrderHistory(client(), "order-ticket-1");

    expect(entries.map((e) => e.id)).toEqual([
      "evt-wczesne",
      "order-ticket-1:created",
      "order-ticket-1:paid",
      "evt-pozne",
    ]);
    expect(entries[0]).toMatchObject({ status: "failed", error: "signature mismatch" });
  });

  it("ODMOWA ODCZYTU dziennika operatora jest zgłaszana, a nie przemilczana", async () => {
    // DEFEKT NAPRAWIONY 31.08.2026 (`ticketOrders.server.ts`).
    //
    // CO BYŁO ZŁE. Odczyt `payment_webhook_events` destrukturyzował wyłącznie
    // `data` (`const { data: events } = await ...`), więc `error` znikał. Gdy
    // baza ODMÓWIŁA (polityka, literówka w nazwie kolumny, awaria), moduł
    // budował oś czasu z samych własnych znaczników i oddawał ją jako komplet.
    //
    // JAKIE TO BYŁO RYZYKO. Oś czasu jest narzędziem DIAGNOSTYCZNYM: człowiek
    // patrzy na nią dokładnie wtedy, gdy pyta „czy webhook w ogóle
    // przyszedł?". Pusta lista zdarzeń operatora odpowiadała „nie przyszedł" -
    // i to jest odpowiedź nieprawdziwa, na podstawie której obsługa zwraca
    // pieniądze albo wystawia bilet drugi raz. Ten sam wzorzec (odrzucony
    // `error` przy dociąganiu słownika) był już w tym repo DEFEKTEM
    // naprawionym w `paymentOrders.server.ts` - patrz bramka
    // „BŁĄD ODCZYTU PLANÓW jest zgłaszany" w `paymentOrders.server.test.ts`.
    //
    // JAK ZOSTAŁO NAPRAWIONE. Wybrano zgłoszenie wyjątku - spójnie z odczytem
    // samego zamówienia w tej samej funkcji i z bliźniaczym modułem zamówień
    // płatniczych. Panel pokazuje wtedy błąd wczytywania historii (ma na to
    // gotowy komunikat `adminBilling.couldLoadHistory`), czyli „nie wiemy",
    // a nie „nic nie przyszło". Wpis diagnostyczny w samej osi czasu wymagałby
    // nowego rodzaju wpisu w kontrakcie `TicketOrderHistoryEntry` i nowych
    // tłumaczeń, a niósłby dokładnie tę samą informację.
    chain.setResponse(
      "payment_webhook_events",
      fail("permission denied for table payment_webhook_events"),
    );

    await expect(loadTicketOrderHistory(client(), "order-ticket-1")).rejects.toThrow(
      "permission denied for table payment_webhook_events",
    );
  });
});
