// BRAMKA: stale REGULAMINOW, GRUP i NADAN UPRAWNIEN zgadzaja sie z baza.
//
// PO CO TEN PLIK ISTNIEJE. `dbEnumParity.test.ts` pilnuje slownikow biletow,
// identyfikatorow i odprawy - i wylapal tam trzy realne rozjazdy. Warstwa
// AUTORYZACJI (kto kogo widzi, kto co zaakceptowal, komu nadano ulge) miala
// dokladnie te sama dziure w typach, a nie miala bramki:
//
//   * `GROUP_VISIBILITIES` to zasieg widocznosci uczestnikow. Wartosc spoza
//     CHECK-a nie konczy sie bledem kompilacji (kolumna jest `text`), tylko
//     odmowa bazy przy zapisie grupy - albo, gorzej, ustawieniem zasiegu
//     szerszego niz zamierzony, gdyby CHECK kiedys zluzowano.
//   * `TERM_DISPLAYS` rozstrzyga, GDZIE regulamin sie pokaze. Wartosc, ktorej
//     baza nie zna, to zgoda niepokazana nigdzie - czyli brak dowodu zgody.
//   * `AUDIENCE_GRANT_AUDIENCES` decyduje o CENIE. Grupa spoza CHECK-a to
//     odmowa przy nadaniu albo pusta lista wygladajaca jak „nikt nie ma ulgi".
//   * `AUDIENCE_GRANT_ACTIONS` i `AUDIENCE_GRANT_HISTORY_FIELDS` odwzorowuja
//     dziennik audytu, ktory wypelnia TRIGGER bazy. Nazwa akcji ustawiona po
//     stronie SQL-a i nieznana ekranowi degraduje do „zmieniono" - wycofanie
//     uprawnienia czytaloby sie w audycie jak zwykla korekta.
//   * `AUDIENCE_GRANT_STATES` to kolumna WYLICZANA w SQL-u (`CASE`), a nie
//     zapisana - jedynym zrodlem prawdy jest tresc funkcji.
//
// KAZDA PARA MA WSKAZANE ZRODLO W `supabase/migrations/`. Komentarz nad stala
// obiecujacy „jeden do jednego" nie jest bramka; ten plik nia jest.
//
// DLACZEGO OSOBNY PLIK, A NIE DOPISEK DO `dbEnumParity`. Tamten plik czyta
// wylacznie ograniczenia `CHECK ... IN (...)`. Tutaj trzy z szesciu par maja
// inne zrodlo: literaly akcji w ciele triggera, tablice pol w petli `FOREACH`
// i galezie `CASE` w funkcji listujacej. To sa inne parsery i inne powody
// awarii, wiec stoja obok, a nie w srodku tamtej bramki.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  GROUP_VISIBILITIES,
  TERMS_GROUPS_KEY_PATTERN,
  TERM_DISPLAYS,
} from "@/lib/events/termsGroupsApi";
import {
  TERMS_MAX_BODY,
  TERMS_MAX_DESCRIPTION,
  TERMS_MAX_NAME,
} from "@/lib/events/termsGroupsDraft";
import {
  AUDIENCE_GRANT_ACTIONS,
  AUDIENCE_GRANT_AUDIENCES,
  AUDIENCE_GRANT_HISTORY_FIELDS,
  AUDIENCE_GRANT_STATES,
} from "@/lib/events/audienceGrantsApi";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Wszystkie migracje w kolejnosci stosowania - ostatnia definicja wygrywa. */
function migrations(): Array<{ file: string; sql: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8") }));
}

const MIGRATIONS = migrations();

/* ------------------------------------------------- CHECK (kolumna IN (...)) --- */

/** Wartosci dopuszczone przez nazwane ograniczenie `CHECK (kol IN (...))`. */
function checkValues(constraint: string): Set<string> {
  const re = new RegExp(
    `CONSTRAINT\\s+${constraint}\\s+CHECK\\s*\\(\\s*[a-z_]+\\s+IN\\s*\\(([^)]*)\\)\\s*\\)`,
    "i",
  );
  let found: Set<string> | null = null;
  for (const { sql } of MIGRATIONS) {
    const match = re.exec(sql);
    if (match === null) continue;
    found = new Set(
      match[1]
        .split(",")
        .map((value) => value.trim().replace(/^'|'$/g, ""))
        .filter((value) => value.length > 0),
    );
  }
  if (found === null) {
    throw new Error(
      `Nie znaleziono ograniczenia ${constraint} w supabase/migrations. ` +
        "Jesli zostalo przemianowane, popraw mapowanie w tej bramce.",
    );
  }
  return found;
}

