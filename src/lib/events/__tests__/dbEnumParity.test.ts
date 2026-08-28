// BRAMKA: stale wyliczeniowe klienta zgadzaja sie z ograniczeniami CHECK w bazie.
//
// PO CO TEN PLIK ISTNIEJE. Kolumny wyliczeniowe modulu Wydarzen sa typu `text`
// z ograniczeniem `CHECK (kolumna IN (...))`. Typ generowany z bazy to wiec
// `string` - kompilator NIE ZOBACZY, ze panel oferuje wartosc, ktorej baza nie
// przyjmie. Przed ta bramka w module byly trzy takie rozjazdy naraz:
//
//   * `PACKAGE_AUDIENCES` mialo `["company", "university", "delegation", "partner"]`
//     przy CHECK-u `('public', 'member', 'academic', 'ngo', 'company')` - trzy
//     z czterech opcji dialogu konczylo sie naruszeniem ograniczenia, a przebieg
//     szczesliwy dzialal wylacznie dlatego, ze `company` jest wartoscia domyslna;
//   * `BADGE_PAPER_FORMATS` oferowalo `cr80`, ktorego CHECK nie zna, i ukrywalo
//     cztery formaty, ktore zna;
//   * `PACKAGE_ORDER_STATUSES` gubilo `refunded`, mimo ze RPC je przyjmuje.
//
// Kazdy z nich mial nad soba komentarz obiecujacy „odwzorowanie jeden do
// jednego". Komentarz nie jest bramka - ten plik nia jest.
//
// SUBSET, A NIE ROWNOSC, TAM GDZIE ZAWEZENIE JEST CELOWE. Czesc list swiadomie
// pokazuje mniej niz baza dopuszcza (np. panel odprawy zapisuje tylko dwa
// zrodla check-inu z czterech mozliwych). Takie pary sa tu wypisane osobno,
// z powodem - zeby zawezenie bylo DECYZJA, a nie przeoczeniem.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PACKAGE_AUDIENCES, PACKAGE_ORDER_STATUSES } from "@/lib/events/packagesApi";
import {
  BADGE_ORIENTATIONS,
  BADGE_PAPER_FORMATS,
  MANUAL_CHECKIN_SOURCES,
} from "@/lib/events/onsiteApi";
import {
  CHECKIN_DIRECTIONS,
  CHECKIN_SOURCES,
  CHECKPOINT_ACCESS_MODES,
  CHECKPOINT_DIRECTION_MODES,
} from "@/lib/events/onsiteEnums";
import { ARRANGEABLE_STATUSES } from "@/lib/events/meetingParticipants";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Wartosci dopuszczone przez KAZDE nazwane ograniczenie `CHECK (kol IN (...))`
 * na tabelach `event_*`, w stanie po odtworzeniu calego lancucha migracji.
 *
 * Ostatnia definicja wygrywa - dokladnie tak, jak przy `supabase db push`.
 * To jest jedyny uczciwy sposob czytania tego repozytorium: prawie kazda tabela
 * modulu jest tworzona dwa razy (plik opisowy i migracja panelu z UUID-em
 * w nazwie), a obowiazuje ta pozniejsza.
 */
function checkEnums(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const re = /CONSTRAINT\s+(event_[a-z0-9_]+)\s+CHECK\s*\(\s*[a-z_]+\s+IN\s*\(([^)]*)\)\s*\)/gi;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const m of sql.matchAll(re)) {
      const values = m[2]
        .split(",")
        .map((v) => v.trim().replace(/^'|'$/g, ""))
        .filter((v) => v.length > 0);
      if (values.length > 0) out.set(m[1], new Set(values));
    }
  }
  return out;
}

const ENUMS = checkEnums();

function dbValues(constraint: string): Set<string> {
  const found = ENUMS.get(constraint);
  if (found === undefined) {
    throw new Error(
      `Nie znaleziono ograniczenia ${constraint} w supabase/migrations. ` +
        `Jesli zostalo przemianowane, popraw mapowanie w tej bramce.`,
    );
  }
  return found;
}

