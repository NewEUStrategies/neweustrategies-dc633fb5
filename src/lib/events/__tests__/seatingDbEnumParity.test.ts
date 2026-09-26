// BRAMKA: stałe PLANU SALI po stronie klienta == ograniczenia i reguły w bazie.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TEGO TESTU. Kolumny słownikowe planu sali są
// typu `text` z `CHECK (... IN (...))`, a limity siedzą w `CHECK (... BETWEEN
// ...)`. Typ z generatora to `string`/`number`, więc kompilator nie zobaczy, że:
//   * dialog oferuje numerację, której baza nie zna (odmowa po „Zapisz”),
//   * formularz przepuszcza 250 rzędów, a baza przyjmuje 200 (odmowa po
//     kliknięciu) albo odwrotnie (formularz blokuje poprawny plan),
//   * lista „kto może usiąść” w panelu różni się od statusów, które trigger
//     przydziału dopuszcza - panel pokazuje osobę, której nie da się posadzić.
// Ostatnia definicja w łańcuchu migracji wygrywa, jak przy `supabase db push`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SEATABLE_REGISTRATION_STATUSES,
  SEAT_ASSIGNMENT_SOURCES,
  SEAT_BATCH_LIMIT,
  SEAT_CANDIDATES_PAGE,
  SEAT_LOOKUP_LIMIT,
  SEAT_MAP_STATUSES,
  SEAT_NUMBERINGS,
  SEAT_RELEASE_REASONS,
  SEAT_ROW_LABEL_SCHEMES,
  SEAT_SECTION_KINDS,
  SEAT_STATUSES,
  SEAT_TABLE_SHAPES,
  SEAT_UPDATE_LIMIT,
} from "@/lib/events/seatingApi";
import {
  SEAT_AISLES_MAX,
  SEAT_CATEGORY_KEY_PATTERN,
  SEAT_CATEGORY_NAME_MAX,
  SEAT_COLOR_PATTERN,
  SEAT_MAP_NAME_MAX,
  SEAT_MAP_SIZE_MAX,
  SEAT_MAP_SIZE_MIN,
  SEAT_NOTE_MAX,
  SEAT_NUMBER_START_MAX,
  SEAT_PER_ROW_MAX,
  SEAT_PITCH_MAX,
  SEAT_PITCH_MIN,
  SEAT_POSITION_MAX,
  SEAT_POSITION_MIN,
  SEAT_ROTATION_MAX,
  SEAT_ROWS_MAX,
  SEAT_ROW_START_MAX,
  SEAT_SECTION_LABEL_MAX,
  SEAT_SECTION_SEATS_MAX,
  SEAT_TABLE_SEATS_MAX,
} from "@/lib/events/seatingDraft";

const DIR = join(process.cwd(), "supabase", "migrations");
const SQL = readdirSync(DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(join(DIR, file), "utf8"))
  .join("\n");

/** Tekst ostatniej definicji nazwanego ograniczenia (do najbliższego `CONSTRAINT`/`);`). */
function constraint(name: string): string {
  // Nazwa bywa zakonczona spacja albo nowa linia (dlugie CHECK-i lamane).
  const marker = new RegExp(`CONSTRAINT ${name}\\s`, "g");
  const hits = [...SQL.matchAll(marker)];
  const last = hits.at(-1);
  if (last === undefined) throw new Error(`Brak ograniczenia ${name} w supabase/migrations`);
  const rest = SQL.slice((last.index ?? 0) + last[0].length);
  const end = rest.search(/\n\s*CONSTRAINT |\n\);/);
  return rest.slice(0, end);
}

/** Wartości z `IN ('a', 'b')` w tekście ograniczenia. */
function inValues(name: string): string[] {
  const body = constraint(name);
  const list = /IN\s*\(([^)]*)\)/.exec(body);
  if (list === null) throw new Error(`${name}: brak listy IN (...)`);
  return [...list[1].matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** Ciało ostatniej definicji funkcji. */
function functionBody(name: string): string {
  const at = SQL.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at === -1) throw new Error(`Brak funkcji ${name}`);
  const start = SQL.indexOf("$$", at);
  return SQL.slice(start + 2, SQL.indexOf("$$", start + 2));
}

describe("słowniki planu sali == CHECK w bazie", () => {
  it.each([
    ["event_seat_maps_status_values", SEAT_MAP_STATUSES],
    ["event_seat_sections_kind_values", SEAT_SECTION_KINDS],
    ["event_seat_sections_row_label_scheme_values", SEAT_ROW_LABEL_SCHEMES],
    ["event_seat_sections_seat_numbering_values", SEAT_NUMBERINGS],
    ["event_seat_sections_table_shape_values", SEAT_TABLE_SHAPES],
    ["event_seats_status_values", SEAT_STATUSES],
    ["event_seat_assignments_source_values", SEAT_ASSIGNMENT_SOURCES],
    ["event_seat_assignments_release_reason_values", SEAT_RELEASE_REASONS],
  ] as const)("%s", (name, values) => {
    expect([...inValues(name)].sort()).toEqual([...values].sort());
  });
});

