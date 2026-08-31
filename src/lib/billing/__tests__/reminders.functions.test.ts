// Ręczne uruchomienie przypomnień rozliczeniowych - 0 z 2 funkcji pokrytych
// do 31.08.2026.
//
// PO CO TEN PLIK ISTNIEJE. `runBillingRemindersNow` to przycisk „wyślij
// przypomnienia teraz" w panelu administratora. Jego jedyną własną
// odpowiedzialnością jest OBUDOWA - bo cała logika żyje w `reminders.server`:
//
//   * KONTRAKT WEJŚCIA. `leadDays` steruje oknem czasowym wyszukiwania
//      subskrypcji, a więc tym, do KOGO pójdzie masowa wysyłka maili.
//      Wartość spoza zakresu 1-30 nie jest „dziwną liczbą w formularzu", tylko
//      wysyłką do niewłaściwej grupy: 0 nie znajduje nikogo (cisza w miejscu,
//      w którym klient spodziewa się ostrzeżenia przed obciążeniem), a 3650
//      obejmuje cały rocznik subskrypcji naraz. Ułamek albo napis to zapytanie
//      z `NaN`/`Invalid Date` w granicach okna.
//   * DOMYŚLNA WARTOŚĆ. Brak `leadDays` MUSI oznaczać stałą modułu
//      przypomnień, a nie liczbę wpisaną drugi raz w tym pliku - inaczej
//      przycisk w panelu wysyła według innej reguły niż cron.
//   * BRAMKA ROLI. Deklaracja `requireAdmin` (nie samo uwierzytelnienie):
//      masowa wysyłka jest operacją administracyjną.
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI. Harness (`src/test/serverFnHarness.ts`)
// świadomie NIE uruchamia middleware - deklarację bramki przybijamy
// strukturalnie, a jej działania pilnują bramka `check:authz-snapshot` i testy
// samego middleware.
//
// GRANICA, KTÓRĄ ATRAPUJEMY: dynamiczny import implementacji
// (`@/lib/billing/reminders.server`) - inaczej test wciągnąłby wysyłkę poczty
// i klienta bazy. Zero sieci, zero maili.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { asServerFn, callServerFn, serverFnMiddlewareNames } from "@/test/serverFnHarness";

/**
 * Stała modułu przypomnień CELOWO różna od produkcyjnej (3): test ma dowieść,
 * że handler czyta ją z modułu, a nie że powtórzono w nim tę samą liczbę.
 * Gdyby ktoś wpisał „3" na sztywno w handlerze, ten plik zrobi się czerwony.
 */
const STALA_MODULU = 7;

const h = vi.hoisted(() => ({
  run: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdmin: { name: "requireAdmin" },
}));
vi.mock("@/lib/billing/reminders.server", () => ({
  REMINDER_LEAD_DAYS: 7,
  runBillingReminders: h.run,
}));

const { runBillingRemindersNow } = await import("@/lib/billing/reminders.functions");

/** Wynik przebiegu w kształcie, jaki oddaje `runBillingReminders`. */
const WYNIK = { renewal: 2, expiring: 1, skipped: 5 } as const;

/** Kontekst wstrzykiwany w produkcji przez middleware - handler go nie używa. */
const KONTEKST = { supabase: null, userId: "user-admin" };

/** Sam walidator - do przypadków wejścia bez uruchamiania wysyłki. */
function waliduj(input: unknown): unknown {
  const spec = asServerFn(runBillingRemindersNow);
  if (!spec.validator) throw new Error("test: funkcja bez walidatora");
  return spec.validator(input);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.run.mockResolvedValue({ ...WYNIK });
});

describe("obudowa - bramka i metoda", () => {
  it("wymaga roli administratora, nie samego zalogowania", () => {
    // Dowód STRUKTURALNY: harness nie uruchamia middleware, więc zieleń
    // pozostałych testów mówi o logice handlera. Gdyby ta deklaracja spadła do
    // `requireSupabaseAuth`, dowolny zalogowany rozsyłałby maile do wszystkich
    // subskrybentów z kończącym się okresem.
    expect(serverFnMiddlewareNames(runBillingRemindersNow)).toEqual(["requireAdmin"]);
  });

  it("jest operacją zapisu (POST), nie odczytem", () => {
    // Wysyłka maili pod metodą GET dałaby się wyzwolić z podglądu linku,
    // prefetchu przeglądarki albo skanera bezpieczeństwa.
    expect(asServerFn(runBillingRemindersNow).method).toBe("POST");
  });

  it("ma walidator wejścia", () => {
    expect(typeof asServerFn(runBillingRemindersNow).validator).toBe("function");
  });
});

