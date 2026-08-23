// FUNKCJA SERWEROWA DIAGNOSTYKI WEBHOOKA MAILI AUTORYZACYJNYCH
// (`src/lib/auth-email-events.functions.ts`): 43 linie, jedna funkcja, ZERO
// wykonanych linii przed tym plikiem.
//
// PO CO TO JEST WAŻNE. To jedyne okno na to, co robi webhook maili
// logowania: który mail poszedł, w jakim języku, czy język spadł na domyślny
// i dlaczego wysyłka została odrzucona. Kiedy użytkownik zgłasza „nie doszedł
// mail z resetem hasła", odpowiedź jest wyłącznie tutaj. Tabela
// `auth_email_events` jest dostępna TYLKO dla `service_role`, więc czyta ją
// klient admina - i to właśnie dlatego bramka roli na tej funkcji jest
// jedynym, co dzieli zalogowanego użytkownika od zamaskowanych adresów
// e-mail wszystkich pozostałych.
//
// CZEGO TEN HARNESS NIE UDAJE. `@/test/serverFnHarness` NIE uruchamia
// middleware (patrz nagłówek harnessu), więc odmowy dla nie-administratora nie
// da się tu odegrać. Bramka jest zatem sprawdzana STRUKTURALNIE
// (`serverFnMiddlewareNames`) - jej usunięcie z kodu wywraca test.
//
// CZEGO ŚWIADOMIE NIE DUBLUJEMY. Warstwa danych (`fetchAuthEmailEvents`:
// mapowanie wierszy, zliczanie, filtrowanie, stronicowanie, wykrycie braku
// tabeli) ma własny test w `src/lib/email/__tests__/auth-events.server.test.ts`
// i jest tu ATRAPĄ. Ten plik dowodzi wyłącznie tego, czego nie dowodzi tamten:
// jakie DOKŁADNIE zapytanie wrapper składa z parametrów panelu, co odrzuca,
// zanim cokolwiek pójdzie do bazy, i co robi z awarią odczytu.
//
// ROZSTRZYGNIĘCIE i18n. Funkcja nie produkuje tekstu dla człowieka - przyjmuje
// kod języka jako FILTR (`"pl" | "en" | null`) i oddaje surowe dane
// diagnostyczne. Nie ma tu więc ani kluczy i18n, ani słownika; asercje
// dotyczą filtra języka, nie tłumaczeń.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";
import type { AuthEmailEventsQuery, AuthEmailEventsReport } from "@/lib/email/auth-events.server";

const h = vi.hoisted(() => ({
  /** Zapytania, jakie wrapper złożył dla warstwy danych. */
  zapytania: [] as unknown[],
  /** Raport oddawany przez warstwę danych. */
  raport: null as unknown,
  /** Gdy ustawione, warstwa danych RZUCA tym komunikatem. */
  blad: null as string | null,
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdmin: { name: "requireAdmin" },
}));

vi.mock("@/lib/email/auth-events.server", () => ({
  fetchAuthEmailEvents: (query: unknown) => {
    h.zapytania.push(query);
    if (h.blad) return Promise.reject(new Error(h.blad));
    return Promise.resolve(h.raport);
  },
}));

import { getAuthEmailEvents } from "@/lib/auth-email-events.functions";

/** Raport w kształcie, jaki panel dostaje z serwera. */
const pustyRaport = (days: number): AuthEmailEventsReport => ({
  days,
  totals: { total: 0, enqueued: 0, failed: 0, pl: 0, en: 0, fallback: 0 },
  bySource: [],
  byType: [],
  rows: [],
  rowsTotal: 0,
  infraReady: true,
  generatedAt: "2026-08-22T10:00:00.000Z",
});

/** Kontekst, jaki middleware wstrzykuje w produkcji. Handler go nie używa. */
const kontekst = () => ({ supabase: null });

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  h.zapytania = [];
  h.raport = pustyRaport(7);
  h.blad = null;
});

describe("getAuthEmailEvents - obudowa funkcji serwerowej", () => {
  it("dziennik maili autoryzacyjnych jest zamknięty za rolą administratora", () => {
    // Wiersze niosą zamaskowane adresy, domeny nadawców i tematy wiadomości
    // wszystkich użytkowników. Usunięcie bramki otwiera je każdemu zalogowanemu.
    const nazwy = serverFnMiddlewareNames(getAuthEmailEvents);

    expect(nazwy).toContain("requireAdmin");
    expect(nazwy).toHaveLength(1);
  });

  it("odczyt dziennika deklaruje metodę GET", () => {
    const metoda = Reflect.get(getAuthEmailEvents as object, "method");

    expect(metoda).toBe("GET");
    expect(typeof metoda).toBe("string");
  });
});

