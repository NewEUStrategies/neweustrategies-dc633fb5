// Obudowa server fn LISTY ZAMÓWIEŃ PŁATNICZYCH (`paymentOrders.functions.ts`) -
// 33 linie, 0% pokrycia do 31.08.2026 (0 z 3 funkcji, 0 z 6 gałęzi).
//
// PO CO TEN PLIK ISTNIEJE. To jest ekran, na którym dyżurny odpowiada na
// pytanie „czy ta wpłata doszła". Implementacja (`paymentOrders.server.ts`)
// ma własne testy; nieprzetestowane było OPAKOWANIE, czyli jedyna bramka
// kształtu przed zapytaniem o tabelę `payment_orders`:
//   * `status` steruje filtrem `.eq("status", ...)` na kolumnie ENUMOWEJ.
//     Wartość spoza słownika bazy nie wywala się głośno - PostgREST oddaje
//     błąd, a panel pokazuje pustkę nie do odróżnienia od „nie ma zamówień".
//   * `limit` steruje ilością danych rozliczeniowych (kwoty, adresy odbiorców
//     paragonów, identyfikatory kupujących) opuszczających serwer JEDNYM
//     żądaniem. Sufit 500 jest bramką RODO, nie tylko wydajnościową.
//   * wartości domyślne (`all`, 100) mieszkają w HANDLERZE, nie w schemacie -
//     to osobny kontrakt, który trzeba pinować, bo z samego schematu go nie
//     widać.
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI. Harness nie uruchamia middleware,
// więc `requireSupabaseAuth` przybijamy STRUKTURALNIE.
//
// Atrapa stoi na GRANICY: `loadPaymentOrders` (dotyka bazy). Schemat zod
// biegnie PRAWDZIWY, a lista statusów jest porównywana z WYGENEROWANYM
// słownikiem bazy, nie z ręcznie przepisaną kopią.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { Constants } from "@/integrations/supabase/types";
import {
  asServerFn,
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({ loadPaymentOrders: vi.fn() }));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/lib/billing/paymentOrders.server", () => ({
  loadPaymentOrders: h.loadPaymentOrders,
}));

import { listPaymentOrders } from "@/lib/billing/paymentOrders.functions";

/** Znaczniki tożsamości - dowodzą przekazania TEGO SAMEGO obiektu, nie kopii. */
const WYNIK = { rows: [{ marker: "zamowienie" }], summary: { marker: "podsumowanie" } };
const KLIENT_UZYTKOWNIKA = { marker: "klient-z-kontekstu" };

/** Kształt oddawany przez schemat wejścia. */
interface WejscieListy {
  status?: string;
  limit?: number;
  /** Zawężenie do jednego środowiska operatora - patrz „rozdział piaskownicy". */
  environment?: string;
}

function kontekst() {
  return { supabase: KLIENT_UZYTKOWNIKA, userId: "11111111-1111-4111-8111-111111111111" };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.loadPaymentOrders.mockResolvedValue(WYNIK);
});

describe("obudowa - bramka i metoda", () => {
  it("funkcja deklaruje bramkę uwierzytelnienia", () => {
    // Dowód STRUKTURALNY: harness nie wykonuje middleware. Gdyby ta deklaracja
    // zniknęła, lista zamówień z kwotami i adresami kupujących byłaby
    // odczytywalna bez sesji.
    expect(serverFnMiddlewareNames(listPaymentOrders)).toEqual(["requireSupabaseAuth"]);
  });

  it("odczyt listy idzie metodą GET", () => {
    // Pinujemy stan faktyczny: to jest czysty odczyt bez efektów ubocznych.
    // Zmiana metody bez zmiany tego testu byłaby cichą zmianą kontraktu
    // wywołania po stronie panelu.
    expect(asServerFn(listPaymentOrders).method).toBe("GET");
  });
});

