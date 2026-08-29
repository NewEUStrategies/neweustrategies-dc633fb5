// Bilet wliczony w plan - JEDNO WEJŚCIE do RPC `my_ticket_allowance`.
//
// CZEGO TU NIE MA. Reguły liczenia (bilet bije zniżkę, zaokrąglenie w dół na
// korzyść kupującego, zawężenie `Json` do kontraktu) mają własny plik
// `ticketAllowance.test.ts` i tutaj ich NIE powtarzamy. Ta warstwa odpowiada za
// trzy rzeczy, których tamten plik nie dotyka, bo nie zna bazy:
//
//   1. KIERUNEK DEGRADACJI. Awaria RPC oddaje PUSTĄ pulę. Odwrócenie tego
//      kierunku - wyjątek przepuszczony do kasy albo pula domyślnie niepusta -
//      rozdaje darmowe wejściówki przy każdym błędzie bazy: `ticketAmountCents`
//      z pustą pulą daje pełną cenę, a z `remaining: 1` daje ZERO. To jedyna
//      różnica, a kosztuje dokładnie cenę biletu razy liczba kupujących.
//   2. CZYJ TO KLIENT. RPC czyta `auth.uid()`, więc pula liczy się z sesji
//      WOŁAJĄCEGO. Zapytanie musi pójść wstrzykniętym klientem, dokładnie raz
//      i bez argumentów - klient nigdy nie podaje, czyją pulę odczytać.
//   3. CO JEDZIE DO KASY. `ticketPriceForCaller` oddaje kwotę RAZEM z pulą, bo
//      zero groszy znaczy dwie różne rzeczy: „wydarzenie bezpłatne" i „pokryte
//      pulą, idź przez `rsvp_event`, które pulę skonsumuje". Sama kwota tego
//      nie rozróżnia, więc gubienie `allowance` po drodze sprzedawałoby bilet
//      za 0 zł zamiast go z puli odliczyć.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, supabaseClientStub, type SupabaseClientStub } from "@/test/events/fixtures";
import { EMPTY_TICKET_ALLOWANCE } from "@/lib/events/ticketAllowance";
import { loadTicketAllowance, ticketPriceForCaller } from "@/lib/events/ticketAllowance.server";

/** Atrapa klienta w typie, którego oczekuje warstwa serwerowa. */
function asClient(stub: SupabaseClientStub): SupabaseClient {
  return stub.client as unknown as SupabaseClient;
}

/** Cena katalogowa używana we wszystkich scenariuszach wyceny: 300,00 zł. */
const FACE_VALUE_CENTS = 30000;

const ORG_ID = "11111111-1111-4111-8111-111111111111";

/** Podstawiane pod `console.error` - diagnostyka nie zaśmieca logu testów. */
const errorLog = vi.fn();

