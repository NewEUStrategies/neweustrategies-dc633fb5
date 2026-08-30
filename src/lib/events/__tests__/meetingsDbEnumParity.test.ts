// BRAMKA: stale GIEŁDY SPOTKAŃ 1-1 zgadzają się z ograniczeniami CHECK w bazie.
//
// PO CO TEN PLIK ISTNIEJE. Kolumny słownikowe modułu giełdy są typu `text`
// z ograniczeniem `CHECK (kolumna IN (...))`, a granice liczbowe siedzą
// w `CHECK (... BETWEEN ...)`. Typ generowany z bazy to więc `string`
// i `number` - kompilator NIE ZOBACZY, że ekran oferuje wartość, której baza
// nie przyjmie, ani że waliduje inny zakres niż ten, który obowiązuje.
//
// TRZY PARY, KTÓRE TU STOJĄ, I CO KOSZTUJE ICH ROZJAZD:
//
//   * `MEETING_STATUSES` - stany spotkania. Stan spoza CHECK-a to odmowa przy
//     zapisie, a stan POMINIĘTY to wiersz, którego lista panelu nie umie
//     opisać: odznaka bierze się z `eventMeetings.statuses.${status}`, więc
//     brakujący stan wypisuje uczestnikowi surową ścieżkę i18n.
//   * `MEETING_VISIBILITIES` - reguła widoczności giełdy. Wartość, której baza
//     nie zna, to odmowa przy zapisie konfiguracji; wartość POMINIĘTA to reguła
//     obowiązująca na wydarzeniu, której panel nie potrafi ani pokazać, ani
//     zachować - parser `parseMeetingSettings` degraduje ją do `disabled`,
//     czyli zapis konfiguracji WYŁĄCZYŁBY działającą giełdę.
//   * `MIN_WINDOW_MINUTES` / `MAX_WINDOW_MINUTES` - granice okna dostępności.
//     Klient waliduje je PRZED wysłaniem wyłącznie po to, żeby uczestnik
//     dowiedział się o błędzie od razu. Granica luźniejsza niż w bazie znaczy
//     odmowę po kliknięciu „Zapisz"; ostrzejsza - okno, którego baza by
//     przyjęła, a formularz nie pozwala wpisać.
//
// DLACZEGO OSOBNY PLIK, A NIE DOPISEK DO `dbEnumParity`. Tamta bramka czyta
// wyłącznie `CHECK (kol IN (...))`. Połowa par tego pliku ma inne źródło -
// `BETWEEN interval ... AND interval ...` oraz `BETWEEN 1 AND 50` - czyli inny
// parser i inny powód awarii, więc stoją obok, a nie w środku tamtej bramki.
// Ten sam wzorzec co `termsGroupsDbEnumParity.test.ts`.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { MEETING_STATUSES, MEETING_VISIBILITIES } from "@/lib/events/meetingsApi";
import { MAX_WINDOW_MINUTES, MIN_WINDOW_MINUTES } from "@/lib/events/meetingWindowDraft";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Cały łańcuch migracji w kolejności stosowania - ostatnia definicja wygrywa. */
function migrationsSql(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

const SQL = migrationsSql();

/**
 * Treść ostatniej definicji nazwanego ograniczenia - odcinek SQL-a od jego
 * nazwy do najbliższego domknięcia listy.
 *
 * Wycinek bierzemy PO INDEKSIE, a nie jednym wyrażeniem regularnym po całym
 * pliku: wzorzec z `[^)]*?` i `.+?` na stukilobajtowym pliku wpada w wykładniczy
 * nawrót i zawiesza przebieg zamiast zgłosić błąd.
 *
 * Tabele tego modułu są tworzone DWA RAZY (plik opisowy i migracja panelu
 * z UUID-em w nazwie), więc liczy się definicja z pliku PÓŹNIEJSZEGO -
 * dokładnie tak, jak przy `supabase db push`.
 */
function constraintBody(constraint: string): string {
  let found: string | null = null;
  for (const sql of SQL) {
    const marker = `CONSTRAINT ${constraint}`;
    let from = sql.indexOf(marker);
    while (from !== -1) {
      found = sql.slice(from, from + 400);
      from = sql.indexOf(marker, from + 1);
    }
  }
  if (found === null) {
    throw new Error(
      `Nie znaleziono ograniczenia ${constraint} w supabase/migrations. ` +
        `Jesli zostalo przemianowane, popraw mapowanie w tej bramce.`,
    );
  }
  return found;
}

/** Wartości dopuszczone przez nazwane ograniczenie `CHECK (kol IN (...))`. */
function dbEnum(constraint: string): Set<string> {
  const body = constraintBody(constraint);
  const open = body.indexOf("IN (");
  const close = body.indexOf(")", open);
  if (open === -1 || close === -1) {
    throw new Error(`Ograniczenie ${constraint} nie jest lista IN (...).`);
  }
  const values = body
    .slice(open + 4, close)
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter((value) => value.length > 0);
  if (values.length === 0) throw new Error(`Pusta lista wartosci w ${constraint}.`);
  return new Set(values);
}

/** Granice z `CHECK (... BETWEEN <dolna> AND <gorna>)` - dwie liczby albo dwa interwały. */
function dbRange(constraint: string): { low: string; high: string } {
  const body = constraintBody(constraint);
  const match = /BETWEEN\s+([^\n]+?)\s+AND\s+([^)\n]+)/i.exec(body);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`Ograniczenie ${constraint} nie jest zakresem BETWEEN.`);
  }
  return { low: match[1].trim(), high: match[2].trim() };
}

