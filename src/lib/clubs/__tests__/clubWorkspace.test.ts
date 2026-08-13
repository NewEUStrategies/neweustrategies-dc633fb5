// Kontrakt przestrzeni roboczej klubu (A28).
//
// DWIE RZECZY, KTÓRE TE TESTY PILNUJĄ:
//
// 1) SŁOWNIK KLIENTA = CHECK W BAZIE. Droplista z wartością spoza CHECK-a to
//    błąd, który widać dopiero przy zapisie - czyli po stracie tego, co
//    użytkownik wpisał. Zamiast przepisywać wartości do testu ręcznie (bo taka
//    kopia rozjeżdża się razem z oryginałem), czytamy CHECK-i wprost z pliku
//    migracji.
//
// 2) NIEZNANA WARTOŚĆ NIE WYWRACA INTERFEJSU. Baza jest forward-only, więc
//    klient prędzej czy później zobaczy wartość, której jego wersja jeszcze nie
//    zna - i musi to przeżyć, degradując do bezpiecznej gałęzi.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CLUB_DOCUMENT_KINDS,
  CLUB_DOCUMENT_STATUSES,
  CLUB_DOCUMENT_VISIBILITIES,
  CLUB_EVENT_KINDS,
  CLUB_EVENT_STATUSES,
  CLUB_MILESTONE_STATES,
  CLUB_PRODUCT_KINDS,
  CLUB_RSVP_STATES,
  CLUB_SOURCE_KINDS,
  documentHref,
  isClubProductKind,
  isEventFull,
  isEventLive,
  isMilestoneOverdue,
  parseContributors,
  parseGroupBreakdown,
  parseKindBreakdown,
  toDocumentKind,
  toDocumentStatus,
  toDocumentVisibility,
  toEventKind,
  toEventStatus,
  toMilestoneState,
  toRsvpState,
  type ClubDocumentRow,
  type ClubEventRow,
  type ClubMilestoneRow,
} from "../workspaceTypes";

const MIGRATION = "supabase/migrations/20260808300000_discussion_clubs_a28_workspace.sql";

/**
 * Migracje redefiniujące CHECK-i z A28. Baza jest forward-only, więc definicja
 * z `CREATE TABLE` przestaje być prawdą w chwili, gdy późniejsza migracja robi
 * `DROP CONSTRAINT` + `ADD CONSTRAINT` - a wtedy test czytający wyłącznie A28
 * porównuje słownik klienta z NIEAKTUALNYM kontraktem i albo świeci czerwono
 * bez powodu, albo (gorzej) przepuszcza rozjazd w drugą stronę.
 *
 * Kolejność = kolejność stosowania; wygrywa OSTATNIA definicja, tak samo jak
 * w `extractLatestDefinitions` dla funkcji.
 */
const OVERRIDES: readonly string[] = [
  "supabase/migrations/20260809000000_discussion_clubs_a29_products_and_topic_sections.sql",
];

/**
 * Wartości z pierwszego `CHECK (<kolumna> IN (...))` dla podanej kolumny.
 * Świadomie bierzemy PIERWSZE wystąpienie: kolumna jest deklarowana raz,
 * a dalsze wzmianki tej samej nazwy (np. `kind` w innej tabeli) mają własne
 * wywołanie tej funkcji z własnym kontekstem tabeli.
 */
