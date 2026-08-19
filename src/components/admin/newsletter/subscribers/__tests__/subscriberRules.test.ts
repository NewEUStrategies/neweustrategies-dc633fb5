// Reguły listy subskrybentów i odczytu ich szczegółów - warstwa czysta.
//
// Dwie z tych reguł dotykają zgody marketingowej, więc pomyłka nie jest
// kosmetyczna:
//   * FILTR decyduje, kogo operator widzi na liście - a od tego zależy, komu
//     potem ręcznie zmienia zgodę. Filtr gubiący wiersz prowadzi do decyzji
//     podjętej na niepełnej liście.
//   * ODCZYT ZGÓD odpowiada na pytanie „czy ta osoba zgodziła się na
//     marketing". Ładunek `jsonb` wpisują integracje, nie tylko nasz kod, więc
//     zgoda musi być UDZIELONA wyłącznie przy jawnym `true`.
// Trzecia - eksport CSV - wynosi dane osobowe do pliku: błąd w cytowaniu
// rozjeżdża kolumny u odbiorcy i przypisuje komuś cudzą zgodę.
import { describe, it, expect } from "vitest";
import {
  csvCell,
  csvFileName,
  filterSubscribers,
  isFetchCapped,
  subscribersToCsv,
  CSV_COLUMNS,
  SUBSCRIBER_FETCH_CAP,
  type SubscriberRow,
} from "@/components/admin/newsletter/subscribers/subscriberTable";
import {
  formatTimestamp,
  jsonStr,
  readConsents,
  readMeta,
} from "@/components/admin/newsletter/subscribers/subscriberDetail";

function row(overrides: Partial<SubscriberRow> = {}): SubscriberRow {
  return {
    id: "s-1",
    email: "anna@example.test",
    display_name: "Anna Nowak",
    language: "pl",
    status: "subscribed",
    source: "formularz",
    created_at: "2026-08-01T10:00:00.000Z",
    confirmed_at: "2026-08-01T10:05:00.000Z",
    ...overrides,
  };
}

const LIST: SubscriberRow[] = [
  row({
    id: "a",
    email: "anna@example.test",
    display_name: "Anna Nowak",
    status: "subscribed",
    language: "pl",
  }),
  row({
    id: "b",
    email: "borys@example.test",
    display_name: "Borys Kowal",
    status: "pending",
    language: "en",
  }),
  row({
    id: "c",
    email: "cezary@example.test",
    display_name: null,
    status: "unsubscribed",
    language: "pl",
  }),
];

const ALL = { q: "", status: "all", lang: "all" } as const;

describe("filterSubscribers - status", () => {
  it("bez filtra pokazuje wszystkich", () => {
    expect(filterSubscribers(LIST, ALL)).toHaveLength(3);
  });

  it.each(["subscribed", "pending", "unsubscribed"] as const)(
    "filtruje po statusie %s",
    (status) => {
      const result = filterSubscribers(LIST, { ...ALL, status });

      expect(result).toHaveLength(1);
      expect(result[0]?.status).toBe(status);
    },
  );
});