describe("walidator wejścia", () => {
  it("brak wejścia znaczy „ustawienia domyślne”, a nie błąd", () => {
    // Przycisk w panelu woła funkcję bez ładunku - `undefined` musi przejść.
    expect(waliduj(undefined)).toEqual({});
    expect(waliduj(null)).toEqual({});
    expect(waliduj({})).toEqual({});
  });

  it("przyjmuje krańce dozwolonego zakresu", () => {
    expect(waliduj({ leadDays: 1 })).toEqual({ leadDays: 1 });
    expect(waliduj({ leadDays: 30 })).toEqual({ leadDays: 30 });
  });

  it("odrzuca zero - okno, w którym nie ma nikogo", () => {
    expect(() => waliduj({ leadDays: 0 })).toThrow();
  });

  it("odrzuca wartość ujemną - okno cofnięte w przeszłość", () => {
    expect(() => waliduj({ leadDays: -3 })).toThrow();
  });

  it("odrzuca wartość powyżej limitu (31 dni)", () => {
    // Sufit 30 dni ogranicza rozmiar jednej masowej wysyłki; bez niego jeden
    // klik obejmuje dowolnie dużą grupę odbiorców.
    expect(() => waliduj({ leadDays: 31 })).toThrow();
  });

  it("odrzuca ułamek - dni są liczbą całkowitą", () => {
    expect(() => waliduj({ leadDays: 2.5 })).toThrow();
  });

  it("odrzuca napis, choćby wyglądał jak liczba", () => {
    // Formularz HTML oddaje napisy; brak koercji jest tu świadomy - `"3"`
    // w arytmetyce dat dałoby granice okna sklejone tekstowo.
    expect(() => waliduj({ leadDays: "3" })).toThrow();
  });

  it("odrzuca wartość logiczną i `null` w polu", () => {
    expect(() => waliduj({ leadDays: true })).toThrow();
    expect(() => waliduj({ leadDays: null })).toThrow();
  });

  it("odrzuca wejście, które nie jest obiektem", () => {
    expect(() => waliduj(7)).toThrow();
    expect(() => waliduj("30")).toThrow();
    expect(() => waliduj([1])).toThrow();
  });

  it("obce pola są odcinane, nie przepuszczane do handlera", () => {
    // Ładunek server fn pochodzi z przeglądarki - wszystko poza kontraktem ma
    // wypaść, żeby nie dało się nim sterować niczym w warstwie niżej.
    expect(waliduj({ leadDays: 5, tenantId: "tenant-obcy", dryRun: false })).toEqual({
      leadDays: 5,
    });
  });
});

describe("uruchomienie przebiegu", () => {
  it("bez `leadDays` używa STAŁEJ modułu przypomnień", async () => {
    const wynik = await callServerFn(runBillingRemindersNow, { context: KONTEKST });

    expect(h.run).toHaveBeenCalledWith(STALA_MODULU);
    expect(wynik).toEqual({ leadDays: STALA_MODULU, ...WYNIK });
  });

  it("podana wartość ma pierwszeństwo nad domyślną", async () => {
    const wynik = await callServerFn(runBillingRemindersNow, {
      data: { leadDays: 1 },
      context: KONTEKST,
    });

    expect(h.run).toHaveBeenCalledWith(1);
    expect(wynik).toEqual({ leadDays: 1, ...WYNIK });
  });

  it("odpowiedź niesie liczniki przebiegu razem z użytym oknem", async () => {
    // Panel pokazuje adminowi, ILE maili poszło i z jakim wyprzedzeniem -
    // bez `leadDays` w odpowiedzi nie da się odróżnić „nikogo nie było"
    // od „okno było inne, niż myślałem".
    h.run.mockResolvedValue({ renewal: 0, expiring: 0, skipped: 0 });

    await expect(
      callServerFn(runBillingRemindersNow, { data: { leadDays: 30 }, context: KONTEKST }),
    ).resolves.toEqual({ leadDays: 30, renewal: 0, expiring: 0, skipped: 0 });
  });

  it("pełna ścieżka wywołania przepuszcza wejście przez walidator", async () => {
    // Wywołanie z niepoprawnym ładunkiem MA się wywrócić PRZED wysyłką -
    // asercja o braku uruchomienia przebiegu jest tu ważniejsza niż sam wyjątek.
    await expect(
      callServerFn(runBillingRemindersNow, { data: { leadDays: 999 }, context: KONTEKST }),
    ).rejects.toThrow();

    expect(h.run).not.toHaveBeenCalled();
  });

  it("awaria przebiegu wychodzi na zewnątrz, nie udaje sukcesu", async () => {
    // Cicha „zieleń" w panelu przy nieudanej wysyłce jest gorsza niż brak
    // przycisku: admin uzna, że przypomnienia poszły, i nie ponowi.
    h.run.mockRejectedValue(new Error("reminder lookup failed: connection reset"));

    await expect(
      callServerFn(runBillingRemindersNow, { context: KONTEKST }),
    ).rejects.toThrow("reminder lookup failed: connection reset");
  });
});
