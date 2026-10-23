// Parytet terminu decyzji o pomiarze otwarć i kliknięć TS <-> SQL (I9d-Y2b R1,
// przegląd PR 533 zgoda-r1-5).
//
// Jedna liczba dni rządzi trzema miejscami: podpisem linku prośby (`mc:`)
// i sekretem skrzynki z maila DOI (`md:`) po stronie TS
// (`MEASUREMENT_CONFIRM_LINK_DAYS`), stałą `c_offer_days` w SQL (stan oferty
// prośby po zapisie i stan karty na stronie DOI) oraz zdaniem „w ciągu N dni"
// w polityce komunikacji. Zmiana tylko jednej z nich przechodziłaby CI na
// zielono, a osoba dostałaby inny termin, niż obiecuje tekst prawny.
//
// Test czyta NAJNOWSZĄ definicję każdej funkcji (wzorzec
// `measurementSignupCopy.test.ts` - limit próśb po zapisie).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MEASUREMENT_CONFIRM_LINK_DAYS } from "../measurement";
import { MEASUREMENT_CONFIRM_TOKEN_TTL_DAYS } from "../measurementToken.server";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");

/** Ciało najnowszej definicji funkcji `public.<fn>` (od CREATE do `$$;`). */
function latestBody(fn: string): string | null {
  const create = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`);
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files.reverse()) {
    const sql = readFileSync(join(MIGRATIONS, name), "utf8");
    const match = create.exec(sql);
    if (!match) continue;
    const start = match.index;
    const open = sql.indexOf("AS $$", start);
    const end = sql.indexOf("$$;", open + 5);
    return open < 0 || end < 0 ? null : sql.slice(start, end);
  }
  return null;
}

function offerDays(body: string | null): number[] {
  return [...(body ?? "").matchAll(/c_offer_days\s+constant\s+integer\s*:=\s*(\d+)\s*;/g)].map(
    (m) => Number(m[1]),
  );
}

describe("termin decyzji o pomiarze: jedna liczba dni (TS, SQL, tekst prawny)", () => {
  it("token prośby i sekret skrzynki biorą termin z jednego źródła", () => {
    expect(Number.isInteger(MEASUREMENT_CONFIRM_LINK_DAYS)).toBe(true);
    expect(MEASUREMENT_CONFIRM_LINK_DAYS).toBeGreaterThan(0);
    expect(MEASUREMENT_CONFIRM_TOKEN_TTL_DAYS).toBe(MEASUREMENT_CONFIRM_LINK_DAYS);
  });

  it.each(["_newsletter_measurement_offer_state", "_newsletter_doi_measurement_offer_state"])(
    "`c_offer_days` najnowszej definicji %s = MEASUREMENT_CONFIRM_LINK_DAYS",
    (fn) => {
      const days = offerDays(latestBody(fn));
      expect(days).toHaveLength(1);
      expect(days[0]).toBe(MEASUREMENT_CONFIRM_LINK_DAYS);
    },
  );

  it("polityka komunikacji obiecuje ten sam termin (PL i EN)", () => {
    const text = readFileSync(join(ROOT, "src/lib/legal/content/communications.ts"), "utf8");
    const pl = [...text.matchAll(/decyzję możesz podjąć w ciągu (\d+) dni/g)].map((m) =>
      Number(m[1]),
    );
    const en = [...text.matchAll(/you can decide within (\d+) days/g)].map((m) => Number(m[1]));
    expect(pl).toEqual([MEASUREMENT_CONFIRM_LINK_DAYS]);
    expect(en).toEqual([MEASUREMENT_CONFIRM_LINK_DAYS]);
  });
});