/* --------------------------------------------- CHECK (char_length(...) <= N) --- */

/** Gorny limit dlugosci z ograniczenia `char_length(...) <= N` albo `BETWEEN`. */
function checkMaxLength(constraint: string): number {
  const between = new RegExp(
    `CONSTRAINT\\s+${constraint}\\s+CHECK\\s*\\(\\s*char_length\\(btrim\\([a-z_]+\\)\\)\\s+BETWEEN\\s+\\d+\\s+AND\\s+(\\d+)\\s*\\)`,
    "i",
  );
  const atMost = new RegExp(
    `CONSTRAINT\\s+${constraint}\\s+CHECK\\s*\\(\\s*char_length\\([a-z_]+\\)\\s*<=\\s*(\\d+)\\s*\\)`,
    "i",
  );
  let found: number | null = null;
  for (const { sql } of MIGRATIONS) {
    const match = between.exec(sql) ?? atMost.exec(sql);
    if (match !== null) found = Number(match[1]);
  }
  if (found === null) {
    throw new Error(`Nie znaleziono ograniczenia dlugosci ${constraint} w supabase/migrations.`);
  }
  return found;
}

/** Wzorzec z ograniczenia `CHECK (kol ~ '...')` - zapisany dokladnie jak w SQL-u. */
function checkPattern(constraint: string): string {
  const re = new RegExp(
    `CONSTRAINT\\s+${constraint}\\s+CHECK\\s*\\([a-z_]+\\s*~\\s*'([^']*)'\\)`,
    "i",
  );
  let found: string | null = null;
  for (const { sql } of MIGRATIONS) {
    const match = re.exec(sql);
    if (match !== null) found = match[1];
  }
  if (found === null) {
    throw new Error(`Nie znaleziono wzorca ${constraint} w supabase/migrations.`);
  }
  return found;
}

/* ------------------------------------------------------- cialo funkcji SQL --- */

/**
 * Cialo funkcji `name` z NAJPOZNIEJSZEJ migracji, ktora ja definiuje.
 *
 * Bez tego zawezenia regexy lapalyby literaly z sasiednich funkcji w tym samym
 * pliku - a modul wydarzen ma po kilkanascie funkcji na migracje.
 */
function functionBody(name: string): string {
  let found: string | null = null;
  for (const { sql } of MIGRATIONS) {
    const start = sql.indexOf(`FUNCTION public.${name}(`);
    if (start === -1) continue;
    const end = sql.indexOf("\n$$;", start);
    found = end === -1 ? sql.slice(start) : sql.slice(start, end);
  }
  if (found === null) {
    throw new Error(`Nie znaleziono funkcji ${name} w supabase/migrations.`);
  }
  return found;
}

describe("bramka nie jest prozna - migracje sa czytane", () => {
  it("katalog migracji ma tresc", () => {
    expect(MIGRATIONS.length).toBeGreaterThan(50);
  });

  it("kazde odwzorowane ograniczenie istnieje w migracjach", () => {
    expect(checkValues("event_groups_visibility_values").size).toBe(4);
    expect(checkValues("event_terms_display_values").size).toBe(3);
    expect(checkValues("event_audience_grants_audience_values").size).toBe(3);
  });
});

