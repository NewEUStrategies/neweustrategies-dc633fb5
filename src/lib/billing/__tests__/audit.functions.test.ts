// Obudowa server fn AUDYTU ROZLICZEŃ (`audit.functions.ts`) - 50 linii, 0%
// pokrycia do 31.08.2026 (0 z 4 funkcji, 0 z 6 gałęzi).
//
// PO CO TEN PLIK ISTNIEJE. Implementacja audytu (`audit.server.ts`) ma własne
// testy - tutaj chodzi o coś innego: o OPAKOWANIE. Między przeglądarką a bazą
// stoi dokładnie jedna bramka kształtu danych, czyli schemat zod z tego pliku,
// i do dziś nikt jej nie dotknął testem. To ona decyduje, czy zapytanie o
// materiał księgowy pójdzie na konto PIASKOWNICOWE, czy na PRODUKCYJNE, jak
// szerokie będzie okno czasowe i czy filtr po wydarzeniu trafi do zapytania
// JSON-owego (`metadata->>event_id`) jako identyfikator, a nie jako dowolny
// tekst od klienta.
//
// TRZY RZECZY, KTÓRYCH PILNUJE TEN PLIK:
//   1. ENUM `environment`. Wartość spoza listy MUSI zostać odrzucona. To
//      jedyne rozróżnienie między raportem z konta testowego a wyciągiem
//      z prawdziwych pieniędzy - literówka („prod", „LIVE", „ live") nie może
//      się przemienić w cichy odczyt nie tej bazy.
//   2. OKNO CZASOWE. `sinceHours` idzie prosto do arytmetyki daty
//      (`Date.now() - sinceHours * 3600_000`). Zero, wartość ujemna, ułamek
//      albo tekst „168" zamieniłyby zakres w bezsens (okno w przyszłość albo
//      `Invalid Date`), a limit 500 wierszy sprawiłby, że nikt tego nie
//      zauważy - raport po prostu byłby pusty albo nie ten.
//   3. KOLEJNOŚĆ BRAMEK w handlerze. `assertAdmin` MA iść przed jakąkolwiek
//      pracą. Zalogowany bez roli nie może wywołać nawet odczytu.
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI. Harness (`src/test/serverFnHarness.ts`)
// nie uruchamia middleware, więc `requireSupabaseAuth` przybijamy STRUKTURALNIE
// - test mówi „ta funkcja deklaruje bramkę", a nie „bramka nikogo nie wpuści".
//
// Atrapy stoją na GRANICACH: implementacja audytu i kontrola roli. Schematy zod
// biegną PRAWDZIWE - to ich zachowanie jest przedmiotem dowodu.
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
  buildAuditReport: vi.fn(),
  buildAuditExport: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/lib/billing/diagnostics.server", () => ({ assertAdmin: h.assertAdmin }));
vi.mock("@/lib/billing/audit.server", () => ({
  buildAuditReport: h.buildAuditReport,
  buildAuditExport: h.buildAuditExport,
}));

import { exportBillingAudit, getBillingAudit } from "@/lib/billing/audit.functions";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";

/** Znaczniki tożsamości - dowodzą przekazania TEGO SAMEGO obiektu, nie kopii. */
const RAPORT = { marker: "raport-audytu" };
const PLIK = { marker: "plik-eksportu" };
/** Klient z kontekstu middleware - handler ma go oddać kontroli roli. */
const KLIENT_UZYTKOWNIKA = { marker: "klient-z-kontekstu" };

/** Kształt, jaki schemat zakresu ma oddać po walidacji. */
interface ZakresAudytu {
  environment: "sandbox" | "live";
  sinceHours: number;
  eventId?: string | null;
}

/** Kształt eksportu: zakres plus format pliku. */
interface ZakresEksportu extends ZakresAudytu {
  format: "csv" | "xlsx";
}

