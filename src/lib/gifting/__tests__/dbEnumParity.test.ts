// BRAMKA: stale klienta modulu PREZENTOW zgadzaja sie z ograniczeniami bazy.
//
// PO CO TEN PLIK ISTNIEJE. Kolumny wyliczeniowe tego modulu sa typu `text`
// z `CHECK (kolumna IN (...))`, a limity liczbowe - `integer` z
// `CHECK (kolumna BETWEEN a AND b)`. Typ generowany z bazy to wiec odpowiednio
// `string` i `number`: KOMPILATOR NIE ZOBACZY, ze panel oferuje wartosc albo
// zakres, ktorego baza nie przyjmie. Wzorzec przeniesiony z
// `src/lib/events/__tests__/dbEnumParity.test.ts`, gdzie wylapal trzy realne
// rozjazdy naraz.
//
// CO KONKRETNIE PILNUJEMY W TYM MODULE.
//   1. `GiftEventType` (przez klucze `EVENT_PILL_CLS` - jedyne runtime'owe
//      lustro tej unii) vs `CHECK (event_type IN ...)` na `gift_events`.
//      Rozjazd w te strone to pigulka bez klasy w audycie; w druga - filtr
//      audytu oferujacy typ, ktorego baza nigdy nie zapisze.
//   2. `GiftEligibility` vs `CHECK (eligibility IN ...)` na
//      `gift_article_settings`. To jest BRAMKA UPRAWNIENIA: opcja radia,
//      ktorej baza nie przyjmie, konczy sie odmowa zapisu calego formularza.
//   3. `GIFT_ADMIN_BOUNDS` vs `CHECK (... BETWEEN ...)`. Te liczby jada
//      jednoczesnie do `min`/`max` inputa, do schematu zod server fn i do
//      `validateGiftAdminDraft`. Za szeroki zakres w kliencie = odmowa bazy
//      pokazana adminowi jako surowy komunikat SQLSTATE; za waski = panel
//      odmawia ustawienia wartosci, ktora jest legalna.
//   4. Domyslne (`DEFAULT_GIFT_ADMIN_SETTINGS` / `DEFAULT_GIFT_SETTINGS`) vs
//      `SET DEFAULT` kolumn. Przy BRAKU wiersza ustawien panel pokazuje wlasnie
//      te liczby jako "efektywne domyslne" - jesli sklamie, admin planuje
//      budzet klikniec, ktorego serwer nie egzekwuje.
//
// ZNANE OGRANICZENIE WZORCA (przeniesione swiadomie): skaner czyta wylacznie
// ograniczenia zapisane wprost jako `CHECK (kol IN (...))` / `BETWEEN`.
// NIE widzi kolumn nullowalnych zapisanych jako `kol IS NULL OR kol IN (...)`
// ani warunkow rozbitych na `CHECK` tablicowy. W tym module takich nie ma
// (kanarki nizej tego pilnuja), ale przy nowej migracji trzeba to sprawdzic
// recznie - inaczej bramka bedzie zielona przez sam brak dopasowania.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { EVENT_PILL_CLS } from "@/components/admin/gifting/model";
import {
  DEFAULT_GIFT_ADMIN_SETTINGS,
  GIFT_ADMIN_BOUNDS,
  GIFT_ADMIN_LIMIT_FIELDS,
  GIFT_ELIGIBILITY_OPTIONS,
} from "@/lib/gifting/admin-model";
import { DEFAULT_GIFT_SETTINGS } from "@/lib/gifting/model";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function migrationSql(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
}

const SQL = migrationSql();

/**
 * Wartosci dopuszczone przez OSTATNIE w lancuchu migracji `CHECK (kol IN (...))`
 * dla podanej kolumny. Ostatnia definicja wygrywa - dokladnie tak, jak przy
 * `supabase db push`: `gift_events.event_type` jest w tym repo ograniczany
 * trzykrotnie (tabela + dwie migracje dokladajace `exhausted`).
 */