describe("stale klienta === CHECK-i bazy", () => {
  // ZASIEG WIDOCZNOSCI TO UPRAWNIENIE, NIE OZDOBA. Droplista, ktora oferuje
  // wartosc nieznana bazie, konczy sie odmowa przy zapisie grupy; droplista,
  // ktora GUBI wartosc, odbiera organizatorowi mozliwosc zawezenia listy
  // uczestnikow (np. „tylko wlasna grupa") bez zadnego komunikatu.
  it("GROUP_VISIBILITIES === event_groups_visibility_values", () => {
    expect([...GROUP_VISIBILITIES].sort()).toEqual(
      [...checkValues("event_groups_visibility_values")].sort(),
    );
  });

  // MIEJSCE WYSWIETLENIA REGULAMINU. `registration` pyta przy zapisie,
  // `access` przy wejsciu, `registration_and_access` w obu miejscach. Zgubiony
  // wariant to regulamin, ktorego uczestnik nigdy nie zobaczy - czyli brak
  // dowodu akceptacji tam, gdzie mial byc.
  it("TERM_DISPLAYS === event_terms_display_values", () => {
    expect([...TERM_DISPLAYS].sort()).toEqual(
      [...checkValues("event_terms_display_values")].sort(),
    );
  });

  it("AUDIENCE_GRANT_AUDIENCES === event_audience_grants_audience_values", () => {
    expect([...AUDIENCE_GRANT_AUDIENCES].sort()).toEqual(
      [...checkValues("event_audience_grants_audience_values")].sort(),
    );
  });

  // KLUCZ GRUPY I KLUCZ ZGODY MAJA TEN SAM FORMAT W BAZIE, a klient sprawdza
  // go JEDNYM wyrazeniem. Rozjazd znaczylby, ze formularz przepuszcza klucz,
  // ktory baza odrzuci `invalid_key` - albo blokuje klucz, ktory jest legalny.
  it("TERMS_GROUPS_KEY_PATTERN === event_groups_key_format === event_terms_key_format", () => {
    const groups = checkPattern("event_groups_key_format");
    const terms = checkPattern("event_terms_key_format");
    expect(groups).toBe(terms);
    expect(TERMS_GROUPS_KEY_PATTERN.source).toBe(groups);
  });
});

describe("stale wyliczane w SQL-u (nie ma dla nich CHECK-a)", () => {
  // STAN NADANIA JEST LICZONY W ZAPYTANIU, wiec zbior nazw zyje wylacznie
  // w tresci funkcji. `audienceGrantState` degraduje nieznana nazwe do
  // „aktywne" - stan, ktorego lista nie zna, wygladalby wiec jak dzialajaca
  // ulga. To najgorszy mozliwy kierunek degradacji, stad ta bramka.
  it("AUDIENCE_GRANT_STATES === galezie CASE w admin_event_audience_grants_list", () => {
    const body = functionBody("admin_event_audience_grants_list");
    const states = new Set<string>();
    for (const match of body.matchAll(/(?:THEN|ELSE)\s+'([a-z_]+)'/g)) states.add(match[1]);
    expect([...AUDIENCE_GRANT_STATES].sort()).toEqual([...states].sort());
  });

  // AKCJE STAWIA TRIGGER, a ekran historii mapuje ogon po kropce. Akcja
  // nieznana ekranowi degraduje do „zmieniono": WYCOFANIE uprawnienia
  // czytaloby sie w audycie rozliczen jak zwykla korekta pola.
  it("AUDIENCE_GRANT_ACTIONS === literaly akcji triggera audytu", () => {
    const body = functionBody("_tg_event_audience_grant_audit");
    const actions = new Set<string>();
    for (const match of body.matchAll(/'event_audience_grant\.([a-z_]+)'/g)) actions.add(match[1]);
    expect([...AUDIENCE_GRANT_ACTIONS].sort()).toEqual([...actions].sort());
  });

  // POLA DIFFU. Trigger porownuje DOKLADNIE te kolumny i tylko one moga
  // wejsc do `changed`. Pole nazwane po ludzku, ktorego trigger nie sledzi,
  // to martwy klucz slownika; pole sledzone, a nienazwane, pokazuje sie
  // audytorowi jako surowa nazwa kolumny.
  it("AUDIENCE_GRANT_HISTORY_FIELDS === tablica FOREACH w triggerze audytu", () => {
    const body = functionBody("_tg_event_audience_grant_audit");
    const match = /FOREACH\s+v_field\s+IN\s+ARRAY\s+ARRAY\[([^\]]*)\]/i.exec(body);
    expect(match, "trigger audytu nie ma petli po polach diffu").not.toBeNull();
    const fields = (match?.[1] ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter((value) => value.length > 0);
    expect([...AUDIENCE_GRANT_HISTORY_FIELDS].sort()).toEqual([...fields].sort());
  });
});

