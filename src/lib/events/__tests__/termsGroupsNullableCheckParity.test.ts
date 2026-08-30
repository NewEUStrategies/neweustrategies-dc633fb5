// BRAMKA: ograniczenia `CHECK` KOLUMN NULLOWALNYCH modulu grup, zgod i nadan.
//
// PO CO OSOBNY PLIK OBOK `termsGroupsDbEnumParity`. Tamta bramka - i `dbEnumParity`,
// z ktorej wzieto jej czytnik - dopasowuje WYLACZNIE ksztalt
//
//     CHECK (kolumna IN ('a', 'b'))
//
// Kolumna NULLOWALNA jest w migracjach zapisana inaczej:
//
//     CHECK (kolumna IS NULL OR kolumna ~ '...')
//     CHECK (char_length(btrim(kolumna)) BETWEEN 3 AND 500)
//
// i ZADEN z tych ksztaltow nie przechodzi przez tamten czytnik. Skutek jest
// gorszy niz brak testu: bramka istnieje, swieci na zielono i wyglada, jakby
// pilnowala calej tabeli - a ograniczenia, ktorych nie umie przeczytac, nigdy
// nie byly sprawdzone. Ten sam mechanizm wykryto przy stronach modulowych
// (`eventPagesDbEnumParity.test.ts`) i tam tez skonczyl sie wlasnym czytnikiem.
//
// CO STOI PO STRONIE KLIENTA. `HEX_COLOR_PATTERN` w `termsGroupsDraft.ts` NIE
// JEST eksportowany, wiec porownujemy ZACHOWANIE: kazda wartosc koloru
// przepuszczamy przez `validateGroupDraft` i przez wzorzec ODCZYTANY z migracji.
// Rozjazd w ktorakolwiek strone jest usterka:
//   * klient szerszy niz baza -> formularz przyjmuje kolor, ktorego zapis
//     odbija sie od `event_groups_color_hex` i wraca jako goly kod ograniczenia;
//   * klient wezszy niz baza -> formularz BLOKUJE wartosc, ktorej sam nie
//     zepsul, a organizator nie ma jak wpisac koloru grupy.
//
// DRUGA POLOWA: DOWOD NADANIA UPRAWNIENIA. `event_audience_grants.evidence` ma
// dolna granice TRZECH znakow w dwoch niezaleznych miejscach - w `CHECK`
// tabeli i w osobnym `IF` funkcji zapisujacej, ktora podnosi `invalid_evidence`.
// Te dwie liczby MUSZA byc te sama liczba: gdyby `IF` zluzowal, uzytkownik
// dostalby zamiast zdania surowa odmowe ograniczenia; gdyby zaostrzyl, funkcja
// odrzucalaby dowody, ktore tabela przyjmuje. Dowod jest sladem audytowym
// rozliczen (ktos zaplacil mniej i wiersz tlumaczy, dlaczego), wiec jego dolna
// granica jest czescia kontraktu, nie kosmetyka.
//
// CZEGO TEN PLIK NIE ROBI. Nie chodzi do bazy i nie powtarza list wartosci
// `IN (...)` - te ma `termsGroupsDbEnumParity.test.ts`. Czyta wylacznie tekst
// migracji, bo to jedyne zrodlo, ktore bramka vitest ma pod reka.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { emptyGroupDraft, validateGroupDraft } from "@/lib/events/termsGroupsDraft";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Tresc wszystkich migracji w kolejnosci stosowania - ostatnia definicja wygrywa. */
function migrationSql(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

const SQL = migrationSql();

/* ------------------------------------------------------------ czytniki --- */

/** Wzorzec z `CONSTRAINT <nazwa> CHECK (kol IS NULL OR kol ~ '...')`. */
function nullableCheckPattern(constraint: string): string {
  const re = new RegExp(
    `CONSTRAINT\\s+${constraint}\\s+CHECK\\s*\\(\\s*[a-z_]+\\s+IS\\s+NULL\\s+OR\\s+[a-z_]+\\s*~\\s*'([^']*)'`,
    "i",
  );
  let found: string | null = null;
  for (const sql of SQL) {
    const match = re.exec(sql);
    if (match !== null) found = match[1];
  }
  if (found === null) {
    throw new Error(
      `Nie znaleziono wzorca ograniczenia ${constraint} w supabase/migrations. ` +
        "Jesli zostalo przemianowane, popraw mapowanie w tej bramce.",
    );
  }
  return found;
}

/** Granice z `CONSTRAINT <nazwa> CHECK (char_length(btrim(kol)) BETWEEN a AND b)`. */
function lengthBounds(constraint: string): { min: number; max: number } {
  const re = new RegExp(
    `CONSTRAINT\\s+${constraint}\\s+CHECK\\s*\\(\\s*char_length\\s*\\(\\s*btrim\\s*\\(\\s*[a-z_]+\\s*\\)\\s*\\)\\s+BETWEEN\\s+(\\d+)\\s+AND\\s+(\\d+)\\s*\\)`,
    "i",
  );
  let found: { min: number; max: number } | null = null;
  for (const sql of SQL) {
    const match = re.exec(sql);
    if (match !== null) found = { min: Number(match[1]), max: Number(match[2]) };
  }
  if (found === null) {
    throw new Error(
      `Nie znaleziono granic dlugosci ${constraint} w supabase/migrations. ` +
        "Jesli zostalo przemianowane, popraw mapowanie w tej bramce.",
    );
  }
  return found;
}

/** Czytnik z `dbEnumParity` - odtworzony TYLKO po to, zeby pokazac, czego NIE widzi. */
function inCheckValues(constraint: string): Set<string> | null {
  const re = new RegExp(
    `CONSTRAINT\\s+${constraint}\\s+CHECK\\s*\\(\\s*[a-z_]+\\s+IN\\s*\\(([^)]*)\\)\\s*\\)`,
    "i",
  );
  for (const sql of SQL) {
    const match = re.exec(sql);
    if (match === null) continue;
    return new Set(
      match[1]
        .split(",")
        .map((value) => value.trim().replace(/^'|'$/g, ""))
        .filter((value) => value.length > 0),
    );
  }
  return null;
}

/** Prog z `IF char_length(v_<pole>) < N THEN RAISE EXCEPTION '<kod>: ...'`. */
function guardThreshold(variable: string, code: string): number {
  const re = new RegExp(
    `char_length\\s*\\(\\s*${variable}\\s*\\)\\s*<\\s*(\\d+)[\\s\\S]{0,120}?RAISE\\s+EXCEPTION\\s+'${code}`,
    "i",
  );
  let found: number | null = null;
  for (const sql of SQL) {
    const match = re.exec(sql);
    if (match !== null) found = Number(match[1]);
  }
  if (found === null) {
    throw new Error(
      `Nie znaleziono progu '${code}' dla ${variable} w supabase/migrations. ` +
        "Jesli straznik zostal przepisany, popraw mapowanie w tej bramce.",
    );
  }
  return found;
}

/* -------------------------------------------------- bramka nie jest prozna --- */

describe("bramka nie jest prozna", () => {
  it("katalog migracji ma tresc", () => {
    expect(SQL.length).toBeGreaterThan(50);
    expect(SQL.join("").length).toBeGreaterThan(100_000);
  });

  // GDYBY KTORAS MIGRACJA PRZEMIANOWALA OGRANICZENIE, czytnik ma PADAC, a nie
  // oddawac pustke - pusty zbior przeszedlby kazde porownanie ponizej.
  it("czytnik nieznanego ograniczenia pada zamiast oddawac pustke", () => {
    expect(() => nullableCheckPattern("takiego_ograniczenia_nie_ma")).toThrow(/Nie znaleziono/);
    expect(() => lengthBounds("takiego_ograniczenia_nie_ma")).toThrow(/Nie znaleziono/);
    expect(() => guardThreshold("v_nie_ma", "invalid_nic")).toThrow(/Nie znaleziono/);
  });

  // TO JEST POWOD ISTNIENIA TEGO PLIKU, zapisany jako asercja. Czytnik z
  // `dbEnumParity` (i z `termsGroupsDbEnumParity`) oddaje `null` dla obu
  // ograniczen ponizej - one NIGDY nie byly przez tamte bramki sprawdzane.
  it("czytnik `CHECK (kol IN (...))` NIE WIDZI kolumn nullowalnych ani granic dlugosci", () => {
    expect(inCheckValues("event_groups_color_hex")).toBeNull();
    expect(inCheckValues("event_audience_grants_evidence_len")).toBeNull();
    // Kontrola dodatnia: na ksztalcie, ktory tamten czytnik obsluguje, dziala.
    expect(inCheckValues("event_audience_grants_audience_values")).not.toBeNull();
  });
});

/* ------------------------------------------- kolor grupy: klient === baza --- */

describe("kolor grupy - klient przyjmuje DOKLADNIE to, co baza", () => {
  const wzorzecBazy = new RegExp(nullableCheckPattern("event_groups_color_hex"));

  /** Czy `validateGroupDraft` zglasza blad WLASNIE na kolorze. */
  function klientOdrzuca(color: string): boolean {
    const draft = { ...emptyGroupDraft(10), key: "vip", namePl: "VIP", nameEn: "VIP", color };
    return validateGroupDraft(draft).some((error) => error.field === "color");
  }

  const PRZYPADKI: ReadonlyArray<readonly [string, boolean]> = [
    ["#FA9346", true],
    ["#fa9346", true],
    ["#ABCDEF", true],
    ["#000000", true],
    ["#FA934", false],
    ["#FA93466", false],
    ["FA9346", false],
    ["#GGGGGG", false],
    ["#fa9346 ", true],
    ["rgb(250,147,70)", false],
  ];

  it.each(PRZYPADKI)("`%s` - klient i baza sa zgodni", (color, dopuszczalny) => {
    expect(wzorzecBazy.test(color.trim())).toBe(dopuszczalny);
    expect(klientOdrzuca(color)).toBe(!dopuszczalny);
  });

  // PARA „wolno / nie wolno" na samej pustce: kolumna jest NULLOWALNA, wiec
  // grupa bez koloru jest legalna po obu stronach. Bez tej polowy bramka
  // dowodzilaby tylko, ze klient cos odrzuca.
  it("pusty kolor jest legalny - kolumna dopuszcza NULL, formularz tez", () => {
    expect(klientOdrzuca("")).toBe(false);
    expect(klientOdrzuca("   ")).toBe(false);
  });

  it("wzorzec bazy jest zakotwiczony z obu stron - `#FA9346x` nie przechodzi", () => {
    expect(wzorzecBazy.source.startsWith("^")).toBe(true);
    expect(wzorzecBazy.source.endsWith("$")).toBe(true);
    expect(wzorzecBazy.test("x#FA9346")).toBe(false);
    expect(wzorzecBazy.test("#FA9346x")).toBe(false);
  });
});

/* --------------------------------- dowod nadania: CHECK === straznik RPC --- */

describe("dowod nadania uprawnienia - dolna granica trzech znakow", () => {
  const granice = lengthBounds("event_audience_grants_evidence_len");

  it("`CHECK` tabeli wymaga co najmniej trzech znakow", () => {
    expect(granice.min).toBe(3);
    expect(granice.max).toBeGreaterThanOrEqual(granice.min);
  });

  // DWA NIEZALEZNE MIEJSCA, JEDNA LICZBA. Straznik w ciele funkcji istnieje po
  // to, zeby uzytkownik dostal `invalid_evidence` (nazwane zdanie) zamiast
  // surowego naruszenia ograniczenia. Rozjazd progow zabiera mu to zdanie.
  it("straznik `invalid_evidence` w funkcji zapisu ma TEN SAM prog co `CHECK`", () => {
    expect(guardThreshold("v_evidence", "invalid_evidence")).toBe(granice.min);
  });

  it("gorna granica dowodu miesci sie w rozsadnym polu tekstowym", () => {
    expect(granice.max).toBe(500);
  });
});

/* ------------------------------------------ okno waznosci i jeden podmiot --- */

describe("pozostale ograniczenia nullowalne nadan sa nadal w migracjach", () => {
  /** Czy istnieje ograniczenie o tej nazwie w JAKIEJKOLWIEK postaci. */
  function maOgraniczenie(constraint: string): boolean {
    return SQL.some((sql) => new RegExp(`CONSTRAINT\\s+${constraint}\\s+CHECK`, "i").test(sql));
  }

  // NADANIE WSKAZUJE DOKLADNIE JEDEN PODMIOT. Ograniczenie jest zapisane jako
  // XOR (`(user_id IS NOT NULL) <> (person_id IS NOT NULL)`), wiec zaden czytnik
  // wartosci go nie widzi - a to ono rozstrzyga, KOMU ulga zostala nadana.
  it("`event_audience_grants_subject_one` (XOR podmiotu) istnieje", () => {
    expect(maOgraniczenie("event_audience_grants_subject_one")).toBe(true);
    expect(
      SQL.some((sql) =>
        /event_audience_grants_subject_one\s+CHECK\s*\(\s*\(user_id IS NOT NULL\)\s*<>\s*\(person_id IS NOT NULL\)\s*\)/i.test(
          sql,
        ),
      ),
    ).toBe(true);
  });

  // OKNO WAZNOSCI JEST NULLOWALNE Z JEDNEJ STRONY: `valid_until` puste znaczy
  // „bezterminowo". Ograniczenie musi wiec przepuszczac NULL i pilnowac
  // kolejnosci dopiero wtedy, gdy termin jest podany.
  it("`event_audience_grants_window` dopuszcza brak terminu, ale pilnuje kolejnosci", () => {
    expect(
      SQL.some((sql) =>
        /event_audience_grants_window\s+CHECK\s*\(\s*valid_until IS NULL OR valid_until > valid_from\s*\)/i.test(
          sql,
        ),
      ),
    ).toBe(true);
  });
});