describe("getAuthEmailEvents - walidator wejścia", () => {
  it("brak parametrów daje komplet wartości domyślnych", () => {
    // Panel wchodzi na zakładkę bez parametrów w URL-u; brak domyślnych
    // kończyłby się błędem przy pierwszym otwarciu diagnostyki.
    const dane = validateServerFnInput<AuthEmailEventsQuery>(getAuthEmailEvents, undefined);

    expect(dane).toEqual({
      days: 7,
      emailType: null,
      lang: null,
      status: null,
      fallbackOnly: false,
      search: null,
      page: 1,
      pageSize: 50,
    });
    expect(dane.days).toBe(7);
  });

  it("komplet poprawnych filtrów przechodzi bez zmiany", () => {
    const wejscie: AuthEmailEventsQuery = {
      days: 30,
      emailType: "recovery",
      lang: "en",
      status: "failed",
      fallbackOnly: true,
      search: "example.com",
      page: 3,
      pageSize: 25,
    };

    expect(validateServerFnInput(getAuthEmailEvents, wejscie)).toEqual(wejscie);
    expect(wejscie.pageSize).toBeLessThanOrEqual(100);
  });

  it("okno krótsze niż dzień i dłuższe niż kwartał jest odrzucane", () => {
    // Okno spoza zakresu to albo pusty raport („0 dni"), albo skan całej
    // tabeli - jedno i drugie wygląda w panelu jak awaria diagnostyki.
    expect(() => validateServerFnInput(getAuthEmailEvents, { days: 0 })).toThrow(ZodError);
    expect(() => validateServerFnInput(getAuthEmailEvents, { days: 91 })).toThrow(ZodError);
  });

  it("liczba dni musi być całkowita - ułamek dnia nie jest oknem raportu", () => {
    expect(() => validateServerFnInput(getAuthEmailEvents, { days: 1.5 })).toThrow(ZodError);
    expect(() => validateServerFnInput(getAuthEmailEvents, { days: "7" })).toThrow(ZodError);
  });

  it("pusty typ maila jest odrzucany, bo filtruje do zera bez powodu", () => {
    expect(() => validateServerFnInput(getAuthEmailEvents, { emailType: "" })).toThrow(ZodError);
    expect(() => validateServerFnInput(getAuthEmailEvents, { emailType: "x".repeat(61) })).toThrow(
      ZodError,
    );
  });

  it("nieobsługiwany język filtra jest odrzucany, nie zamieniany na null", () => {
    // Cicha zamiana pokazałaby operatorowi WSZYSTKIE języki, gdy pytał o jeden
    // - i utwierdziła go w fałszywym wniosku o wysyłce.
    expect(() => validateServerFnInput(getAuthEmailEvents, { lang: "de" })).toThrow(ZodError);
    expect(
      validateServerFnInput<AuthEmailEventsQuery>(getAuthEmailEvents, { lang: null }).lang,
    ).toBeNull();
  });

  it("nieznany status zdarzenia jest odrzucany", () => {
    expect(() => validateServerFnInput(getAuthEmailEvents, { status: "queued" })).toThrow(ZodError);
    expect(
      validateServerFnInput<AuthEmailEventsQuery>(getAuthEmailEvents, { status: "rejected" })
        .status,
    ).toBe("rejected");
  });

  it("przełącznik spadku języka musi być wartością logiczną", () => {
    expect(() => validateServerFnInput(getAuthEmailEvents, { fallbackOnly: "true" })).toThrow(
      ZodError,
    );
    expect(
      validateServerFnInput<AuthEmailEventsQuery>(getAuthEmailEvents, { fallbackOnly: true })
        .fallbackOnly,
    ).toBe(true);
  });

  it("fraza wyszukiwania ma twardy limit długości", () => {
    expect(() => validateServerFnInput(getAuthEmailEvents, { search: "x".repeat(161) })).toThrow(
      ZodError,
    );
    expect(
      validateServerFnInput<AuthEmailEventsQuery>(getAuthEmailEvents, { search: "x".repeat(160) })
        .search,
    ).toHaveLength(160);
  });

  it("numer strony poza zakresem jest odrzucany", () => {
    expect(() => validateServerFnInput(getAuthEmailEvents, { page: 0 })).toThrow(ZodError);
    expect(() => validateServerFnInput(getAuthEmailEvents, { page: 501 })).toThrow(ZodError);
  });

  it("rozmiar strony poniżej 10 i powyżej 100 jest odrzucany", () => {
    // Górny limit chroni panel przed pobraniem tysiąca wierszy naraz.
    expect(() => validateServerFnInput(getAuthEmailEvents, { pageSize: 9 })).toThrow(ZodError);
    expect(() => validateServerFnInput(getAuthEmailEvents, { pageSize: 101 })).toThrow(ZodError);
  });
});