/** Pary, ktore MUSZA byc rowne - panel oferuje dokladnie to, co baza przyjmie. */
const EQUAL: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ["PACKAGE_AUDIENCES", "event_ticket_packages_audience_values", PACKAGE_AUDIENCES],
  ["PACKAGE_ORDER_STATUSES", "event_package_orders_status_values", PACKAGE_ORDER_STATUSES],
  ["BADGE_PAPER_FORMATS", "event_badge_templates_paper_format_values", BADGE_PAPER_FORMATS],
  ["BADGE_ORIENTATIONS", "event_badge_templates_orientation_values", BADGE_ORIENTATIONS],
  ["CHECKIN_DIRECTIONS", "event_checkins_direction_values", CHECKIN_DIRECTIONS],
  ["CHECKIN_SOURCES", "event_checkins_source_values", CHECKIN_SOURCES],
  ["CHECKPOINT_ACCESS_MODES", "event_checkpoints_access_mode_values", CHECKPOINT_ACCESS_MODES],
  [
    "CHECKPOINT_DIRECTION_MODES",
    "event_checkpoints_direction_mode_values",
    CHECKPOINT_DIRECTION_MODES,
  ],
];

/** Pary, w ktorych panel CELOWO pokazuje mniej - z powodem. */
const SUBSET: ReadonlyArray<readonly [string, string, readonly string[], string]> = [
  [
    "MANUAL_CHECKIN_SOURCES",
    "event_checkins_source_values",
    MANUAL_CHECKIN_SOURCES,
    "panel odprawy zapisuje wylacznie wejscie reczne i wyszukanie po nazwisku; `qr_code` i `self_service` nadaje urzadzenie, nie czlowiek przy biurku",
  ],
  [
    "ARRANGEABLE_STATUSES",
    "event_registrations_status_values",
    ARRANGEABLE_STATUSES,
    "gielda spotkan umawia tylko osoby uczestniczace - reszta statusow to zgloszenia odrzucone, anulowane albo czekajace",
  ],
];

describe("bramka: stale klienta vs CHECK-i bazy", () => {
  it("znajduje ograniczenia w migracjach (test nie jest prozny)", () => {
    expect(ENUMS.size).toBeGreaterThan(30);
    expect(ENUMS.has("event_registrations_status_values")).toBe(true);
  });

  it.each(EQUAL)("%s === %s", (_name, constraint, values) => {
    expect([...values].sort()).toEqual([...dbValues(constraint)].sort());
  });

  it.each(SUBSET)("%s zawiera sie w %s (%s)", (_name, constraint, values, _why) => {
    const allowed = dbValues(constraint);
    for (const value of values) expect(allowed).toContain(value);
  });

  it.each(SUBSET)(
    "%s jest wezsze niz %s - inaczej nalezy do listy EQUAL",
    (_name, constraint, values) => {
      expect(values.length).toBeLessThan(dbValues(constraint).size);
    },
  );

  it("kazde celowe zawezenie ma zapisany powod", () => {
    for (const [name, , , why] of SUBSET) {
      expect(why.length, `${name} bez uzasadnienia zawezenia`).toBeGreaterThan(30);
    }
  });
});

describe("regresje, ktore ta bramka mialaby zlapac", () => {
  it("`cr80` nie jest formatem, ktory baza przyjmuje", () => {
    expect(dbValues("event_badge_templates_paper_format_values")).not.toContain("cr80");
    expect(BADGE_PAPER_FORMATS as readonly string[]).not.toContain("cr80");
  });

  it("`university`, `delegation` i `partner` nie sa odbiorcami pakietu", () => {
    const allowed = dbValues("event_ticket_packages_audience_values");
    for (const bogus of ["university", "delegation", "partner"]) {
      expect(allowed).not.toContain(bogus);
      expect(PACKAGE_AUDIENCES as readonly string[]).not.toContain(bogus);
    }
  });

  it("`refunded` jest stanem zamowienia i panel go zna", () => {
    expect(dbValues("event_package_orders_status_values")).toContain("refunded");
    expect(PACKAGE_ORDER_STATUSES as readonly string[]).toContain("refunded");
  });

  it("`confirmed` nie jest statusem zgloszenia", () => {
    expect(dbValues("event_registrations_status_values")).not.toContain("confirmed");
  });
});
