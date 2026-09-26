// BRAMKA NABORU PRELEGENTÓW: zbiory z `cfpEnums.ts` = ograniczenia CHECK w bazie.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - pilnowane niżej:
// Kolumny wyliczeniowe naboru są typu `text` z `CHECK (kolumna IN (...))`, więc
// typ generowany to `string` i kompilator nie zobaczy, że panel oferuje wartość,
// której baza nie przyjmie (albo nie zna wartości, którą baza oddaje). Ta sama
// technika, co w `dbEnumParity.test.ts`, z jedną różnicą: kilka kolumn naboru
// jest NULLOWALNYCH (`notified_status`, `recommendation`), a ich CHECK ma postać
// `x IS NULL OR x IN (...)` - wyrażenie niżej ją rozumie.
//
// OSTATNIA DEFINICJA WYGRYWA, jak przy `supabase db push`: role obsady i formy
// sesji pochodzą z migracji agendy, więc czytamy cały łańcuch.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CFP_FIELD_TYPES,
  CFP_NOTICES,
  CFP_RECOMMENDATIONS,
  CFP_SESSION_FORMATS,
  CFP_SPEAKER_ROLES,
  CFP_STATUSES,
  CFP_SUBMISSION_STATUSES,
  CFP_TALK_LANGUAGES,
  SPEAKER_MATERIAL_KINDS,
  SPEAKER_MATERIAL_VISIBILITIES,
} from "@/lib/events/cfpEnums";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const RE =
  /CONSTRAINT\s+(event_[a-z0-9_]+)\s+CHECK\s*\(\s*(?:[a-z_]+\s+IS\s+NULL\s+OR\s+)?[a-z_]+\s+IN\s*\(([^)]*)\)/gi;

function checkEnums(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const match of sql.matchAll(RE)) {
      const values = match[2]
        .split(",")
        .map((value) => value.trim().replace(/^'|'$/g, ""))
        .filter((value) => value.length > 0);
      if (values.length > 0) out.set(match[1], new Set(values));
    }
  }
  return out;
}

const ENUMS = checkEnums();

function dbValues(constraint: string): string[] {
  const found = ENUMS.get(constraint);
  if (found === undefined) throw new Error(`brak ograniczenia ${constraint} w supabase/migrations`);
  return [...found].sort();
}

const EQUAL: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ["CFP_STATUSES", "event_cfp_settings_status_values", CFP_STATUSES],
  ["CFP_FIELD_TYPES", "event_cfp_fields_field_type_values", CFP_FIELD_TYPES],
  ["CFP_SUBMISSION_STATUSES", "event_cfp_submissions_status_values", CFP_SUBMISSION_STATUSES],
  [
    "CFP_TALK_LANGUAGES (talk_language)",
    "event_cfp_submissions_talk_language_values",
    CFP_TALK_LANGUAGES,
  ],
  [
    "CFP_TALK_LANGUAGES (notify_lang)",
    "event_cfp_submissions_notify_lang_values",
    CFP_TALK_LANGUAGES,
  ],
  ["CFP_NOTICES", "event_cfp_submissions_notified_status_values", CFP_NOTICES],
  ["CFP_SPEAKER_ROLES", "event_cfp_submission_speakers_role_values", CFP_SPEAKER_ROLES],
  ["CFP_SPEAKER_ROLES (obsada sesji)", "event_session_speakers_role_values", CFP_SPEAKER_ROLES],
  ["CFP_RECOMMENDATIONS", "event_cfp_reviews_recommendation_values", CFP_RECOMMENDATIONS],
  ["SPEAKER_MATERIAL_KINDS", "event_speaker_materials_kind_values", SPEAKER_MATERIAL_KINDS],
  [
    "SPEAKER_MATERIAL_VISIBILITIES",
    "event_speaker_materials_visibility_values",
    SPEAKER_MATERIAL_VISIBILITIES,
  ],
  ["CFP_SESSION_FORMATS", "event_sessions_format_values", CFP_SESSION_FORMATS],
];

describe("nabór prelegentów: stałe klienta vs CHECK-i bazy", () => {
  it("skan znajduje ograniczenia naboru (bramka nie jest pusta)", () => {
    expect(ENUMS.has("event_cfp_submissions_status_values")).toBe(true);
    expect(ENUMS.has("event_cfp_reviews_recommendation_values")).toBe(true);
  });

  it.each(EQUAL)("%s === %s", (_name, constraint, values) => {
    expect([...values].sort()).toEqual(dbValues(constraint));
  });
});