beforeEach(() => {
  errorLog.mockReset();
  vi.spyOn(console, "error").mockImplementation(errorLog);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadTicketAllowance", () => {
  it("pyta o pulę klientem WOŁAJĄCEGO, dokładnie raz i bez argumentów", async () => {
    // RPC ustala członka przez `auth.uid()`. Gdyby wywołanie przyjęło argument
    // (np. identyfikator użytkownika), kasa mogłaby odczytać cudzą pulę;
    // gdyby poszło klientem serwisowym, `auth.uid()` byłoby puste i KAŻDY
    // członek zobaczyłby „brak benefitów" mimo opłaconego planu.
    const stub = supabaseClientStub();
    stub.setRpc("my_ticket_allowance", ok({ granted: 1, used: 0, scope: "personal" }));

    await loadTicketAllowance(asClient(stub));

    expect(stub.rpcCalls).toEqual([{ fn: "my_ticket_allowance", args: undefined }]);
  });

  it("zawęża odpowiedź RPC regułami rdzenia, zamiast oddawać ją wprost", async () => {
    // Baza podaje `remaining` obok `granted`/`used`, a rdzeń liczy je sam.
    // Gdyby warstwa serwerowa zwracała `data` bez zawężenia, ta rozjechana
    // wartość (99) pojechałaby do kasy i pokryłaby 99 biletów z puli na 3.
    const stub = supabaseClientStub();
    stub.setRpc(
      "my_ticket_allowance",
      ok({
        granted: 3,
        used: 1,
        remaining: 99,
        discount_pct: 50,
        scope: "organisation",
        org_id: ORG_ID,
        period_start: "2026-03-01",
        period_end: "2027-03-01",
      }),
    );

    expect(await loadTicketAllowance(asClient(stub))).toEqual({
      granted: 3,
      used: 1,
      remaining: 2,
      discountPct: 50,
      scope: "organisation",
      orgId: ORG_ID,
      periodStart: "2026-03-01",
      periodEnd: "2027-03-01",
    });
  });

  it("błąd RPC daje PUSTĄ pulę zamiast wyjątku - awaria bazy nie blokuje zakupu", async () => {
    // Wołający (karta wydarzenia, kasa, zamówienie ad-hoc) nie ma gałęzi na
    // wyjątek. Rzucenie tutaj wywraca stronę wydarzenia, a bilet jest
    // benefitem, nie warunkiem wyświetlenia strony.
    const stub = supabaseClientStub();
    stub.setRpc("my_ticket_allowance", fail("permission denied for function", "42501"));

    expect(await loadTicketAllowance(asClient(stub))).toEqual(EMPTY_TICKET_ALLOWANCE);
  });

  it("błąd RPC zostawia w logu komunikat bazy, a nie ogólnikowy napis", async () => {
    // Degradacja jest CICHA dla użytkownika (płaci pełną cenę i nie wie, że
    // stracił benefit), więc log serwera jest jedynym śladem, po którym da się
    // to wykryć. Utrata `error.message` zamienia diagnozę w zgadywanie.
    const stub = supabaseClientStub();
    stub.setRpc("my_ticket_allowance", fail("relation memberships does not exist", "42P01"));

    await loadTicketAllowance(asClient(stub));

    expect(errorLog).toHaveBeenCalledWith(
      "[tickets] my_ticket_allowance failed",
      "relation memberships does not exist",
    );
  });

  it("sesja anonimowa (RPC bez `auth.uid()` oddaje NULL) to pusta pula, nie wyjątek", async () => {
    // Strona publiczna wydarzenia renderuje się także bez logowania. `null`
    // z RPC musi znaczyć „brak benefitów", a nie „wywal render".
    const stub = supabaseClientStub();
    stub.setRpc("my_ticket_allowance", ok(null));

    expect(await loadTicketAllowance(asClient(stub))).toEqual(EMPTY_TICKET_ALLOWANCE);
  });

  it("odpowiedź niepełna (obiekt bez pól) nie tworzy puli z niczego", async () => {
    // Migracja, która doda kolumnę pod nową nazwą, przestaje wypełniać stare
    // pola. Bezpieczny wynik to pusta pula - pełna cena - a nie zera czytane
    // jako „bilet przysługuje".
    const stub = supabaseClientStub();
    stub.setRpc("my_ticket_allowance", ok({}));

    expect(await loadTicketAllowance(asClient(stub))).toEqual(EMPTY_TICKET_ALLOWANCE);
  });

  it("limit rozliczony ponad miarę (`used` > `granted`) daje pulę pustą, nie ujemną", async () => {
    // Liczniki potrafią się rozjechać bez niczyjej złej woli: plan obniżony po
    // wykorzystaniu biletu, korekta limitu wstecz, migracja przenosząca
    // historię. Wynik ma być „nic nie zostało", a nie liczba ujemna - ta
    // jedzie dalej do licznika na karcie członka i do kwoty w kasie, a każde
    // porównanie w górę stosu zaczyna wtedy operować wartością spoza kontraktu.
    const stub = supabaseClientStub();
    stub.setRpc("my_ticket_allowance", ok({ granted: 1, used: 5, scope: "personal" }));

    const allowance = await loadTicketAllowance(asClient(stub));

    expect(allowance).toMatchObject({ granted: 1, used: 5, remaining: 0 });
  });

  it("puste napisy okresu nie udają otwartego okna członkowskiego", async () => {
    // `period_start`/`period_end` jadą wprost do interfejsu („bilet ważny
    // do..."). Napis pusty albo z samych spacji wyrenderowałby się jako pusta
    // data zamiast jako brak okresu, więc kontrakt zna tu wyłącznie `null`
    // albo napis niepusty - nic pomiędzy.
    const stub = supabaseClientStub();
    stub.setRpc(
      "my_ticket_allowance",
      ok({ granted: 1, used: 0, scope: "personal", period_start: "   ", period_end: "" }),
    );

    const allowance = await loadTicketAllowance(asClient(stub));

    expect(allowance.periodStart).toBeNull();
    expect(allowance.periodEnd).toBeNull();
  });
});