describe("getAuthEmailEvents - ścieżka szczęśliwa", () => {
  it("przekazuje do warstwy danych DOKŁADNIE te filtry, które podał panel", async () => {
    // Zgubiony filtr to raport, który wygląda poprawnie, a odpowiada na inne
    // pytanie niż zadane - najgorszy możliwy wynik w narzędziu diagnostycznym.
    const wejscie: AuthEmailEventsQuery = {
      days: 14,
      emailType: "magiclink",
      lang: "pl",
      status: "enqueued",
      fallbackOnly: true,
      search: "nowak",
      page: 2,
      pageSize: 20,
    };
    h.raport = pustyRaport(14);

    await callServerFn(getAuthEmailEvents, { data: wejscie, context: kontekst() });

    expect(h.zapytania).toHaveLength(1);
    expect(h.zapytania[0]).toEqual(wejscie);
  });

  it("oddaje panelowi raport bez przepakowywania go po drodze", async () => {
    const raport = pustyRaport(7);
    raport.totals = { total: 3, enqueued: 2, failed: 1, pl: 2, en: 1, fallback: 1 };
    raport.byType = [{ type: "recovery", count: 3 }];
    h.raport = raport;

    const wynik = await callServerFn<AuthEmailEventsReport>(getAuthEmailEvents, {
      data: {},
      context: kontekst(),
    });

    expect(wynik.totals.total).toBe(3);
    expect(wynik.byType).toEqual([{ type: "recovery", count: 3 }]);
  });

  it("wartości domyślne docierają do warstwy danych, a nie gubią się po drodze", async () => {
    await callServerFn(getAuthEmailEvents, { data: undefined, context: kontekst() });

    expect(h.zapytania[0]).toEqual({
      days: 7,
      emailType: null,
      lang: null,
      status: null,
      fallbackOnly: false,
      search: null,
      page: 1,
      pageSize: 50,
    });
    expect(h.zapytania).toHaveLength(1);
  });
});

describe("getAuthEmailEvents - awaria odczytu i pusty wynik", () => {
  it("awaria odczytu NIE jest cicho zamieniana na pusty raport", async () => {
    // Pusty raport przy awarii bazy czyta się jak „nie wysłano żadnego maila"
    // - i kieruje diagnozę dokładnie w złą stronę.
    h.blad = "relation does not exist";

    await expect(
      callServerFn(getAuthEmailEvents, { data: {}, context: kontekst() }),
    ).rejects.toThrow("relation does not exist");
    expect(h.zapytania).toHaveLength(1);
  });

  it("pusty raport przechodzi do panelu jako pusty, nie jako brak danych", async () => {
    h.raport = pustyRaport(7);

    const wynik = await callServerFn<AuthEmailEventsReport>(getAuthEmailEvents, {
      data: {},
      context: kontekst(),
    });

    expect(wynik.rows).toEqual([]);
    expect(wynik.rowsTotal).toBe(0);
  });

  it("raport o braku infrastruktury dociera do panelu z flagą, a nie jako błąd", async () => {
    // Migracja jeszcze nie przeszła - panel ma o tym POWIEDZIEĆ, a nie
    // pokazać pustą tabelę udającą brak zdarzeń.
    const raport = pustyRaport(7);
    raport.infraReady = false;
    h.raport = raport;

    const wynik = await callServerFn<AuthEmailEventsReport>(getAuthEmailEvents, {
      data: {},
      context: kontekst(),
    });

    expect(wynik.infraReady).toBe(false);
    expect(wynik.rows).toEqual([]);
  });
});
