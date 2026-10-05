// BRAMKA: słowniki dziennika moderacji klubów w kliencie == białe listy CHECK.
//
// `club_moderation_log.action` i `.target_type` to `text` z `CHECK (... IN
// (...))`, więc typ generowany z bazy jest `string` i kompilator rozjazdu nie
// zobaczy. Rozjazd w obie strony już był:
//   * baza dopuściła `report` (20260808200000) i `invite_segment`
//     (20260808290000), a `CLUB_LOG_ACTIONS` ich nie znało - wpisy miały surowy
//     kod zamiast etykiety i nie dało się ich wybrać w filtrze dziennika;
//   * funkcje pisały `club_updated`, `club_proposed` i cel `club`, których nie
//     znała ani baza, ani klient - każdy taki zapis kończył się 23514
//     (naprawa: 20261004090000).
// Ten plik porównuje listę klienta z OSTATNIĄ definicją ograniczenia
// w łańcuchu migracji (kolejność nazw plików = kolejność `db push`). Zgodność
// literałów w ciałach funkcji z tymi listami pilnuje pgTAP:
// `supabase/tests/check_whitelist_writers_test.sql`.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CLUB_LOG_ACTIONS, CLUB_LOG_TARGETS } from "@/lib/clubs/types";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function lastCheckValues(constraint: string): readonly string[] {
  const re = new RegExp(
    String.raw`ADD\s+CONSTRAINT\s+${constraint}\s+CHECK\s*\(\s*[a-z_]+\s+IN\s*\(([^)]*)\)\s*\)`,
    "gi",
  );
  let last: readonly string[] | null = null;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const m of sql.matchAll(re)) {
      last = m[1]
        .split(",")
        .map((v) => v.trim().replace(/^'|'$/g, ""))
        .filter((v) => v.length > 0);
    }
  }
  if (last === null) {
    throw new Error(`Nie znaleziono ADD CONSTRAINT ${constraint} w supabase/migrations.`);
  }
  return last;
}

describe("dziennik moderacji klubów - słowniki klienta i bazy", () => {
  it("CLUB_LOG_ACTIONS to dokładnie club_moderation_log_action_check", () => {
    expect([...CLUB_LOG_ACTIONS].sort()).toEqual(
      [...lastCheckValues("club_moderation_log_action_check")].sort(),
    );
  });

  it("CLUB_LOG_TARGETS to dokładnie club_moderation_log_target_type_check", () => {
    expect([...CLUB_LOG_TARGETS].sort()).toEqual(
      [...lastCheckValues("club_moderation_log_target_type_check")].sort(),
    );
  });
});