function kontekst() {
  return { supabase: KLIENT_UZYTKOWNIKA, userId: ADMIN_ID };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assertAdmin.mockResolvedValue(undefined);
  h.buildAuditReport.mockResolvedValue(RAPORT);
  h.buildAuditExport.mockResolvedValue(PLIK);
});

describe("obudowa - bramka i metoda", () => {
  it("obie funkcje audytu deklarują bramkę uwierzytelnienia", () => {
    // Dowód STRUKTURALNY: harness nie wykonuje middleware, więc zieleń
    // pozostałych testów mówi o logice handlera, a nie o dostępie. Gdyby ta
    // deklaracja zniknęła, materiał księgowy (kwoty, identyfikatory klientów
    // operatora, adresy zwrotne) dałoby się pobrać bez sesji.
    expect(serverFnMiddlewareNames(getBillingAudit)).toEqual(["requireSupabaseAuth"]);
    expect(serverFnMiddlewareNames(exportBillingAudit)).toEqual(["requireSupabaseAuth"]);
  });

  it("obie idą metodą POST, a nie GET", () => {
    // To nie kosmetyka. Zakres audytu niesie `eventId` i okno czasowe; przy
    // GET wylądowałyby w adresie, czyli w logach serwera, historii przeglądarki
    // i nagłówku `Referer`. Zmiana metody na GET byłaby cichym wyciekiem
    // identyfikatorów wydarzeń płatniczych do miejsc, których nikt nie czyści.
    expect(asServerFn(getBillingAudit).method).toBe("POST");
    expect(asServerFn(exportBillingAudit).method).toBe("POST");
  });
});

describe("walidator zakresu - środowisko", () => {
  it("obie wartości enuma przechodzą i nie są przerabiane", () => {
    expect(validateServerFnInput<ZakresAudytu>(getBillingAudit, { environment: "sandbox" })).toEqual(
      { environment: "sandbox", sinceHours: 168 },
    );
    expect(validateServerFnInput<ZakresAudytu>(getBillingAudit, { environment: "live" })).toEqual({
      environment: "live",
      sinceHours: 168,
    });
  });

  it("wartość spoza enuma jest ODRZUCANA - to jedyne rozróżnienie piaskownicy od produkcji", () => {
    // Gdyby schemat przepuszczał cokolwiek, filtr `.eq("environment", ...)`
    // po prostu nie trafiłby w żaden wiersz i audyt oddałby PUSTY raport -
    // wynik nie do odróżnienia od „nie było transakcji". Przy zamknięciu
    // miesiąca to jest różnica między „zgadza się" a „nie ma czego zgadzać".
    for (const zle of ["prod", "production", "test", "", "sandboxes"]) {
      expect(() => validateServerFnInput(getBillingAudit, { environment: zle })).toThrow(ZodError);
    }
  });

  it("wielkość liter i białe znaki NIE są normalizowane - „LIVE” i „ live” to odmowa", () => {
    // Świadome pinowanie kontraktu: schemat nie ma `.trim()` ani
    // `.toLowerCase()`. Gdyby ktoś dołożył normalizację, wartość z panelu
    // przestałaby być dosłowna, a enum nie byłby już twardą bramką.
    expect(() => validateServerFnInput(getBillingAudit, { environment: "LIVE" })).toThrow(ZodError);
    expect(() => validateServerFnInput(getBillingAudit, { environment: " live" })).toThrow(ZodError);
    expect(() => validateServerFnInput(getBillingAudit, { environment: "live " })).toThrow(ZodError);
  });

  it("brak środowiska to odmowa - nie ma wartości domyślnej", () => {
    // Domyślne środowisko byłoby tu najgorszym z możliwych ułatwień: pomyłka
    // w panelu cicho czytałaby nie ten zbiór pieniędzy.
    expect(() => validateServerFnInput(getBillingAudit, {})).toThrow(ZodError);
    expect(() => validateServerFnInput(getBillingAudit, { sinceHours: 24 })).toThrow(ZodError);
    expect(() => validateServerFnInput(getBillingAudit, { environment: null })).toThrow(ZodError);
  });

  it("brak ładunku w ogóle to odmowa, a nie pusty zakres", () => {
    expect(() => validateServerFnInput(getBillingAudit, undefined)).toThrow(ZodError);
    expect(() => validateServerFnInput(getBillingAudit, null)).toThrow(ZodError);
    expect(() => validateServerFnInput(getBillingAudit, "live")).toThrow(ZodError);
  });
});