describe("walidator - filtr statusu", () => {
  it("KAŻDY status ze słownika bazy jest wybieralny w panelu", () => {
    // Parytet ze słownikiem, a nie ręcznie przepisana lista. Migracja
    // dokładająca status do enuma `order_status` bez dopisania go tutaj
    // zrobiłaby zakładkę, której nie da się otworzyć - a zamówienia w nowym
    // stanie zniknęłyby z każdego filtra poza „wszystkie".
    for (const status of Constants.public.Enums.order_status) {
      expect(validateServerFnInput<WejscieListy>(listPaymentOrders, { status }).status).toBe(
        status,
      );
    }
  });

  it("wartość „all” jest dopuszczalna obok statusów bazy", () => {
    // „all" nie jest statusem w bazie - to znacznik „nie filtruj", zdejmowany
    // przez implementację. Musi przejść walidator, inaczej domyślna zakładka
    // panelu byłaby nieosiągalna.
    expect(validateServerFnInput<WejscieListy>(listPaymentOrders, { status: "all" }).status).toBe(
      "all",
    );
  });

  it("brytyjska pisownia „cancelled” jest ODRZUCANA - baza zna tylko „canceled”", () => {
    // To nie jest hipotetyczna literówka: `paymentOrders.server.ts` opisuje ją
    // jako defekt, który już wystąpił (porównanie z literałem spoza enuma
    // kompilowało się i nigdy nie trafiało). Walidator jest miejscem, w którym
    // taka pomyłka ma się zatrzymać z komunikatem, a nie zamienić w pustą listę.
    expect(() => validateServerFnInput(listPaymentOrders, { status: "cancelled" })).toThrow(
      ZodError,
    );
  });

  it("status spoza słownika, pusty tekst i inna wielkość liter są odrzucane", () => {
    for (const zle of ["", " ", "PAID", "Paid", "refund", "succeeded", "open", null]) {
      expect(() => validateServerFnInput(listPaymentOrders, { status: zle })).toThrow(ZodError);
    }
  });

  it("typ inny niż tekst jest odrzucany", () => {
    for (const zle of [1, true, ["paid"], { status: "paid" }]) {
      expect(() => validateServerFnInput(listPaymentOrders, { status: zle })).toThrow(ZodError);
    }
  });
});

describe("walidator - sufit liczby wierszy", () => {
  it("skrajne wartości z zakresu przechodzą: 1 i 500", () => {
    expect(validateServerFnInput<WejscieListy>(listPaymentOrders, { limit: 1 }).limit).toBe(1);
    expect(validateServerFnInput<WejscieListy>(listPaymentOrders, { limit: 500 }).limit).toBe(500);
  });

  it("wartość ponad sufitem jest ODRZUCANA, a nie przycinana", () => {
    // Ciche przycięcie ukryłoby próbę zrzutu tabeli rozliczeniowej. Odmowa
    // zostawia ślad i wywala żądanie.
    for (const zle of [501, 5000, Number.MAX_SAFE_INTEGER]) {
      expect(() => validateServerFnInput(listPaymentOrders, { limit: zle })).toThrow(ZodError);
    }
  });

  it("zero i wartość ujemna są odrzucane", () => {
    // `.limit(0)` oddaje pustą listę, a wartość ujemna to błąd zapytania -
    // oba wyglądają w panelu identycznie jak „nie ma zamówień".
    for (const zle of [0, -1, -100]) {
      expect(() => validateServerFnInput(listPaymentOrders, { limit: zle })).toThrow(ZodError);
    }
  });

  it("tekst, ułamek i NaN zamiast liczby są odrzucane", () => {
    for (const zle of ["100", "", 1.5, Number.NaN, Number.POSITIVE_INFINITY, true, null]) {
      expect(() => validateServerFnInput(listPaymentOrders, { limit: zle })).toThrow(ZodError);
    }
  });
});