describe("statusy zgłoszeń zajmujące miejsce na sali", () => {
  it("trigger walidacji, reguły przydziału, kandydaci i zwolnienie mówią o TYM SAMYM zbiorze", () => {
    const expected = `IN ('${SEATABLE_REGISTRATION_STATUSES.join("', '")}')`;
    for (const fn of [
      "_tg_event_seat_assignment_validate",
      "_event_seat_assign_problem",
      "admin_event_seating_candidates",
      "admin_event_seat_maps_list",
    ]) {
      expect(functionBody(fn), fn).toContain(expected);
    }
    const trigger = SQL.slice(SQL.lastIndexOf("CREATE TRIGGER event_registrations_release_seats"));
    expect(trigger.slice(0, 400)).toContain(
      `NOT IN ('${SEATABLE_REGISTRATION_STATUSES.join("', '")}')`,
    );
  });
});

describe("limity formularzy == limity bazy", () => {
  it("plan: nazwa i rozmiar", () => {
    expect(constraint("event_seat_maps_name_len")).toContain(`BETWEEN 1 AND ${SEAT_MAP_NAME_MAX}`);
    expect(constraint("event_seat_maps_size_range")).toContain(
      `width BETWEEN ${SEAT_MAP_SIZE_MIN} AND ${SEAT_MAP_SIZE_MAX}`,
    );
  });

  it("sekcja: rzędy, miejsca, stół, rozstaw, start, położenie, przejścia, etykieta", () => {
    const shape = constraint("event_seat_sections_shape");
    expect(shape).toContain(`rows_count BETWEEN 1 AND ${SEAT_ROWS_MAX}`);
    expect(shape).toContain(`seats_per_row BETWEEN 1 AND ${SEAT_PER_ROW_MAX}`);
    expect(shape).toContain(`rows_count * seats_per_row <= ${SEAT_SECTION_SEATS_MAX}`);
    expect(shape).toContain(`table_seats BETWEEN 1 AND ${SEAT_TABLE_SEATS_MAX}`);
    expect(constraint("event_seat_sections_pitch_range")).toContain(
      `seat_pitch BETWEEN ${SEAT_PITCH_MIN} AND ${SEAT_PITCH_MAX}`,
    );
    const starts = constraint("event_seat_sections_starts_range");
    expect(starts).toContain(`row_label_start BETWEEN 1 AND ${SEAT_ROW_START_MAX}`);
    expect(starts).toContain(`seat_number_start BETWEEN 1 AND ${SEAT_NUMBER_START_MAX}`);
    const position = constraint("event_seat_sections_position_range");
    expect(position).toContain(`origin_x BETWEEN ${SEAT_POSITION_MIN} AND ${SEAT_POSITION_MAX}`);
    expect(position).toContain(
      `rotation_deg BETWEEN -${SEAT_ROTATION_MAX} AND ${SEAT_ROTATION_MAX}`,
    );
    expect(constraint("event_seat_sections_aisles_len")).toContain(`<= ${SEAT_AISLES_MAX}`);
    expect(constraint("event_seat_sections_label_len")).toContain(
      `BETWEEN 1 AND ${SEAT_SECTION_LABEL_MAX}`,
    );
  });

  it("kategoria i notatki", () => {
    expect(constraint("event_seat_categories_key_format")).toContain(
      SEAT_CATEGORY_KEY_PATTERN.source,
    );
    expect(constraint("event_seat_categories_color_hex")).toContain(SEAT_COLOR_PATTERN.source);
    expect(constraint("event_seat_categories_names_len")).toContain(
      `BETWEEN 1 AND ${SEAT_CATEGORY_NAME_MAX}`,
    );
    expect(constraint("event_seats_notes_len")).toContain(`<= ${SEAT_NOTE_MAX}`);
  });

  it("limity wywołań RPC: paczka przydziału, lookup, zmiana miejsc, strona kandydatów", () => {
    expect(functionBody("admin_event_seat_assign_batch")).toContain(`> ${SEAT_BATCH_LIMIT} THEN`);
    expect(functionBody("admin_event_seat_lookup")).toContain(`> ${SEAT_LOOKUP_LIMIT} THEN`);
    expect(functionBody("admin_event_seats_update")).toContain(`> ${SEAT_UPDATE_LIMIT} THEN`);
    expect(functionBody("admin_event_seating_candidates")).toContain(
      `, 1), ${SEAT_CANDIDATES_PAGE})`,
    );
  });
});