describe("walidator zakresu - okno czasowe", () => {
  it("brak okna oznacza tydzień (168 h), a nie „od początku świata”", () => {
    // Wartość domyślna jest częścią kontraktu wydajnościowego: audyt ma być
    // szybki i mieścić się w limicie 500 wierszy.
    expect(validateServerFnInput<ZakresAudytu>(getBillingAudit, { environment: "live" }).sinceHours)
      .toBe(168);
  });

  it("skrajne wartości okna przechodzą: 1 godzina i 8760 godzin (rok)", () => {
    expect(
      validateServerFnInput<ZakresAudytu>(getBillingAudit, { environment: "live", sinceHours: 1 })
        .sinceHours,
    ).toBe(1);
    expect(
      validateServerFnInput<ZakresAudytu>(getBillingAudit, {
        environment: "live",
        sinceHours: 8760,
      }).sinceHours,
    ).toBe(8760);
  });

  it("zero, wartość ujemna i przekroczony sufit są odrzucane", () => {
    // `sinceHours` idzie do `Date.now() - sinceHours * 3600_000`. Zero daje
    // okno zerowe (raport zawsze pusty), wartość ujemna okno w PRZYSZŁOŚĆ
    // (raport zawsze pusty z innego powodu) - i żadne z tych dwóch nie
    // wygląda na błąd, tylko na „brak transakcji".
    for (const zle of [0, -1, -168, 8761, Number.MAX_SAFE_INTEGER]) {
      expect(() =>
        validateServerFnInput(getBillingAudit, { environment: "live", sinceHours: zle }),
      ).toThrow(ZodError);
    }
  });

  it("tekst zamiast liczby jest odrzucany - „168” to nie 168", () => {
    // Formularz w przeglądarce oddaje wartości pól jako tekst. Bez tej bramki
    // `"168" * 3600_000` policzyłoby się poprawnie (JavaScript), ale
    // `"abc" * 3600_000` dałoby `NaN` i `Invalid Date` w zapytaniu.
    for (const zle of ["168", "", "abc", true, [168], { value: 168 }]) {
      expect(() =>
        validateServerFnInput(getBillingAudit, { environment: "live", sinceHours: zle }),
      ).toThrow(ZodError);
    }
  });

  it("ułamek i NaN są odrzucane - okno liczy się w pełnych godzinach", () => {
    for (const zle of [1.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        validateServerFnInput(getBillingAudit, { environment: "live", sinceHours: zle }),
      ).toThrow(ZodError);
    }
  });
});

describe("walidator zakresu - filtr po wydarzeniu", () => {
  it("poprawny UUID przechodzi, `null` i brak pola też", () => {
    // Trzy poprawne stany: „filtruj po tym wydarzeniu", „nie filtruj"
    // (jawne `null` z panelu) i „nie filtruj" (brak pola).
    expect(
      validateServerFnInput<ZakresAudytu>(getBillingAudit, {
        environment: "live",
        eventId: EVENT_ID,
      }).eventId,
    ).toBe(EVENT_ID);
    expect(
      validateServerFnInput<ZakresAudytu>(getBillingAudit, { environment: "live", eventId: null })
        .eventId,
    ).toBeNull();
    expect(
      validateServerFnInput<ZakresAudytu>(getBillingAudit, { environment: "live" }),
    ).not.toHaveProperty("eventId");
  });

  it("cokolwiek innego niż UUID jest odrzucane - także pusty tekst", () => {
    // Ta wartość ląduje w filtrze na JSON-ie (`metadata->>event_id`). Pusty
    // tekst z niewypełnionego pola formularza zawęziłby raport do zamówień
    // z pustym identyfikatorem wydarzenia, czyli po cichu do niczego.
    for (const zle of ["", " ", "abc", "22222222-2222-4222-8222", 42, EVENT_ID + "x"]) {
      expect(() =>
        validateServerFnInput(getBillingAudit, { environment: "live", eventId: zle }),
      ).toThrow(ZodError);
    }
  });
});