describe("walidator - brak ładunku i klucze spoza schematu", () => {
  it("brak ładunku jest DOPUSZCZALNY i daje pusty obiekt", () => {
    // Panel woła tę funkcję bez argumentów przy pierwszym renderze listy.
    // `input ?? {}` jest tu świadomą różnicą wobec rejestru wpłat, gdzie
    // ładunek jest obowiązkowy.
    expect(validateServerFnInput<WejscieListy>(listPaymentOrders, undefined)).toEqual({});
    expect(validateServerFnInput<WejscieListy>(listPaymentOrders, null)).toEqual({});
    expect(validateServerFnInput<WejscieListy>(listPaymentOrders, {})).toEqual({});
  });

  it("ładunek, który nie jest obiektem, nadal jest odrzucany", () => {
    for (const zle of ["paid", 7, true, ["paid"]]) {
      expect(() => validateServerFnInput(listPaymentOrders, zle)).toThrow(ZodError);
    }
  });

  it("nadmiarowe pola są odcinane", () => {
    // Gdyby ładunek przechodził w całości, przyszłe opcje zapytania (kolumny,
    // zakres dat, cudzy najemca) dałoby się podać z przeglądarki, zanim
    // ktokolwiek doda dla nich bramkę.
    expect(
      validateServerFnInput<WejscieListy>(listPaymentOrders, {
        status: "paid",
        limit: 10,
        tenantId: "obcy-najemca",
        select: "*",
      }),
    ).toEqual({ status: "paid", limit: 10 });
  });
});

describe("handler - co robi z argumentami", () => {
  it("pyta bazy klientem Z KONTEKSTU, a nie klientem serwisowym", async () => {
    // To jest istotne dla RLS: zapytanie idzie klientem uwierzytelnionym
    // tokenem wywołującego, więc polityki bazy nadal działają. Podmiana na
    // klienta serwisowego zdjęłaby drugą warstwę ochrony tabeli rozliczeniowej.
    await callServerFn(listPaymentOrders, { data: {}, context: kontekst() });

    expect(h.loadPaymentOrders).toHaveBeenCalledWith(KLIENT_UZYTKOWNIKA, {
      status: "all",
      limit: 100,
    });
  });

  it("brak filtra oznacza „wszystkie”, a brak limitu - 100 wierszy", async () => {
    // Wartości domyślne siedzą w HANDLERZE, nie w schemacie: z samego zod-a
    // ich nie widać, więc bez tego testu ich zmiana byłaby niewidoczna.
    await callServerFn(listPaymentOrders, { data: {}, context: kontekst() });

    expect(h.loadPaymentOrders).toHaveBeenCalledWith(KLIENT_UZYTKOWNIKA, {
      status: "all",
      limit: 100,
    });
  });

  it("wskazany filtr i limit jadą dalej 1:1", async () => {
    await callServerFn(listPaymentOrders, {
      data: { status: "failed", limit: 200 },
      context: kontekst(),
    });

    expect(h.loadPaymentOrders).toHaveBeenCalledWith(KLIENT_UZYTKOWNIKA, {
      status: "failed",
      limit: 200,
    });
  });

  it("oddaje wiersze i podsumowanie implementacji bez własnego przetwarzania", async () => {
    const wynik = await callServerFn(listPaymentOrders, { data: {}, context: kontekst() });

    // `toBe`, nie `toEqual`: podsumowanie (liczba opłaconych, nieudanych,
    // „wiszących") ma pochodzić z jednego miejsca. Przeliczanie go w opakowaniu
    // dałoby dwie prawdy o tych samych pieniądzach.
    expect(wynik).toBe(WYNIK);
  });

  it("błąd bazy nie jest połykany - dyżurny ma zobaczyć awarię, a nie pustą listę", async () => {
    // Pusta lista i awaria odczytu wyglądają w panelu tak samo, a znaczą coś
    // zupełnie innego: „nie ma zamówień" kontra „nie wiemy, czy są".
    h.loadPaymentOrders.mockRejectedValue(new Error("connection reset"));

    await expect(
      callServerFn(listPaymentOrders, { data: {}, context: kontekst() }),
    ).rejects.toThrow("connection reset");
  });
});

