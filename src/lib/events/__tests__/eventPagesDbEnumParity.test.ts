// BRAMKA: stale klienta ekranu „Strony i menu" zgadzaja sie z baza.
//
// PO CO TEN PLIK ISTNIEJE. `eventPagesApi.ts` trzyma TRZY odwzorowania bazy
// przepisane recznie, kazde z komentarzem obiecujacym „jeden do jednego":
//
//   * `EVENT_PAGE_MODULES` - piatka znacznikow z `event_pages_module_values`;
//   * `EVENT_PAGE_ICON_PATTERN` - wzorzec z `event_pages_icon_check`;
//   * `EVENT_PAGE_COLOR_PATTERN` - wzorzec z `event_pages_color_check`.
//
// Zaden z nich NIE JEST widziany przez kompilator: kolumny sa typu `text`
// z ograniczeniem `CHECK`, a `CHECK` nie przechodzi do wygenerowanych typow -
// `module` jest w nich zwyklym `string`. Rozjazd konczy sie wiec nie bledem
// budowania, tylko ekranem, ktory OFERUJE akcje odrzucana przez baze (szosty
// modul czytany jako „zwykla pozycja" dostaje przycisk odpiecia) albo BLOKUJE
// wartosc, ktora baza przyjmuje (za waski wzorzec ikony). Komentarz nie jest
// bramka - ten plik nia jest; wzorzec przepisany z `dbEnumParity.test.ts`,
// ktory zlapal juz trzy takie rozjazdy w tym module.
//
// DRUGA POLOWA: SLOWNIK ZASIEWU. `_event_default_pages()` (migracja
// 20260826181500) jest ZRODLEM PRAWDY piatki - to on nadaje ikone, kolor
// i kolejnosc kazdej z pieciu stron. Klient nie ma jego kopii i MA JEJ NIE MIEC
// (patrz `eventPreviewMenu`: ikona i kolor jada z wiersza, nie z nazwy modulu),
// ale kazda wartosc tego slownika musi przejsc przez wzorce klienta - inaczej
// panel narysowalby zasiana pozycje jako bledna, a szuflada edycji odmowilaby
// zapisu wiersza, ktorego sama nie zepsula.
//
// CZEGO TEN PLIK NIE SPRAWDZA. Zachowania bazy przy zasiewie (idempotencja,
// odmowa odpiecia, `event_menu`) - to `runtime_test.d/90_module_pages.sql` na
// zywym Postgresie. Tutaj czytamy WYLACZNIE tekst migracji, bo to jedyna rzecz,
// ktora bramka vitest ma pod reka.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EVENT_PAGE_COLOR_PATTERN,
  EVENT_PAGE_ICON_PATTERN,
  EVENT_PAGE_MODULES,
  eventPageModule,
} from "@/lib/events/eventPagesApi";
import { EVENT_PAGE_TEMPLATES, findEventPageTemplate } from "@/lib/events/eventPageTemplates";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Tresc wszystkich migracji, posortowana po nazwie pliku.
 *
 * OSTATNIA DEFINICJA WYGRYWA - dokladnie tak, jak przy `supabase db push`.
 * Tabela `event_pages` jest w tym repozytorium tworzona dwa razy (plik opisowy
 * i migracja panelu z UUID-em w nazwie), a funkcja `_event_default_pages()`
 * takze dwa razy; obowiazuje ta pozniejsza.
 */
