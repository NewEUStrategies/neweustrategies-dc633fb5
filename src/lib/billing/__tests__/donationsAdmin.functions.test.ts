// Obudowa server fn REJESTRU WPŁAT (`donationsAdmin.functions.ts`) - 35 linii,
// 0% pokrycia do 31.08.2026 (0 z 4 funkcji).
//
// PO CO TEN PLIK ISTNIEJE. Implementacja (`donationsAdmin.server.ts`) ma własne
// testy. Nieprzetestowane było opakowanie - a to ono decyduje, ILE wierszy
// z rejestru darowizn wyjdzie z serwera i Z KTÓREGO konta operatora zostanie
// zaciągnięta synchronizacja.
//
// Dlaczego to nie jest kosmetyka:
//   * `limit` idzie prosto do `.limit()` na zapytaniu o tabelę z danymi
//     WPŁACAJĄCYCH (kwota, waluta, adres kontaktowy). Zdjęcie sufitu 200
//     zamienia ekran administratora w zrzut całej bazy darowizn jednym
//     żądaniem - to jest ryzyko RODO, nie tylko wydajnościowe.
//   * `environment` wybiera klucz API operatora. Synchronizacja z konta
//     testowego nadpisałaby rejestr prawdziwych wpłat wpisami z piaskownicy
//     (albo odwrotnie), a te liczby idą do sprawozdania publicznego.
//   * `sinceHours` wyznacza okno synchronizacji (sufit 2160 h = 90 dni).
//     Zero, wartość ujemna albo tekst zamieniają okno w bezsens, którego
//     nikt nie zauważy - synchronizacja po prostu „nic nie znajdzie".
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI. Harness nie uruchamia middleware,
// więc `requireSupabaseAuth` przybijamy STRUKTURALNIE, a odmowę roli tam,
// gdzie da się ją wywołać naprawdę - przez `assertAdmin`.
//
// RODO: żadnych prawdziwych danych osobowych; wiersze rejestru to znaczniki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  asServerFn,
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  listAdminDonations: vi.fn(),
  syncDonationsFromStripe: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/lib/billing/diagnostics.server", () => ({ assertAdmin: h.assertAdmin }));
vi.mock("@/lib/billing/donationsAdmin.server", () => ({
  listAdminDonations: h.listAdminDonations,
  syncDonationsFromStripe: h.syncDonationsFromStripe,
}));

import {
  listDonationRecords,
  syncDonationsWithStripe,
} from "@/lib/billing/donationsAdmin.functions";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

/** Znaczniki tożsamości - dowodzą przekazania TEGO SAMEGO obiektu, nie kopii. */
const WIERSZE = [{ marker: "wiersz-rejestru" }];
const RAPORT_SYNC = { marker: "raport-synchronizacji-wplat" };
const KLIENT_UZYTKOWNIKA = { marker: "klient-z-kontekstu" };

/** Kształty oddawane przez schematy wejścia. */
interface WejscieListy {
  limit: number;
}
interface WejscieSynchronizacji {
  environment: "sandbox" | "live";
  sinceHours: number;
}

function kontekst() {
  return { supabase: KLIENT_UZYTKOWNIKA, userId: ADMIN_ID };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assertAdmin.mockResolvedValue(undefined);
  h.listAdminDonations.mockResolvedValue(WIERSZE);
  h.syncDonationsFromStripe.mockResolvedValue(RAPORT_SYNC);
});

describe("obudowa - bramka i metoda", () => {
  it("obie funkcje deklarują bramkę uwierzytelnienia", () => {
    // Dowód STRUKTURALNY: harness nie wykonuje middleware. Gdyby ta deklaracja
    // zniknęła, rejestr wpłat (kwoty i dane kontaktowe darczyńców) dałoby się
    // odczytać bez sesji.
    expect(serverFnMiddlewareNames(listDonationRecords)).toEqual(["requireSupabaseAuth"]);
    expect(serverFnMiddlewareNames(syncDonationsWithStripe)).toEqual(["requireSupabaseAuth"]);
  });

  it("obie idą metodą POST, także sam odczyt listy", () => {
    // Odczyt też jest POST-em świadomie: przy GET zakres zapytania o dane
    // darczyńców wylądowałby w adresie, czyli w logach serwera i historii
    // przeglądarki na stacji administratora.
    expect(asServerFn(listDonationRecords).method).toBe("POST");
    expect(asServerFn(syncDonationsWithStripe).method).toBe("POST");
  });
});