describe("walidator eksportu - format pliku", () => {
  it("brak formatu oznacza CSV", () => {
    expect(
      validateServerFnInput<ZakresEksportu>(exportBillingAudit, { environment: "live" }),
    ).toEqual({ environment: "live", sinceHours: 168, format: "csv" });
  });

  it("oba formaty z listy przechodzą", () => {
    expect(
      validateServerFnInput<ZakresEksportu>(exportBillingAudit, {
        environment: "live",
        format: "xlsx",
      }).format,
    ).toBe("xlsx");
    expect(
      validateServerFnInput<ZakresEksportu>(exportBillingAudit, {
        environment: "live",
        format: "csv",
      }).format,
    ).toBe("csv");
  });

  it("format spoza listy jest odrzucany", () => {
    // `buildAuditExport` rozgałęzia się na dokładnie dwa formaty. Wartość
    // spoza listy nie wywaliłaby się głośno - wpadłaby w gałąź XLSX i oddała
    // plik z nazwą, o którą nikt nie prosił.
    for (const zle of ["pdf", "CSV", "xls", "", null]) {
      expect(() =>
        validateServerFnInput(exportBillingAudit, { environment: "live", format: zle }),
      ).toThrow(ZodError);
    }
  });

  it("eksport dziedziczy WSZYSTKIE reguły zakresu", () => {
    // `exportSchema` powstaje przez `.extend()` na schemacie zapytania -
    // rozjazd między tymi dwiema bramkami znaczyłby, że eksport wypuszcza
    // zakres, którego podgląd by nie przyjął.
    expect(() =>
      validateServerFnInput(exportBillingAudit, { environment: "prod", format: "csv" }),
    ).toThrow(ZodError);
    expect(() =>
      validateServerFnInput(exportBillingAudit, {
        environment: "live",
        sinceHours: 0,
        format: "csv",
      }),
    ).toThrow(ZodError);
  });
});

describe("walidator - klucze spoza schematu", () => {
  it("nadmiarowe pola są odcinane, nie przekazywane dalej", () => {
    // `z.object` domyślnie zdejmuje nieznane klucze. To jest realna bramka:
    // gdyby ładunek przechodził w całości, każde przyszłe rozszerzenie
    // `AuditQuery` dałoby się sterować z przeglądarki (np. podniesienie
    // limitu wierszy albo obejście filtra środowiska).
    expect(
      validateServerFnInput<ZakresAudytu>(getBillingAudit, {
        environment: "live",
        sinceHours: 24,
        rowLimit: 100000,
        tenantId: "obcy-najemca",
      }),
    ).toEqual({ environment: "live", sinceHours: 24 });
  });
});