function migrationSql(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

const SQL = migrationSql();

/**
 * Wartosci z `CHECK (kol IS NULL OR kol IN (...))`.
 *
 * WLASNY CZYTNIK, a nie ten z `dbEnumParity.test.ts`: tamten dopasowuje
 * `CHECK (kol IN (...))` bez czlonu `IS NULL OR`, wiec ograniczenia kolumn
 * NULLOWALNYCH - a `event_pages.module` taka wlasnie jest - w ogole nie widzi.
 * Doklejenie ich do tamtego czytnika zmienialoby zachowanie bramki dzialajacej
 * dla dwudziestu innych stalych, wiec czytnik stoi tutaj.
 */
function nullableCheckValues(constraint: string): Set<string> {
  const re = new RegExp(
    `CONSTRAINT\\s+${constraint}\\s+CHECK\\s*\\(\\s*[a-z_]+\\s+IS\\s+NULL\\s+OR\\s+[a-z_]+\\s+IN\\s*\\(([^)]*)\\)`,
    "i",
  );
  let found: Set<string> | null = null;
  for (const sql of SQL) {
    const match = re.exec(sql);
    if (match === null) continue;
    const values = match[1]
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter((value) => value.length > 0);
    if (values.length > 0) found = new Set(values);
  }
  if (found === null) {
    throw new Error(
      `Nie znaleziono ograniczenia ${constraint} w supabase/migrations. ` +
        "Jesli zostalo przemianowane, popraw mapowanie w tej bramce.",
    );
  }
  return found;
}

/** Wzorzec z `CHECK (kol IS NULL OR kol ~ '...')` - napis, bez ograniczników. */
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

interface DefaultPageRow {
  module: string;
  icon: string;
  color: string;
  sortOrder: number;
}

/**
 * Piatka z ciala `_event_default_pages()` - znacznik, ikona, kolor, kolejnosc.
 *
 * Czytamy CIALO OSTATNIEJ definicji funkcji, bo `CREATE FUNCTION` powtorzone
 * w pozniejszej migracji nadpisuje wczesniejsze. Kazdy wiersz `VALUES` zaczyna
 * sie czteroma polami w stalej kolejnosci - reszta (tytuly, wstepy, szablon)
 * jest wielolinijkowa i tutaj nieczytana.
 */
function defaultPages(): DefaultPageRow[] {
  const bodyRe = /CREATE FUNCTION public\._event_default_pages\(\)([\s\S]*?)\$fn\$;/g;
  let body: string | null = null;
  for (const sql of SQL) {
    for (const match of sql.matchAll(bodyRe)) body = match[1];
  }
  if (body === null) {
    throw new Error(
      "Nie znaleziono definicji public._event_default_pages() w supabase/migrations.",
    );
  }
  const rowRe = /\(\s*'([a-z_]+)',\s*'([^']*)',\s*'([^']*)',\s*(\d+),/g;
  const rows: DefaultPageRow[] = [];
  for (const match of body.matchAll(rowRe)) {
    rows.push({
      module: match[1],
      icon: match[2],
      color: match[3],
      sortOrder: Number(match[4]),
    });
  }
  return rows;
}

/** Identyfikatory szablonow, do ktorych odsyla slownik zasiewu. */
function defaultPageTemplateIds(): string[] {
  const bodyRe = /CREATE FUNCTION public\._event_default_pages\(\)([\s\S]*?)\$fn\$;/g;
  let body = "";
  for (const sql of SQL) {
    for (const match of sql.matchAll(bodyRe)) body = match[1];
  }
  return [...body.matchAll(/'(event-page-[a-z-]+)'/g)].map((match) => match[1]);
}

const DEFAULT_PAGES = defaultPages();

describe("bramka nie jest prozna", () => {
  // Kazda asercja nizej czyta pliki z dysku, wiec zla sciezka albo przemianowany
  // plik daly by ZIELONA bramke bez ani jednego porownania. Ten przypadek jest
  // po to, zeby taka awaria bramki byla widoczna jako awaria.
  it("czyta migracje i znajduje w nich slownik zasiewu", () => {
    expect(SQL.length).toBeGreaterThan(30);
    expect(DEFAULT_PAGES).toHaveLength(5);
  });
});

describe("EVENT_PAGE_MODULES vs event_pages_module_values", () => {
  // ROWNOSC, NIE „co najmniej". Znacznik, ktorego klient nie zna, czyta sie
  // jako `null` (`eventPageModule`), czyli jako ZWYKLA pozycja - a zwykla
  // pozycja dostaje przycisk odpiecia, ktorego baza i tak nie wykona.
  it("zbior znacznikow jest DOKLADNIE ten, ktory baza przyjmuje", () => {
    expect([...EVENT_PAGE_MODULES].sort()).toEqual(
      [...nullableCheckValues("event_pages_module_values")].sort(),
    );
  });

  // KOLEJNOSC JEST CZESCIA KONTRAKTU, a `CHECK` jej nie niesie - niesie ja
  // `_event_default_pages()`. Pozycje w menu ida wedlug `sort_order` z zasiewu,
  // wiec stala klienta ma stac w tej samej kolejnosci, w ktorej redaktor widzi
  // piatke po wejsciu na ekran.
  it("kolejnosc stalej jest kolejnoscia zasiewu (sort_order rosnaco)", () => {
    const zBazy = [...DEFAULT_PAGES]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((row) => row.module);
    expect([...EVENT_PAGE_MODULES]).toEqual(zBazy);
  });

  // KAZDY znacznik zasiewu musi przejsc przez zwezenie na granicy sieci -
  // inaczej wiersz zasiany przez baze przyszedlby do panelu jako „zwykla
  // pozycja" i dostal akcje odpiecia, ktora zawsze konczy sie odmowa.
  it("kazdy znacznik zasiewu przechodzi przez eventPageModule", () => {
    for (const row of DEFAULT_PAGES) {
      expect(eventPageModule(row.module), `znacznik ${row.module}`).toBe(row.module);
    }
  });
});

describe("wzorce ikony i koloru vs CHECK-i event_pages", () => {
  it("EVENT_PAGE_ICON_PATTERN jest wzorcem event_pages_icon_check", () => {
    expect(EVENT_PAGE_ICON_PATTERN.source).toBe(nullableCheckPattern("event_pages_icon_check"));
  });

  it("EVENT_PAGE_COLOR_PATTERN jest wzorcem event_pages_color_check", () => {
    expect(EVENT_PAGE_COLOR_PATTERN.source).toBe(nullableCheckPattern("event_pages_color_check"));
  });

  // TO JEST TA ASERCJA, KTORA ODPOWIADA 90/(a) Z HARNESSU („kazda ikona i kolor
  // przechodza CHECK z event_pages") - tyle ze po stronie KLIENTA. Wzorzec
  // klienta zawezony o jeden znak zamienilby zasiana pozycje w wiersz, ktorego
  // szuflada edycji nie pozwoli zapisac, choc nikt go nie zepsul.
  it("kazda ikona i kazdy kolor zasiewu przechodza przez wzorce klienta", () => {
    for (const row of DEFAULT_PAGES) {
      expect(EVENT_PAGE_ICON_PATTERN.test(row.icon), `ikona ${row.icon}`).toBe(true);
      expect(EVENT_PAGE_COLOR_PATTERN.test(row.color), `kolor ${row.color}`).toBe(true);
    }
  });

  // Dwie identyczne ikony w jednym menu sa defektem wygladu, ktorego nie widac
  // w zadnym tescie jednostkowym - ta sama asercja co 90/piatka w harnessie,
  // przeniesiona na tekst migracji.
  it("piec roznych ikon i piec roznych kolorow", () => {
    expect(new Set(DEFAULT_PAGES.map((row) => row.icon)).size).toBe(5);
    expect(new Set(DEFAULT_PAGES.map((row) => row.color)).size).toBe(5);
  });

  // KONTRAPUNKT: wzorce nie przepuszczaja czegokolwiek. Bez tego przypadku
  // asercje wyzej przechodzilyby takze dla wzorca `/.*/`.
  it("wzorce ODRZUCAJA wartosci, ktorych baza nie przyjmie", () => {
    for (const zla of ["Calendar-Days", "calendar days", "", "a".repeat(49)]) {
      expect(EVENT_PAGE_ICON_PATTERN.test(zla), `ikona „${zla}”`).toBe(false);
    }
    for (const zly of ["#FFF", "FFFFFF", "#GGGGGG", "#FFFFFFF"]) {
      expect(EVENT_PAGE_COLOR_PATTERN.test(zly), `kolor „${zly}”`).toBe(false);
    }
  });
});

describe("szablony, do ktorych odsyla zasiew", () => {
  // Zasiew wpisuje `template_id` z tego samego zbioru, ktory redaktor widzi
  // w oknie zakladania strony. Identyfikator, ktorego klient nie zna, oddaje
  // `null` z `findEventPageTemplate`, czyli strone bez tresci - a to jest
  // dokladnie ten stan, ktoremu migracja 20260826181500 mial zapobiec.
  it("kazdy identyfikator szablonu z zasiewu istnieje w kliencie", () => {
    const ids = defaultPageTemplateIds();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(findEventPageTemplate(id), `szablon ${id}`).not.toBeNull();
    }
  });

  it("lista szablonow klienta nie ma dwoch pozycji o tym samym identyfikatorze", () => {
    const ids = EVENT_PAGE_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