function checkValues(sql: string, table: string, column: string): string[] {
  const tableStart = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`);
  expect(tableStart, `brak tabeli ${table} w migracji`).toBeGreaterThan(-1);
  const body = sql.slice(tableStart);
  const pattern = new RegExp(
    `${column}\\s+text[^,]*?CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`,
    "s",
  );
  const match = pattern.exec(body);
  expect(match, `brak CHECK-a dla ${table}.${column}`).not.toBeNull();
  return [...(match?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? "").sort();
}

/** Wartości z `ADD CONSTRAINT <tabela>_<kolumna>_check CHECK (<kolumna> IN (...))`. */
function overriddenCheckValues(table: string, column: string): string[] | null {
  for (const file of [...OVERRIDES].reverse()) {
    const sql = readFileSync(file, "utf8");
    const pattern = new RegExp(
      `ADD CONSTRAINT\\s+${table}_${column}_check\\s+CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`,
      "s",
    );
    const match = pattern.exec(sql);
    if (match !== null) {
      return [...(match[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? "").sort();
    }
  }
  return null;
}

/** Kontrakt OBOWIĄZUJĄCY: nadpisanie, a gdy go nie ma - deklaracja z A28. */
function effectiveCheckValues(sql: string, table: string, column: string): string[] {
  return overriddenCheckValues(table, column) ?? checkValues(sql, table, column);
}

describe("słowniki A28 odpowiadają CHECK-om w migracji", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it.each([
    ["club_documents", "kind", CLUB_DOCUMENT_KINDS],
    ["club_documents", "visibility", CLUB_DOCUMENT_VISIBILITIES],
    ["club_documents", "status", CLUB_DOCUMENT_STATUSES],
    ["club_events", "kind", CLUB_EVENT_KINDS],
    ["club_events", "status", CLUB_EVENT_STATUSES],
    ["club_event_rsvps", "state", CLUB_RSVP_STATES],
    ["club_milestones", "state", CLUB_MILESTONE_STATES],
  ])("%s.%s", (table, column, dictionary) => {
    expect([...dictionary].sort()).toEqual(effectiveCheckValues(sql, table, column));
  });

  // Podział na wejście i wyjście jest kontraktem produktowym, nie tylko
  // porządkiem w pliku: powierzchnia "Dorobek" pyta o PRODUKTY, więc obie
  // listy muszą się sumować do słownika i nie zachodzić na siebie.
  it("materiały i produkty rozkładają słownik dokumentów bez części wspólnej", () => {
    expect([...CLUB_SOURCE_KINDS, ...CLUB_PRODUCT_KINDS].sort()).toEqual(
      [...CLUB_DOCUMENT_KINDS].sort(),
    );
    const sources = new Set<string>(CLUB_SOURCE_KINDS);
    expect(CLUB_PRODUCT_KINDS.filter((kind) => sources.has(kind))).toEqual([]);
  });

  it("rozpoznaje produkt po rodzaju", () => {
    for (const kind of CLUB_PRODUCT_KINDS) expect(isClubProductKind(kind)).toBe(true);
    for (const kind of CLUB_SOURCE_KINDS) expect(isClubProductKind(kind)).toBe(false);
  });
});

describe("zawężanie wartości z bazy", () => {
  it("rozpoznaje każdą wartość ze słownika", () => {
    for (const value of CLUB_DOCUMENT_KINDS) expect(toDocumentKind(value)).toBe(value);
    for (const value of CLUB_EVENT_KINDS) expect(toEventKind(value)).toBe(value);
    for (const value of CLUB_MILESTONE_STATES) expect(toMilestoneState(value)).toBe(value);
    for (const value of CLUB_RSVP_STATES) expect(toRsvpState(value)).toBe(value);
  });

  it("nieznana wartość degraduje do bezpiecznej gałęzi, nie wycieka do UI", () => {
    expect(toDocumentKind("quantum_dossier")).toBe("other");
    expect(toDocumentVisibility("telepathic")).toBe("club");
    expect(toDocumentStatus("shredded")).toBe("published");
    expect(toEventKind("seance")).toBe("other");
    expect(toEventStatus("postponed_forever")).toBe("scheduled");
    expect(toMilestoneState("quantum_flux")).toBe("planned");
    expect(toRsvpState("teleporting")).toBe("maybe");
  });

  // Brak deklaracji to INNA odpowiedź niż "odmawiam" - gdyby `null` degradował
  // do jakiegokolwiek stanu, przycisk obecności świeciłby się osobie, która
  // niczego nie kliknęła.
  it("brak deklaracji obecności zostaje brakiem, nie stanem", () => {
    expect(toRsvpState(null)).toBeNull();
  });
});

describe("przekroje jsonb", () => {
  it("czyta poprawne wpisy", () => {
    expect(parseKindBreakdown([{ key: "question", count: 3 }])).toEqual([
      { key: "question", count: 3 },
    ]);
    expect(
      parseGroupBreakdown([{ id: "g1", name_pl: "Obronność", name_en: "Defence", count: 2 }]),
    ).toEqual([{ id: "g1", name_pl: "Obronność", name_en: "Defence", count: 2 }]);
    expect(parseContributors([{ name: "Anna", slug: "anna", avatar_url: null, count: 5 }])).toEqual(
      [{ name: "Anna", slug: "anna", avatarUrl: null, count: 5 }],
    );
  });

  // Dane z bazy trafiają wprost do wykresu, więc jeden nieczytelny wiersz nie
  // może zabrać całego przekroju - ma zostać pominięty.
  it("pomija wpisy bez klucza zamiast wywracać cały przekrój", () => {
    expect(parseKindBreakdown([{ count: 3 }, { key: "poll", count: 1 }])).toEqual([
      { key: "poll", count: 1 },
    ]);
    expect(parseGroupBreakdown([{ name_pl: "Bez id" }])).toEqual([]);
    expect(parseContributors([{ slug: "x" }])).toEqual([]);
  });

  it("liczba nie-liczbowa degraduje do zera, a nie do NaN na osi", () => {
    expect(parseKindBreakdown([{ key: "poll", count: "dużo" }])).toEqual([
      { key: "poll", count: 0 },
    ]);
  });

  it("kształt inny niż tablica daje pustą listę", () => {
    expect(parseKindBreakdown(null)).toEqual([]);
    expect(parseGroupBreakdown({ key: "nope" })).toEqual([]);
    expect(parseContributors("[]")).toEqual([]);
  });
});

function doc(overrides: Partial<ClubDocumentRow>): ClubDocumentRow {
  return { file_url: null, external_url: null, ...overrides } as ClubDocumentRow;
}

describe("documentHref", () => {
  it("plik ma pierwszeństwo przed linkiem", () => {
    expect(documentHref(doc({ file_url: "/f.pdf", external_url: "https://e.org" }))).toBe("/f.pdf");
  });

  it("pusty napis nie jest adresem", () => {
    expect(documentHref(doc({ file_url: "   ", external_url: "https://e.org" }))).toBe(
      "https://e.org",
    );
    expect(documentHref(doc({ file_url: "", external_url: "" }))).toBeNull();
  });
});

function event(overrides: Partial<ClubEventRow>): ClubEventRow {
  return {
    status: "scheduled",
    starts_at: "2026-08-08T10:00:00Z",
    ends_at: null,
    capacity: null,
    going_count: 0,
    ...overrides,
  } as ClubEventRow;
}

describe("stan wydarzenia", () => {
  const now = Date.parse("2026-08-08T11:00:00Z");

  it("trwa, gdy zaczęło się i jeszcze nie skończyło", () => {
    expect(isEventLive(event({ ends_at: "2026-08-08T12:00:00Z" }), now)).toBe(true);
  });

  // Wpis bez końca to PUNKT w czasie (termin, publikacja), a nie wieczne
  // "teraz" - inaczej każdy przeszły termin świeciłby się jako trwający.
  it("wpis bez końca nie trwa w nieskończoność", () => {
    expect(isEventLive(event({ ends_at: null }), now)).toBe(false);
  });

  it("odwołane nie trwa, nawet w swoim oknie", () => {
    expect(isEventLive(event({ status: "cancelled", ends_at: "2026-08-08T12:00:00Z" }), now)).toBe(
      false,
    );
  });

  it("pełne dotyczy wyłącznie wydarzeń z limitem", () => {
    expect(isEventFull(event({ capacity: null, going_count: 999 }))).toBe(false);
    expect(isEventFull(event({ capacity: 2, going_count: 2 }))).toBe(true);
    expect(isEventFull(event({ capacity: 2, going_count: 1 }))).toBe(false);
  });
});

function milestone(overrides: Partial<ClubMilestoneRow>): ClubMilestoneRow {
  return { state: "planned", due_on: null, ...overrides } as ClubMilestoneRow;
}

describe("spóźnienie etapu", () => {
  const today = "2026-08-08";

  it("termin minął, a etap otwarty", () => {
    expect(isMilestoneOverdue(milestone({ due_on: "2026-08-01" }), today)).toBe(true);
  });

  it("etap bez terminu nie może być spóźniony", () => {
    expect(isMilestoneOverdue(milestone({ due_on: null }), today)).toBe(false);
  });

  it("termin dzisiejszy jeszcze nie minął", () => {
    expect(isMilestoneOverdue(milestone({ due_on: today }), today)).toBe(false);
  });

  // Odwołany etap nie ma czego dowozić, a zamknięty już dowiózł - żaden z nich
  // nie jest spóźnieniem, choćby termin minął rok temu.
  it("zamknięty i odwołany nie są spóźnione", () => {
    expect(isMilestoneOverdue(milestone({ due_on: "2020-01-01", state: "done" }), today)).toBe(
      false,
    );
    expect(isMilestoneOverdue(milestone({ due_on: "2020-01-01", state: "cancelled" }), today)).toBe(
      false,
    );
  });
});