describe("walidator listy - sufit liczby wierszy", () => {
  it("brak limitu oznacza 50 wierszy", () => {
    // Wartość domyślna jest bramką objętościową: ekran nie zaciąga całej
    // bazy tylko dlatego, że panel zapomniał podać limit.
    expect(validateServerFnInput<WejscieListy>(listDonationRecords, {})).toEqual({ limit: 50 });
  });

  it("skrajne wartości z zakresu przechodzą: 1 i 200", () => {
    expect(validateServerFnInput<WejscieListy>(listDonationRecords, { limit: 1 }).limit).toBe(1);
    expect(validateServerFnInput<WejscieListy>(listDonationRecords, { limit: 200 }).limit).toBe(200);
  });

  it("wartość ponad sufitem jest ODRZUCANA, a nie przycinana do 200", () => {
    // Różnica jest istotna: ciche przycięcie ukryłoby próbę zrzutu bazy,
    // odmowa zostawia ślad i wywala żądanie. `limit` steruje ilością danych
    // osobowych opuszczających serwer - to jest bramka RODO.
    for (const zle of [201, 500, 10_000, Number.MAX_SAFE_INTEGER]) {
      expect(() => validateServerFnInput(listDonationRecords, { limit: zle })).toThrow(ZodError);
    }
  });

  it("zero i wartość ujemna są odrzucane", () => {
    // W PostgREST `.limit(0)` oddaje pustą listę, a wartość ujemna jest
    // błędem zapytania. Oba warianty wyglądałyby w panelu jak „nie ma wpłat".
    for (const zle of [0, -1, -50]) {
      expect(() => validateServerFnInput(listDonationRecords, { limit: zle })).toThrow(ZodError);
    }
  });

  it("tekst i ułamek zamiast liczby są odrzucane", () => {
    // Pole formularza oddaje tekst. Bez tej bramki `"50"` doszłoby do
    // zapytania jako tekst, a `50.5` jako ułamek - oba kończą się błędem
    // z warstwy bazy zamiast czytelną odmową.
    for (const zle of ["50", "", "abc", 50.5, true, [50], null]) {
      expect(() => validateServerFnInput(listDonationRecords, { limit: zle })).toThrow(ZodError);
    }
  });

  it("brak całego ładunku jest odmową - ta funkcja WYMAGA obiektu", () => {
    // Świadome pinowanie asymetrii wobec `catalogSync.functions.ts`, gdzie
    // walidator ratuje brak ładunku przez `input ?? {}`. Tu wywołanie bez
    // `data` kończy się błędem walidacji, mimo że każde pole ma wartość
    // domyślną. Panel zawsze podaje `{ limit: 50 }`, więc kontrakt jest
    // spełniony - ale kolejny wywołujący musi o tym wiedzieć.
    expect(() => validateServerFnInput(listDonationRecords, undefined)).toThrow(ZodError);
    expect(() => validateServerFnInput(listDonationRecords, null)).toThrow(ZodError);
  });

  it("nadmiarowe pola są odcinane", () => {
    // Gdyby ładunek przechodził w całości, przyszłe pola filtra (np. „pokaż
    // dane darczyńcy") dałoby się włączyć z przeglądarki przed dołożeniem
    // dla nich bramki.
    expect(
      validateServerFnInput<WejscieListy>(listDonationRecords, {
        limit: 10,
        includeDonorEmails: true,
        tenantId: "obcy-najemca",
      }),
    ).toEqual({ limit: 10 });
  });
});

describe("walidator synchronizacji - środowisko i okno czasowe", () => {
  it("poprawne minimalne wejście uzupełnia okno domyślne (168 h)", () => {
    expect(
      validateServerFnInput<WejscieSynchronizacji>(syncDonationsWithStripe, {
        environment: "live",
      }),
    ).toEqual({ environment: "live", sinceHours: 168 });
  });

  it("wartość środowiska spoza enuma jest ODRZUCANA", () => {
    // Synchronizacja zaciąga wpłaty z konta operatora do NASZEGO rejestru.
    // Zły wybór konta miesza wpłaty testowe z prawdziwymi w liczbach, które
    // idą do sprawozdania publicznego.
    for (const zle of ["prod", "production", "LIVE", " live", "", "test", null]) {
      expect(() =>
        validateServerFnInput(syncDonationsWithStripe, { environment: zle }),
      ).toThrow(ZodError);
    }
  });

  it("brak środowiska to odmowa - nie ma wartości domyślnej", () => {
    expect(() => validateServerFnInput(syncDonationsWithStripe, {})).toThrow(ZodError);
    expect(() => validateServerFnInput(syncDonationsWithStripe, { sinceHours: 24 })).toThrow(
      ZodError,
    );
    expect(() => validateServerFnInput(syncDonationsWithStripe, undefined)).toThrow(ZodError);
  });

  it("skrajne wartości okna przechodzą: 1 godzina i 2160 godzin (90 dni)", () => {
    expect(
      validateServerFnInput<WejscieSynchronizacji>(syncDonationsWithStripe, {
        environment: "live",
        sinceHours: 1,
      }).sinceHours,
    ).toBe(1);
    expect(
      validateServerFnInput<WejscieSynchronizacji>(syncDonationsWithStripe, {
        environment: "live",
        sinceHours: 2160,
      }).sinceHours,
    ).toBe(2160);
  });

  it("zero, wartość ujemna i przekroczony sufit 90 dni są odrzucane", () => {
    // Sufit jest inny niż w audycie (8760 h) i w uzgadnianiu (720 h) - każdy
    // z tych modułów ma własny koszt przebiegu. Zejście z tego sufitu
    // oznaczałoby pobieranie z operatora okna, którego przebieg nie kończy się
    // w limicie czasu funkcji serwerowej.
    for (const zle of [0, -1, -168, 2161, 8760]) {
      expect(() =>
        validateServerFnInput(syncDonationsWithStripe, { environment: "live", sinceHours: zle }),
      ).toThrow(ZodError);
    }
  });

  it("tekst, ułamek i NaN zamiast liczby są odrzucane", () => {
    for (const zle of ["168", "", 1.5, Number.NaN, Number.POSITIVE_INFINITY, true]) {
      expect(() =>
        validateServerFnInput(syncDonationsWithStripe, { environment: "live", sinceHours: zle }),
      ).toThrow(ZodError);
    }
  });
});