describe("handler raportu - co robi z argumentami", () => {
  it("rola jest sprawdzana PRZED odczytem czegokolwiek", () => {
    // Kolejność ma znaczenie: zalogowany bez roli nie może po komunikacie
    // błędu wnioskować o zawartości bazy rozliczeniowej.
    h.assertAdmin.mockRejectedValue(new Error("forbidden"));

    return expect(
      callServerFn(getBillingAudit, { data: { environment: "live" }, context: kontekst() }),
    )
      .rejects.toThrow("forbidden")
      .then(() => {
        expect(h.buildAuditReport).not.toHaveBeenCalled();
      });
  });

  it("kontrola roli dostaje klienta i użytkownika Z KONTEKSTU, nie z ładunku", async () => {
    // Tożsamość bierze się z tokenu sesji (kontekst wstrzyknięty przez
    // middleware). Gdyby handler czytał `userId` z ładunku, sprawdzenie roli
    // dałoby się przejść, podając cudzy identyfikator.
    await callServerFn(getBillingAudit, {
      data: { environment: "live", userId: "podstawiony" },
      context: kontekst(),
    });

    expect(h.assertAdmin).toHaveBeenCalledWith(KLIENT_UZYTKOWNIKA, ADMIN_ID);
  });

  it("zakres jedzie do implementacji 1:1, a brak filtra staje się jawnym `null`", async () => {
    // `buildAuditReport` rozgałęzia się na `if (query.eventId)`. Przekazanie
    // `undefined` zadziałałoby tak samo, ale kontrakt `AuditQuery` mówi
    // `string | null` - jawne `null` jest tym, co pilnujemy.
    await callServerFn(getBillingAudit, {
      data: { environment: "sandbox", sinceHours: 24 },
      context: kontekst(),
    });

    expect(h.buildAuditReport).toHaveBeenCalledWith({
      environment: "sandbox",
      sinceHours: 24,
      eventId: null,
    });
  });

  it("filtr po wydarzeniu jest przekazywany dalej", async () => {
    await callServerFn(getBillingAudit, {
      data: { environment: "live", sinceHours: 72, eventId: EVENT_ID },
      context: kontekst(),
    });

    expect(h.buildAuditReport).toHaveBeenCalledWith({
      environment: "live",
      sinceHours: 72,
      eventId: EVENT_ID,
    });
  });

  it("oddaje raport implementacji bez własnego przetwarzania", async () => {
    const wynik = await callServerFn(getBillingAudit, {
      data: { environment: "live" },
      context: kontekst(),
    });

    // `toBe`, nie `toEqual`: dowodzimy, że opakowanie nie kopiuje ani nie
    // przycina raportu (kopia gubi pola dodane po stronie implementacji).
    expect(wynik).toBe(RAPORT);
  });
});

describe("handler eksportu - co robi z argumentami", () => {
  it("rola jest sprawdzana przed zbudowaniem czegokolwiek", () => {
    h.assertAdmin.mockRejectedValue(new Error("forbidden"));

    return expect(
      callServerFn(exportBillingAudit, {
        data: { environment: "live", format: "xlsx" },
        context: kontekst(),
      }),
    )
      .rejects.toThrow("forbidden")
      .then(() => {
        expect(h.buildAuditReport).not.toHaveBeenCalled();
        expect(h.buildAuditExport).not.toHaveBeenCalled();
      });
  });

  it("plik powstaje z RAPORTU tego samego zakresu, a nie z osobnego zapytania", async () => {
    // Eksport księgowy musi pokazywać dokładnie to, co podgląd. Zbudowanie
    // pliku z innego zakresu byłoby rozjazdem między ekranem a załącznikiem
    // wysyłanym do księgowości.
    await callServerFn(exportBillingAudit, {
      data: { environment: "live", sinceHours: 48, eventId: EVENT_ID, format: "xlsx" },
      context: kontekst(),
    });

    expect(h.buildAuditReport).toHaveBeenCalledWith({
      environment: "live",
      sinceHours: 48,
      eventId: EVENT_ID,
    });
    expect(h.buildAuditExport).toHaveBeenCalledWith(RAPORT, "xlsx");
  });

  it("domyślny format CSV dojeżdża do budowy pliku", async () => {
    await callServerFn(exportBillingAudit, {
      data: { environment: "sandbox" },
      context: kontekst(),
    });

    expect(h.buildAuditExport).toHaveBeenCalledWith(RAPORT, "csv");
  });

  it("oddaje plik implementacji bez własnego przetwarzania", async () => {
    const wynik = await callServerFn(exportBillingAudit, {
      data: { environment: "live" },
      context: kontekst(),
    });

    expect(wynik).toBe(PLIK);
  });
});