function inCheck(column: string): Set<string> {
  const re = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)\\s*\\)`, "gi");
  let last: string[] | null = null;
  for (const sql of SQL) {
    for (const m of sql.matchAll(re)) {
      const values = m[1]
        .split(",")
        .map((v) => v.trim().replace(/^'|'$/g, ""))
        .filter((v) => v.length > 0);
      if (values.length > 0) last = values;
    }
  }
  if (last === null) {
    throw new Error(
      `Nie znaleziono CHECK (${column} IN (...)) w supabase/migrations. ` +
        `Jesli ograniczenie zmienilo ksztalt (np. na "kol IS NULL OR kol IN"), ` +
        `bramka przestala je widziec - popraw skaner, nie usuwaj asercji.`,
    );
  }
  return new Set(last);
}

/** Zakres z OSTATNIEGO `CHECK (kol BETWEEN a AND b)` dla kolumny. */
function betweenCheck(column: string): { min: number; max: number } {
  const re = new RegExp(
    `CHECK\\s*\\(\\s*${column}\\s+BETWEEN\\s+(-?\\d+)\\s+AND\\s+(-?\\d+)`,
    "gi",
  );
  let last: { min: number; max: number } | null = null;
  for (const sql of SQL) {
    for (const m of sql.matchAll(re)) last = { min: Number(m[1]), max: Number(m[2]) };
  }
  if (last === null) {
    throw new Error(`Nie znaleziono CHECK (${column} BETWEEN ...) w supabase/migrations.`);
  }
  return last;
}

/** Ostatnie `SET DEFAULT`/`DEFAULT` dla kolumny ustawien - liczba. */
function columnDefault(column: string): number {
  const alter = new RegExp(`ALTER\\s+COLUMN\\s+${column}\\s+SET\\s+DEFAULT\\s+(-?\\d+)`, "gi");
  const inline = new RegExp(`\\b${column}\\s+integer\\s+NOT\\s+NULL\\s+DEFAULT\\s+(-?\\d+)`, "gi");
  let last: number | null = null;
  for (const sql of SQL) {
    for (const m of sql.matchAll(inline)) last = Number(m[1]);
    for (const m of sql.matchAll(alter)) last = Number(m[1]);
  }
  if (last === null) throw new Error(`Nie znaleziono DEFAULT dla kolumny ${column}.`);
  return last;
}

describe("bramka: skaner migracji nie jest prozny", () => {
  it("czyta pliki migracji", () => {
    expect(SQL.length).toBeGreaterThan(10);
  });

  it("znajduje wszystkie cztery ograniczenia, na ktorych stoi ta bramka", () => {
    // Kanarek zasiegu: gdyby ktorykolwiek wzorzec przestal pasowac, asercje
    // nizej rzucalyby wyjatek zamiast cicho przechodzic - ale ten test mowi
    // o tym wprost i jednym zdaniem.
    expect(inCheck("event_type").size).toBeGreaterThan(0);
    expect(inCheck("eligibility").size).toBeGreaterThan(0);
    expect(betweenCheck("monthly_limit").max).toBeGreaterThan(0);
    expect(columnDefault("max_redemptions_per_link")).toBeGreaterThan(0);
  });

  it("zadne ograniczenie modulu nie chowa sie za `IS NULL OR` (znana luka wzorca)", () => {
    // Wzorzec nie widzi kolumn nullowalnych zapisanych jako
    // `CHECK (kol IS NULL OR kol IN (...))`. Dopoki taki zapis nie pojawi sie
    // przy kolumnach tego modulu, bramka mierzy to, co obiecuje.
    const hidden = /CHECK\s*\(\s*(event_type|eligibility)\s+IS\s+NULL\s+OR/i;
    for (const sql of SQL) expect(hidden.test(sql)).toBe(false);
  });
});

describe("bramka: typy zdarzen audytu", () => {
  it("EVENT_PILL_CLS === CHECK (event_type IN ...) na gift_events", () => {
    // Klucze mapy pigulek sa jedynym runtime'owym lustrem unii `GiftEventType`
    // (sama unia zyje tylko w typach), a `Record<GiftEventType, string>`
    // wymusza na kompilatorze komplet - wiec ta rownosc laczy TRZY warstwy:
    // typ TS, mape UI i CHECK w bazie.
    expect(Object.keys(EVENT_PILL_CLS).sort()).toEqual([...inCheck("event_type")].sort());
  });

  it("`exhausted` jest zdarzeniem, ktore baza zna i panel umie pokazac", () => {
    // Regresja do zlapania: migracja 20260806170000 dolozyla "odbicie od
    // wyczerpanego budzetu". Bez wpisu w mapie audyt pokazywalby je bez
    // tonacji ostrzegawczej - czyli dokladnie zdarzenie, po ktore admin
    // wchodzi w te zakladke, wygladaloby jak zdarzenie neutralne.
    expect(inCheck("event_type")).toContain("exhausted");
    expect(Object.keys(EVENT_PILL_CLS)).toContain("exhausted");
  });

  it("panel nie zna typow spoza bazy", () => {
    const allowed = inCheck("event_type");
    for (const type of Object.keys(EVENT_PILL_CLS)) expect(allowed).toContain(type);
  });
});

describe("bramka: bramka uprawnienia", () => {
  it("GIFT_ELIGIBILITY_OPTIONS === CHECK (eligibility IN ...)", () => {
    expect([...GIFT_ELIGIBILITY_OPTIONS].sort()).toEqual([...inCheck("eligibility")].sort());
  });

  it("domyslna bramka panelu jest wartoscia, ktora baza przyjmuje", () => {
    expect(inCheck("eligibility")).toContain(DEFAULT_GIFT_ADMIN_SETTINGS.eligibility);
    expect(inCheck("eligibility")).toContain(DEFAULT_GIFT_SETTINGS.eligibility);
  });
});

describe("bramka: zakresy limitow", () => {
  it.each(GIFT_ADMIN_LIMIT_FIELDS)("GIFT_ADMIN_BOUNDS.%s === CHECK BETWEEN w bazie", (field) => {
    const db = betweenCheck(field);
    expect({ min: GIFT_ADMIN_BOUNDS[field].min, max: GIFT_ADMIN_BOUNDS[field].max }).toEqual(db);
  });

  it.each(GIFT_ADMIN_LIMIT_FIELDS)("fallback %s miesci sie w zakresie bazy", (field) => {
    const { min, max, fallback } = GIFT_ADMIN_BOUNDS[field];
    expect(fallback).toBeGreaterThanOrEqual(min);
    expect(fallback).toBeLessThanOrEqual(max);
  });
});

describe("bramka: efektywne domyslne przy braku wiersza ustawien", () => {
  it.each(GIFT_ADMIN_LIMIT_FIELDS)("%s: fallback panelu === DEFAULT kolumny", (field) => {
    // Panel BEZ wiersza w `gift_article_settings` pokazuje te liczby jako
    // "efektywne domyslne" i obiecuje, ze zapis tylko je utrwali. Rozjazd
    // z DEFAULT-em kolumny zamienia te obietnice w klamstwo.
    expect(GIFT_ADMIN_BOUNDS[field].fallback).toBe(columnDefault(field));
  });

  it("DEFAULT_GIFT_ADMIN_SETTINGS i DEFAULT_GIFT_SETTINGS mowia to samo", () => {
    // Dwa modele (panel i widok czytelnika) czytaja te same fallbacki RPC.
    // Rozjazd znaczylby, ze admin ustawia jedno, a popover obiecuje drugie.
    for (const field of GIFT_ADMIN_LIMIT_FIELDS) {
      expect(DEFAULT_GIFT_ADMIN_SETTINGS[field]).toBe(DEFAULT_GIFT_SETTINGS[field]);
    }
    expect(DEFAULT_GIFT_ADMIN_SETTINGS.eligibility).toBe(DEFAULT_GIFT_SETTINGS.eligibility);
    expect(DEFAULT_GIFT_ADMIN_SETTINGS.enabled).toBe(DEFAULT_GIFT_SETTINGS.enabled);
  });

  it("budzet klikniec domyslnie wynosi 5, a nie 50 (utwardzenie 20260806170000)", () => {
    // Migracja 20260724090600 dala cap 50 "zeby nie bylo nieskonczonosci";
    // 20260806170000 obnizyla go do 5 i przestawila istniejace wiersze.
    // Powrot do 50 w kliencie byloby cicha zmiana mechaniki produktowej.
    expect(columnDefault("max_redemptions_per_link")).toBe(5);
    expect(DEFAULT_GIFT_SETTINGS.max_redemptions_per_link).toBe(5);
  });
});