describe("rozdział piaskownicy od produkcji", () => {
  // DEFEKT NAPRAWIONY 31.08.2026 (schemat wejścia tutaj, filtr
  // `.eq("environment", ...)` w `loadPaymentOrders`, przełącznik
  // w `AdminPaymentOrdersPanel`).
  //
  // CO BYŁO ZŁE. `listPaymentOrders` była JEDYNĄ funkcją serwerową w module
  // rozliczeń, której schemat wejścia NIE MIAŁ pola `environment`. Wszystkie
  // pozostałe (audyt, diagnostyka, uzgadnianie, rejestr wpłat, katalog,
  // portal, faktury) wymagają go albo mają dla niego bezpieczną wartość
  // domyślną. Tabela `payment_orders` trzyma OBA środowiska w jednej kolumnie
  // `environment` (NOT NULL, sandbox/live), a `loadPaymentOrders` filtrowała
  // wyłącznie po statusie - więc lista i podsumowanie sklejały zamówienia
  // testowe z prawdziwymi.
  //
  // JAKIE TO BYŁO RYZYKO. Trzy skutki, wszystkie na ścieżce pieniędzy:
  //   1. LICZBY. `summary.paid` / `summary.failed` / `summary.stuck` to
  //      liczniki, po których dyżurny ocenia stan sprzedaży. Doliczenie do
  //      nich zakupów z piaskownicy (a każdy test checkoutu je produkuje)
  //      dawało wynik, którego nie dało się użyć do niczego poza zgadywaniem.
  //   2. OKNO WIERSZY. `limit` był nakładany PRZED jakimkolwiek filtrem
  //      środowiska (bo takiego filtra nie było), więc seria zamówień
  //      piaskownicowych potrafiła wypchnąć prawdziwe zamówienia poza 200
  //      wierszy, o które prosi panel. Zamówienie klienta zgłaszającego
  //      problem po prostu nie pojawiało się na liście.
  //   3. ROZJAZD Z RESZTĄ PANELU. Sąsiednie ekrany (audyt, uzgadnianie,
  //      diagnostyka) pokazują JEDNO wybrane środowisko. Ten sam administrator
  //      na sąsiednich zakładkach widział więc dwa różne obrazy tych samych
  //      pieniędzy i nie miał jak się dowiedzieć, dlaczego.
  //
  // JAK ZOSTAŁO NAPRAWIONE. Schemat przyjmuje `environment` (enum bazy,
  // opcjonalny), handler przekazuje go do implementacji, a ta dokłada
  // `.eq("environment", ...)` DO ZAPYTANIA - czyli przed `limit`, nie po nim.
  // Pole zostało opcjonalne świadomie: brak znaczy „oba środowiska", tak jak
  // `status: "all"` znaczy „każdy status", a panel podaje je zawsze
  // (przełącznik z domyślną wartością z konfiguracji klienta).
  it("filtr środowiska przechodzi przez bramkę kształtu", () => {
    expect(
      validateServerFnInput<WejscieListy>(listPaymentOrders, {
        environment: "live",
        status: "paid",
        limit: 50,
      }).environment,
    ).toBe("live");
    expect(
      validateServerFnInput<WejscieListy>(listPaymentOrders, { environment: "sandbox" })
        .environment,
    ).toBe("sandbox");
  });

  it("środowisko spoza słownika bazy jest ODRZUCANE, a nie po cichu zdejmowane", () => {
    // Ciche zdjęcie klucza jest tu gorsze niż odmowa: panel prosiłby o jedno
    // środowisko, a dostawał oba i nie miałby jak tego zauważyć.
    for (const zle of ["", " ", "LIVE", "prod", "production", "test", 1, true, null]) {
      expect(() => validateServerFnInput(listPaymentOrders, { environment: zle })).toThrow(
        ZodError,
      );
    }
  });

  it("wybrane środowisko jedzie do implementacji 1:1", async () => {
    await callServerFn(listPaymentOrders, {
      data: { status: "paid", limit: 200, environment: "live" },
      context: kontekst(),
    });

    expect(h.loadPaymentOrders).toHaveBeenCalledWith(KLIENT_UZYTKOWNIKA, {
      status: "paid",
      limit: 200,
      environment: "live",
    });
  });

  it("brak środowiska w żądaniu NIE zmyśla wartości - implementacja dostaje `undefined`", async () => {
    // Domyślne środowisko wybiera PANEL (zna konfigurację klienta), nie
    // opakowanie serwerowe. Podstawienie tutaj „live" ukryłoby zamówienia
    // piaskownicowe przed każdym, kto woła tę funkcję bez przełącznika.
    await callServerFn(listPaymentOrders, { data: { status: "all" }, context: kontekst() });

    const [, options] = h.loadPaymentOrders.mock.calls.at(-1) as [unknown, WejscieListy];
    expect(options.environment).toBeUndefined();
  });
});