describe("filterSubscribers - język", () => {
  it("filtruje po języku", () => {
    expect(filterSubscribers(LIST, { ...ALL, lang: "en" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterSubscribers(LIST, { ...ALL, lang: "pl" }).map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("filterSubscribers - szukanie", () => {
  it("szuka po adresie, bez wielkości liter", () => {
    expect(filterSubscribers(LIST, { ...ALL, q: "BORYS" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterSubscribers(LIST, { ...ALL, q: "borys" }).map((r) => r.id)).toEqual(["b"]);
  });

  it("szuka też po nazwie wyświetlanej - operator wpisuje jedno albo drugie", () => {
    expect(filterSubscribers(LIST, { ...ALL, q: "Kowal" }).map((r) => r.id)).toEqual(["b"]);
    // Nazwa działa niezależnie od wielkości liter, tak jak adres.
    expect(filterSubscribers(LIST, { ...ALL, q: "kowal" }).map((r) => r.id)).toEqual(["b"]);
  });

  it("wiersz BEZ nazwy nie wywraca szukania", () => {
    const result = filterSubscribers(LIST, { ...ALL, q: "cezary" });

    expect(result.map((r) => r.id)).toEqual(["c"]);
    expect(result[0]?.display_name).toBeNull();
  });

  it("białe znaki wokół frazy są ignorowane", () => {
    expect(filterSubscribers(LIST, { ...ALL, q: "   anna   " }).map((r) => r.id)).toEqual(["a"]);
    // Ten sam wynik co bez spacji - inaczej operator kopiujący adres z maila
    // dostawałby pustą listę.
    expect(filterSubscribers(LIST, { ...ALL, q: "anna" }).map((r) => r.id)).toEqual(["a"]);
  });

  it("fraza złożona z samych białych znaków nie filtruje", () => {
    expect(filterSubscribers(LIST, { ...ALL, q: "    " })).toHaveLength(3);
    expect(filterSubscribers(LIST, { ...ALL, q: "" })).toHaveLength(3);
  });

  it("fraza bez trafień daje pustą listę, nie całą", () => {
    expect(filterSubscribers(LIST, { ...ALL, q: "nie-ma-takiego" })).toEqual([]);
    // Lista wejściowa zostaje nietknięta.
    expect(LIST).toHaveLength(3);
  });

  it("dopasowanie jest po FRAGMENCIE, nie po całości", () => {
    expect(filterSubscribers(LIST, { ...ALL, q: "example.test" })).toHaveLength(3);
    // Fragment ze środka adresu, nie tylko z początku.
    expect(filterSubscribers(LIST, { ...ALL, q: "@example" })).toHaveLength(3);
  });
});

describe("filterSubscribers - filtry składane", () => {
  it("wszystkie trzy warunki muszą być spełnione naraz", () => {
    expect(
      filterSubscribers(LIST, { q: "anna", status: "subscribed", lang: "pl" }).map((r) => r.id),
    ).toEqual(["a"]);
    // Ten sam adres, ale niepasujący status -> zero trafień.
    expect(filterSubscribers(LIST, { q: "anna", status: "pending", lang: "pl" })).toEqual([]);
  });

  it("pusta lista wejściowa daje pustą wyjściową", () => {
    expect(filterSubscribers([], { q: "anna", status: "subscribed", lang: "pl" })).toEqual([]);
    // Także bez żadnych filtrów - nie ma z czego zrobić wiersza.
    expect(filterSubscribers([], ALL)).toEqual([]);
  });
});

describe("isFetchCapped - kiedy lista MOŻE być niepełna", () => {
  it("poniżej limitu odczyt jest pełny", () => {
    expect(isFetchCapped(0)).toBe(false);
    expect(isFetchCapped(SUBSCRIBER_FETCH_CAP - 1)).toBe(false);
  });

  it("DOKŁADNIE na limicie już ostrzegamy - nie wiemy, czy nie ucięło", () => {
    expect(isFetchCapped(SUBSCRIBER_FETCH_CAP)).toBe(true);
    expect(isFetchCapped(SUBSCRIBER_FETCH_CAP + 1)).toBe(true);
  });
});

describe("csvCell - cytowanie RFC 4180", () => {
  it("zwykła wartość idzie bez cytowania", () => {
    expect(csvCell("anna@example.test")).toBe("anna@example.test");
    expect(csvCell("Anna Nowak")).toBe("Anna Nowak");
  });

  it("PRZECINEK w wartości wymusza cytowanie - inaczej rozjeżdża kolumny", () => {
    expect(csvCell("Nowak, Anna")).toBe('"Nowak, Anna"');
    // Bez przecinka nie ma cytowania - plik zostaje czytelny.
    expect(csvCell("Nowak Anna")).toBe("Nowak Anna");
  });

  it("CUDZYSŁÓW jest podwajany wewnątrz cytowanej wartości", () => {
    expect(csvCell('Anna "Ania" Nowak')).toBe('"Anna ""Ania"" Nowak"');
    // Sam cudzysłów wymusza cytowanie także bez przecinka.
    expect(csvCell('Anna"')).toBe('"Anna"""');
  });

  it("nowa linia w wartości też wymusza cytowanie", () => {
    expect(csvCell("Anna\nNowak")).toBe('"Anna\nNowak"');
    expect(csvCell("Anna\r\nNowak")).toBe('"Anna\r\nNowak"');
  });

  it("brak wartości daje pustą komórkę, nie „null”", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("subscribersToCsv", () => {
  it("pierwszy wiersz to nagłówek w ustalonej kolejności", () => {
    const csv = subscribersToCsv([row()]);

    expect(csv.split("\n")[0]).toBe(CSV_COLUMNS.join(","));
    expect(CSV_COLUMNS[0]).toBe("email");
  });

  it("każdy subskrybent to jeden wiersz", () => {
    const csv = subscribersToCsv(LIST);

    expect(csv.split("\n")).toHaveLength(4);
    expect(csv).toContain("borys@example.test");
  });

  it("brakujące pola stają się pustymi komórkami", () => {
    const csv = subscribersToCsv([row({ display_name: null, source: null, confirmed_at: null })]);

    expect(csv.split("\n")[1]).toBe("anna@example.test,,pl,subscribed,,2026-08-01T10:00:00.000Z,");
    // Puste komórki, nie słowo „null" w pliku, który idzie do arkusza.
    expect(csv).not.toContain("null");
  });

  it("wartość z przecinkiem NIE psuje układu kolumn", () => {
    const csv = subscribersToCsv([row({ display_name: "Nowak, Anna" })]);
    const line = csv.split("\n")[1] ?? "";

    expect(line).toContain('"Nowak, Anna"');
    // Siedem kolumn = sześć przecinków rozdzielających + jeden w cudzysłowie.
    expect(line.split('"')[2]?.split(",")).toHaveLength(6);
  });

  it("pusta lista daje sam nagłówek", () => {
    expect(subscribersToCsv([])).toBe(CSV_COLUMNS.join(","));
    expect(subscribersToCsv([]).split("\n")).toHaveLength(1);
  });
});

describe("csvFileName", () => {
  it("nazwa pliku niesie datę eksportu", () => {
    expect(csvFileName("2026-08-18T15:30:00.000Z")).toBe("newsletter-2026-08-18.csv");
    // Inna data daje inny plik - eksporty z dwóch dni się nie nadpisują.
    expect(csvFileName("2026-08-19T15:30:00.000Z")).toBe("newsletter-2026-08-19.csv");
  });

  it("bez godziny w nazwie - eksport dzienny", () => {
    expect(csvFileName("2026-01-02T00:00:00.000Z")).not.toContain(":");
    expect(csvFileName("2026-01-02T00:00:00.000Z")).toBe("newsletter-2026-01-02.csv");
  });
});

describe("jsonStr", () => {
  it("przepuszcza napis, odrzuca wszystko inne", () => {
    expect(jsonStr("tekst")).toBe("tekst");
    expect(jsonStr(42)).toBeUndefined();
    expect(jsonStr(null)).toBeUndefined();
    expect(jsonStr(undefined)).toBeUndefined();
  });
});

describe("readConsents - odczyt zgód z jsonb", () => {
  it("czyta komplet pól wpisu zgody", () => {
    const consents = readConsents([
      {
        key: "marketing",
        text: "Zgoda marketingowa",
        given: true,
        lang: "pl",
        at: "2026-08-01T10:00:00.000Z",
      },
    ]);

    expect(consents).toHaveLength(1);
    expect(consents[0]).toEqual({
      key: "marketing",
      text: "Zgoda marketingowa",
      given: true,
      lang: "pl",
      at: "2026-08-01T10:00:00.000Z",
    });
  });

  it("zgoda jest UDZIELONA wyłącznie przy jawnym `true`", () => {
    // Ładunek z obcej integracji: „truthy" nie może wystarczyć, bo zapisałoby
    // zgodę, której nie ma.
    const consents = readConsents([
      { key: "a", given: true },
      { key: "b", given: "yes" },
      { key: "c", given: 1 },
      { key: "d", given: false },
      { key: "e" },
    ]);

    expect(consents.map((c) => c.given)).toEqual([true, false, false, false, false]);
    expect(consents).toHaveLength(5);
  });

  it("wpis, który NIE jest obiektem, jest pomijany - nie renderujemy pustego pola", () => {
    const consents = readConsents(["tekst", 42, null, ["tablica"], { key: "prawdziwa" }]);

    expect(consents).toHaveLength(1);
    expect(consents[0]?.key).toBe("prawdziwa");
  });

  it("pola o złym typie schodzą na `undefined`, a nie na „42”", () => {
    const consents = readConsents([{ key: 42, text: null, lang: [], at: {} }]);

    expect(consents[0]?.key).toBeUndefined();
    expect(consents[0]?.text).toBeUndefined();
    expect(consents[0]?.at).toBeUndefined();
  });

  it("kolumna, która nie jest tablicą, daje brak zgód", () => {
    expect(readConsents(null)).toEqual([]);
    expect(readConsents("tekst")).toEqual([]);
    expect(readConsents({ key: "marketing" })).toEqual([]);
    expect(readConsents([])).toEqual([]);
  });
});

describe("readMeta - odczyt metadanych z jsonb", () => {
  it("zwraca pary klucz-wartość w kolejności zapisu", () => {
    expect(readMeta({ company: "ACME", phone: "+48 111" })).toEqual([
      ["company", "ACME"],
      ["phone", "+48 111"],
    ]);
    // Kolejność odwrotna daje odwrotny wynik - to nie sortowanie alfabetyczne.
    expect(readMeta({ phone: "+48 111", company: "ACME" })[0]![0]).toBe("phone");
  });

  it("wartości nietekstowe są sprowadzane do tekstu", () => {
    expect(readMeta({ liczba: 42, flaga: true, nic: null })).toEqual([
      ["liczba", "42"],
      ["flaga", "true"],
      ["nic", "null"],
    ]);
    // Każda wartość jest napisem - panel renderuje je bez własnego rzutowania.
    expect(readMeta({ liczba: 42 }).every(([, v]) => typeof v === "string")).toBe(true);
  });

  it("kolumna, która nie jest obiektem, daje brak metadanych", () => {
    expect(readMeta(null)).toEqual([]);
    expect(readMeta("tekst")).toEqual([]);
    expect(readMeta(["tablica"])).toEqual([]);
    expect(readMeta({})).toEqual([]);
  });
});

describe("formatTimestamp", () => {
  it("brak znacznika daje kreskę, nie „Invalid Date”", () => {
    expect(formatTimestamp(null)).toBe("-");
  });

  it("wartość nieparsowalna też daje kreskę", () => {
    expect(formatTimestamp("nie jest datą")).toBe("-");
    expect(formatTimestamp("")).toBe("-");
  });

  it("poprawny znacznik jest formatowany", () => {
    const formatted = formatTimestamp("2026-08-18T10:00:00.000Z");

    expect(formatted).not.toBe("-");
    expect(formatted).toContain("2026");
  });
});