describe("limity dlugosci formularza vs CHECK-i bazy", () => {
  // TRESC ZGODY. Formularz celowo pokazuje mniej niz baza przyjmie - to jest
  // zawezenie DECYZJA, nie przeoczenie, wiec stoi tu z powodem: 40 000 znakow
  // w polu tekstowym panelu nikt nie przeczyta, a regulamin tej dlugosci
  // wchodzi odnosnikiem (`external_url`).
  it("TERMS_MAX_BODY miesci sie w limicie bazy", () => {
    expect(TERMS_MAX_BODY).toBeLessThanOrEqual(checkMaxLength("event_terms_body_pl_len"));
    expect(TERMS_MAX_BODY).toBeLessThanOrEqual(checkMaxLength("event_terms_body_en_len"));
  });

  it("TERMS_MAX_NAME miesci sie w limicie etykiety zgody", () => {
    expect(TERMS_MAX_NAME).toBeLessThanOrEqual(checkMaxLength("event_terms_label_pl_len"));
  });

  // DEFEKT. `TERMS_MAX_NAME` obsluguje DWA pola o roznych limitach w bazie:
  // etykiete zgody (300) i nazwe grupy (80). Pole nazwy grupy wpuszcza wiec
  // 160 znakow, a baza odrzuca wszystko powyzej 80 naruszeniem
  // `event_groups_name_pl_len`. Komunikat takiej odmowy NIE MA glowy w formacie
  // `klucz: tresc`, wiec `adminTermsFailure` degraduje go do
  // `adminEventTerms.errors.unknown` - organizator dostaje „Nie udalo sie
  // wykonac operacji" i nie ma jak zgadnac, ze chodzi o dlugosc nazwy.
  // Poprawka nalezy do produkcji: osobna stala dla nazwy grupy.
  it.fails("limit pola nazwy GRUPY nie moze przekraczac limitu bazy (160 > 80)", () => {
    expect(TERMS_MAX_NAME).toBeLessThanOrEqual(checkMaxLength("event_groups_name_pl_len"));
  });

  // DEFEKT, ta sama klasa: opis grupy w formularzu ma 600 znakow, a
  // `event_groups_desc_pl_len` przyjmuje 500.
  it.fails("limit pola opisu GRUPY nie moze przekraczac limitu bazy (600 > 500)", () => {
    expect(TERMS_MAX_DESCRIPTION).toBeLessThanOrEqual(checkMaxLength("event_groups_desc_pl_len"));
  });
});

describe("regresje, ktore ta bramka mialaby zlapac", () => {
  it("`own_group` jest zasiegiem, ktory baza zna - i klient tez", () => {
    expect(checkValues("event_groups_visibility_values")).toContain("own_group");
    expect(GROUP_VISIBILITIES as readonly string[]).toContain("own_group");
  });

  // ZGODA POKAZYWANA W DWOCH MIEJSCACH JEST OSOBNA WARTOSCIA, a nie suma
  // dwoch pozostalych: baza trzyma jedna kolumne `display`, nie dwie flagi.
  it("`registration_and_access` jest wartoscia, a nie zlozeniem dwoch", () => {
    expect(checkValues("event_terms_display_values")).toContain("registration_and_access");
    expect(TERM_DISPLAYS as readonly string[]).toContain("registration_and_access");
  });

  it("`student` i `public` nie sa grupami nadania ulgi", () => {
    const allowed = checkValues("event_audience_grants_audience_values");
    for (const bogus of ["student", "public", "member"]) {
      expect(allowed).not.toContain(bogus);
      expect(AUDIENCE_GRANT_AUDIENCES as readonly string[]).not.toContain(bogus);
    }
  });

  // `deleted` NIE JEST AKCJA AUDYTU, bo nadanie sie nie kasuje - wycofanie
  // stempluje `revoked_at`. Akcja kasowania w slowniku klienta sugerowalaby,
  // ze slad audytowy da sie usunac.
  it("`deleted` nie jest akcja dziennika nadan", () => {
    expect(AUDIENCE_GRANT_ACTIONS as readonly string[]).not.toContain("deleted");
    expect(functionBody("_tg_event_audience_grant_audit")).not.toContain(
      "'event_audience_grant.deleted'",
    );
  });
});