/** `interval '15 minutes'` / `interval '16 hours'` -> minuty. */
function intervalMinutes(literal: string): number {
  const match = /interval\s+'(\d+)\s+(minute|hour)s?'/i.exec(literal);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`Nie umiem odczytac interwalu: ${literal}`);
  }
  const value = Number(match[1]);
  return match[2].toLowerCase() === "hour" ? value * 60 : value;
}

describe("bramka: słowniki giełdy spotkań vs CHECK-i bazy", () => {
  it("czyta migracje modułu (test nie jest próżny)", () => {
    expect(SQL.length).toBeGreaterThan(10);
    expect(dbEnum("event_meetings_status_values").size).toBeGreaterThan(0);
  });

  it("MEETING_STATUSES === event_meetings_status_values", () => {
    expect([...MEETING_STATUSES].sort()).toEqual(
      [...dbEnum("event_meetings_status_values")].sort(),
    );
  });

  it("MEETING_VISIBILITIES === event_meeting_settings_visibility_values", () => {
    expect([...MEETING_VISIBILITIES].sort()).toEqual(
      [...dbEnum("event_meeting_settings_visibility_values")].sort(),
    );
  });

  it("granice okna dostępności === event_meeting_availability_duration_range", () => {
    const range = dbRange("event_meeting_availability_duration_range");
    expect(MIN_WINDOW_MINUTES).toBe(intervalMinutes(range.low));
    expect(MAX_WINDOW_MINUTES).toBe(intervalMinutes(range.high));
  });
});

describe("regresje, które ta bramka miałaby złapać", () => {
  it("`pending` i `expired` są FILTRAMI panelu, a nie stanami w bazie", () => {
    // Obie wartości opisują wiersz o stanie `invited` (przed odpowiedzią i po
    // terminie ważności). Wysłanie ich jako `status` do zapisu skończyłoby się
    // naruszeniem CHECK-a - dlatego nie ma ich na liście stanów.
    const stany = dbEnum("event_meetings_status_values");
    for (const filtr of ["pending", "expired", "all"]) {
      expect(stany).not.toContain(filtr);
      expect(MEETING_STATUSES as readonly string[]).not.toContain(filtr);
    }
    expect(stany).toContain("invited");
  });

  it("`no_show` jest stanem bazy i panel go zna", () => {
    // Nieobecność jest odwracalna i ma własną odznakę; zgubienie jej na liście
    // klienta zamieniłoby ją w „nieznany stan" na ekranie organizatora.
    expect(dbEnum("event_meetings_status_values")).toContain("no_show");
    expect(MEETING_STATUSES as readonly string[]).toContain("no_show");
  });

  it("`sponsors_to_attendees` jest regułą widoczności, której panel nie może zgubić", () => {
    expect(dbEnum("event_meeting_settings_visibility_values")).toContain("sponsors_to_attendees");
    expect(MEETING_VISIBILITIES as readonly string[]).toContain("sponsors_to_attendees");
  });

  it("`organiser` jest stroną odwołującą spotkanie, ale NIE jest jego stanem", () => {
    // `cancelled_side` odróżnia odwołanie przez organizatora od odwołania przez
    // uczestnika - to inna kolumna i inny słownik niż `status`.
    const strony = dbEnum("event_meetings_cancelled_side_values");
    expect(strony).toContain("organiser");
    expect(strony).toContain("requester");
    expect(strony).toContain("invitee");
    expect(dbEnum("event_meetings_status_values")).not.toContain("organiser");
  });

  it("pojemność stolika to zakres 1-50 - jedna liczba, nie dwie różne prawdy", () => {
    // Ten sam zakres waliduje dialog stolika (`capacity >= 1 && capacity <= 50`);
    // dowód, że formularz przyjmuje DOKŁADNIE tyle, stoi w
    // `components/admin/events/__tests__/MeetingTableDialog.test.tsx`.
    const range = dbRange("event_meeting_tables_capacity_range");
    expect(Number(range.low)).toBe(1);
    expect(Number(range.high)).toBe(50);
  });
});