describe("ticketPriceForCaller", () => {
  it("bez benefitów kasa pobiera cenę katalogową", async () => {
    const stub = supabaseClientStub();
    stub.setRpc("my_ticket_allowance", ok({ granted: 0, used: 0, scope: "none" }));

    expect(await ticketPriceForCaller(asClient(stub), FACE_VALUE_CENTS)).toEqual({
      amountCents: FACE_VALUE_CENTS,
      allowance: EMPTY_TICKET_ALLOWANCE,
    });
  });

  it("bilet z puli daje zero groszy, ale ODDAJE też pulę - kasa musi odróżnić to od gratisu", async () => {
    // Wołający (`checkout.functions.ts`, `adhocCheckoutOrder.server.ts`) na
    // podstawie `allowance` decyduje, czy w ogóle zakładać zamówienie. Gdyby
    // funkcja oddawała samą kwotę, zero groszy wyglądałoby jak wydarzenie
    // bezpłatne i bilet NIGDY nie zostałby odliczony od puli.
    const stub = supabaseClientStub();
    stub.setRpc("my_ticket_allowance", ok({ granted: 1, used: 0, scope: "personal" }));

    const priced = await ticketPriceForCaller(asClient(stub), FACE_VALUE_CENTS);

    expect(priced.amountCents).toBe(0);
    expect(priced.allowance.remaining).toBe(1);
    expect(priced.allowance.scope).toBe("personal");
  });

  it("zniżka planu liczy się od ceny podanej przez serwer", async () => {
    // Cena wejściowa pochodzi z `events.ticket_price_cents`, nie z żądania -
    // ten test pilnuje, że przekazana kwota faktycznie wchodzi do rachunku,
    // a nie jest gubiona na rzecz jakiejś wartości domyślnej.
    const stub = supabaseClientStub();
    stub.setRpc("my_ticket_allowance", ok({ granted: 0, used: 0, discount_pct: 50 }));

    const priced = await ticketPriceForCaller(asClient(stub), FACE_VALUE_CENTS);

    expect(priced.amountCents).toBe(15000);
    expect(priced.allowance.discountPct).toBe(50);
  });

  it("awaria RPC w trakcie wyceny daje PEŁNĄ cenę, nigdy darmowy bilet", async () => {
    // Najdroższy możliwy błąd w tym module. Gdyby degradacja szła w drugą
    // stronę, jedna awaria `my_ticket_allowance` wypuszczałaby wejściówki za
    // darmo każdemu, kto akurat kliknął „Kup bilet".
    const stub = supabaseClientStub();
    stub.setRpc("my_ticket_allowance", fail("statement timeout", "57014"));

    const priced = await ticketPriceForCaller(asClient(stub), FACE_VALUE_CENTS);

    expect(priced.amountCents).toBe(FACE_VALUE_CENTS);
    expect(priced.allowance).toEqual(EMPTY_TICKET_ALLOWANCE);
  });

  it("wydarzenie bezpłatne nie kosztuje nic nawet przy pustej puli", async () => {
    // `faceValueCents <= 0` musi dać 0, a nie NaN ani cenę ujemną - kasa
    // przekazuje tę liczbę wprost do dostawcy płatności.
    const stub = supabaseClientStub();
    stub.setRpc("my_ticket_allowance", ok({ granted: 0, used: 0 }));

    expect((await ticketPriceForCaller(asClient(stub), 0)).amountCents).toBe(0);
  });

  it("jedna wycena to DOKŁADNIE jedno zapytanie o pulę", async () => {
    // Dwa odczyty w jednej wycenie mogłyby trafić na pulę zmienioną w
    // międzyczasie przez `claim_included_event_ticket` - kwota i decyzja
    // o ścieżce pochodziłyby wtedy z dwóch różnych stanów bazy.
    const stub = supabaseClientStub();
    stub.setRpc("my_ticket_allowance", ok({ granted: 2, used: 0, scope: "personal" }));

    await ticketPriceForCaller(asClient(stub), FACE_VALUE_CENTS);

    expect(stub.rpcCalls).toHaveLength(1);
  });

  it("limit rozliczony ponad miarę kosztuje PEŁNĄ cenę, a nie ujemną kwotę", async () => {
    // Domknięcie poprzedniego przypadku po stronie pieniędzy: `remaining`
    // przycięte do zera musi dać cenę katalogową. Gdyby ujemna wartość
    // przeciekła do rachunku, kasa wystawiłaby kwotę mniejszą od ceny albo
    // ujemną - czyli zwrot za wejście na płatne wydarzenie.
    const stub = supabaseClientStub();
    stub.setRpc("my_ticket_allowance", ok({ granted: 1, used: 5, scope: "personal" }));

    const priced = await ticketPriceForCaller(asClient(stub), FACE_VALUE_CENTS);

    expect(priced.amountCents).toBe(FACE_VALUE_CENTS);
    expect(priced.allowance.remaining).toBe(0);
  });

  it("okres z przeszłości NIE unieważnia puli sam z siebie - o oknie decyduje RPC", async () => {
    // To jest decyzja, nie przeoczenie. `my_ticket_allowance` liczy
    // `remaining` już w oknie rocznicowym, a konsumpcję trzyma
    // `claim_included_event_ticket` (SECURITY DEFINER). Dorzucenie tu drugiego
    // porównania dat dałoby dwa źródła prawdy o ważności biletu, rozjeżdżające
    // się przy każdej różnicy stref czasowych między bazą a węzłem - i to w
    // stronę, w której członek z ważną pulą słyszy „benefit wygasł".
    const stub = supabaseClientStub();
    stub.setRpc(
      "my_ticket_allowance",
      ok({
        granted: 1,
        used: 0,
        scope: "personal",
        period_start: "2019-01-01",
        period_end: "2020-01-01",
      }),
    );

    const priced = await ticketPriceForCaller(asClient(stub), FACE_VALUE_CENTS);

    expect(priced.amountCents).toBe(0);
    expect(priced.allowance.periodEnd).toBe("2020-01-01");
  });

  it("ZACHOWANIE OBECNE: `discount_pct` spoza zakresu (150) obcina się do 100 i daje bilet za zero", async () => {
    // PRAWDOPODOBNA USTERKA, zgłoszona osobno. Nagłówek tego modułu deklaruje
    // jeden dopuszczalny kierunek degradacji: uszkodzona odpowiedź o
    // benefitach ma kończyć się PEŁNĄ ceną, bo w drugą stronę błąd bazy
    // rozdaje darmowe wejściówki. Wartość spoza zbioru jest tu jednak
    // przycinana do 100%, a nie odrzucana - jeden zły wiersz w katalogu stawek
    // wystawia wtedy wejściówkę za 0 zł komuś, kto NIE ma biletu w puli
    // (`remaining` zostaje zerem, więc nic się nawet nie odliczy).
    const stub = supabaseClientStub();
    stub.setRpc("my_ticket_allowance", ok({ granted: 0, used: 0, discount_pct: 150 }));

    const priced = await ticketPriceForCaller(asClient(stub), FACE_VALUE_CENTS);

    expect(priced.amountCents).toBe(0);
    expect(priced.allowance.discountPct).toBe(100);
    expect(priced.allowance.remaining).toBe(0);
  });
});
