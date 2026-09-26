// @vitest-environment node
// BRAMKA: platformy dziennika wydań w TS == CHECK w bazie.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TEGO TESTU. `_event_wallet_pass_note` odrzuca
// platformę spoza `event_wallet_passes_platform_values` - a trasa traktuje
// dziennik jako best-effort, więc rozjazd nie dałby błędu uczestnikowi, tylko
// CICHO puste wiersze dziennika, na których ma się oprzeć późniejsza
// dezaktywacja przepustek Google po anulowaniu zgłoszenia.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { WALLET_PLATFORMS } from "../walletRoutes.server";

const DIR = join(process.cwd(), "supabase", "migrations");

/** Ostatnia definicja ograniczenia w łańcuchu migracji (kolejność nazw plików). */
function lastCheckValues(constraint: string): string[] {
  let values: string[] = [];
  for (const file of readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(DIR, file), "utf8");
    const at = sql.lastIndexOf(`CONSTRAINT ${constraint} CHECK`);
    if (at === -1) continue;
    const list = sql.slice(at, sql.indexOf(")", at));
    values = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }
  return values;
}

describe("platformy portfela", () => {
  it("WALLET_PLATFORMS to dokładnie wartości CHECK-a dziennika wydań", () => {
    expect(lastCheckValues("event_wallet_passes_platform_values")).toEqual([...WALLET_PLATFORMS]);
  });
});