describe("handler listy - co robi z argumentami", () => {
  it("rola jest sprawdzana PRZED odczytem rejestru", async () => {
    // Kolejność ma znaczenie prawne: zalogowany bez roli nie może zobaczyć
    // ani jednego wiersza z danymi darczyńców, ani komunikatu, z którego
    // dałoby się wywnioskować ich liczbę.
    h.assertAdmin.mockRejectedValue(new Error("forbidden"));

    await expect(
      callServerFn(listDonationRecords, { data: { limit: 50 }, context: kontekst() }),
    ).rejects.toThrow("forbidden");
    expect(h.listAdminDonations).not.toHaveBeenCalled();
  });

  it("kontrola roli dostaje klienta i użytkownika Z KONTEKSTU, nie z ładunku", async () => {
    await callServerFn(listDonationRecords, {
      data: { limit: 10, userId: "podstawiony" },
      context: kontekst(),
    });

    expect(h.assertAdmin).toHaveBeenCalledWith(KLIENT_UZYTKOWNIKA, ADMIN_ID);
  });

  it("limit jedzie do implementacji 1:1, a wiersze wracają bez przetwarzania", async () => {
    const wynik = await callServerFn(listDonationRecords, {
      data: { limit: 7 },
      context: kontekst(),
    });

    expect(h.listAdminDonations).toHaveBeenCalledWith(7);
    // `toBe`, nie `toEqual`: opakowanie nie ma prawa filtrować ani kopiować
    // listy (kopia gubiłaby pola dodane po stronie implementacji).
    expect(wynik).toBe(WIERSZE);
  });

  it("domyślne 50 dojeżdża do zapytania jako liczba, nie jako `undefined`", async () => {
    // Gdyby wartość domyślna gubiła się między schematem a handlerem,
    // `listAdminDonations()` użyłoby SWOJEJ domyślnej wartości - kontrakt
    // przestałby być widoczny w jednym miejscu.
    await callServerFn(listDonationRecords, { data: {}, context: kontekst() });

    expect(h.listAdminDonations).toHaveBeenCalledWith(50);
  });
});

describe("handler synchronizacji - co robi z argumentami", () => {
  it("rola jest sprawdzana PRZED sięgnięciem do operatora", async () => {
    h.assertAdmin.mockRejectedValue(new Error("forbidden"));

    await expect(
      callServerFn(syncDonationsWithStripe, {
        data: { environment: "live" },
        context: kontekst(),
      }),
    ).rejects.toThrow("forbidden");
    expect(h.syncDonationsFromStripe).not.toHaveBeenCalled();
  });

  it("środowisko i okno jadą dalej POZYCYJNIE i w tej kolejności", async () => {
    // Argumenty są pozycyjne i oba są „wąskie" (tekst, liczba), więc ich
    // zamiana nie wywaliłaby się na typach - dałaby synchronizację niewłaściwego
    // konta z bezsensownym oknem.
    await callServerFn(syncDonationsWithStripe, {
      data: { environment: "live", sinceHours: 24 },
      context: kontekst(),
    });

    expect(h.syncDonationsFromStripe).toHaveBeenCalledWith("live", 24);
  });

  it("domyślne okno 168 h dojeżdża do implementacji", async () => {
    await callServerFn(syncDonationsWithStripe, {
      data: { environment: "sandbox" },
      context: kontekst(),
    });

    expect(h.syncDonationsFromStripe).toHaveBeenCalledWith("sandbox", 168);
  });

  it("oddaje raport implementacji bez własnego przetwarzania", async () => {
    const wynik = await callServerFn(syncDonationsWithStripe, {
      data: { environment: "live" },
      context: kontekst(),
    });

    expect(wynik).toBe(RAPORT_SYNC);
  });
});
