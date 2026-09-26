// Efektywny koniec wydarzenia - reguła TS i jej PARYTET z SQL.
//
// `_event_effective_end` otwiera ankietę i liczy dostępność certyfikatu po
// stronie bazy, a `eventEffectiveEnd` przenosi wpis z „trwa" do „minione" po
// stronie klienta. Rozjazd (np. 12 h zamiast 24 h w jednej z nich) daje
// ankietę otwartą dla wydarzenia, które lista pokazuje jako trwające.
// Przypadki są TE SAME, co w harnessie `13_participant_foundation.sql`
// (asercje `13/czas: _event_effective_end …`), a ciało funkcji czytamy
// z migracji po sufiksie nazwy.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  EVENT_DEFAULT_DURATION_MS,
  eventEffectiveEnd,
  eventEffectiveEndMs,
} from "@/lib/events/effectiveEnd";

function readBySuffix(dir: string, suffix: string): string {
  const files = readdirSync(dir).filter((name) => name.endsWith(suffix));
  expect(files, `${dir}/*${suffix}`).toHaveLength(1);
  return readFileSync(join(dir, files[0]), "utf8");
}

const MIGRATION = readBySuffix(
  join(process.cwd(), "supabase", "migrations"),
  "_event_participant_foundation.sql",
);
const HARNESS = readBySuffix(
  join(process.cwd(), "scripts", "events-harness", "runtime_test.d"),
  "_participant_foundation.sql",
);

/** Wspólne przypadki z harnessem 13_: [starts_at, ends_at, oczekiwany koniec]. */
const SHARED_CASES: ReadonlyArray<readonly [string, string | null, string]> = [
  ["2030-06-10 08:00+00", null, "2030-06-11 08:00+00"],
  ["2030-06-10 08:00+00", "2030-06-10 12:00+00", "2030-06-10 12:00+00"],
];

function iso(pgLiteral: string): string {
  return new Date(pgLiteral.replace(" ", "T").replace("+00", "Z")).toISOString();
}

describe("parytet z SQL", () => {
  it("ciało _event_effective_end to COALESCE(ends, starts + 24 h)", () => {
    const body =
      /FUNCTION public\._event_effective_end\([^)]*\)[\s\S]*?\$function\$([\s\S]*?)\$function\$/.exec(
        MIGRATION,
      );
    expect(body).not.toBeNull();
    expect(body?.[1].replace(/\s+/g, " ").trim()).toBe(
      "SELECT COALESCE(_ends, _starts + interval '24 hours');",
    );
    expect(EVENT_DEFAULT_DURATION_MS).toBe(24 * 60 * 60 * 1000);
  });

  it.each(SHARED_CASES)(
    "harness 13_ pyta o (%s, %s) -> %s i TS daje to samo",
    (start, end, want) => {
      const call =
        end === null
          ? `public._event_effective_end('${start}', NULL) = '${want}'`
          : `public._event_effective_end('${start}', '${end}') = '${want}'`;
      expect(HARNESS).toContain(call);
      expect(eventEffectiveEnd(iso(start), end === null ? null : iso(end))?.toISOString()).toBe(
        iso(want),
      );
    },
  );
});

describe("eventEffectiveEnd", () => {
  it("koniec wygrywa nawet bez startu (COALESCE)", () => {
    expect(eventEffectiveEnd(null, "2030-06-10T12:00:00Z")?.toISOString()).toBe(
      "2030-06-10T12:00:00.000Z",
    );
  });

  it("nieczytelny koniec = start + doba", () => {
    expect(eventEffectiveEnd("2030-06-10T08:00:00Z", "nie-data")?.toISOString()).toBe(
      "2030-06-11T08:00:00.000Z",
    );
  });

  it.each([
    [null, null],
    [undefined, undefined],
    ["x", null],
  ])("bez startu i końca -> null (%j, %j)", (start, end) => {
    expect(eventEffectiveEnd(start, end)).toBeNull();
  });
});

describe("eventEffectiveEndMs", () => {
  const start = Date.parse("2030-06-10T08:00:00Z");

  it("koniec z bazy", () => {
    expect(eventEffectiveEndMs(start, "2030-06-10T12:00:00Z")).toBe(
      Date.parse("2030-06-10T12:00:00Z"),
    );
  });

  it.each([null, undefined, "x"])("brak/nieczytelny koniec (%j) = start + doba", (end) => {
    expect(eventEffectiveEndMs(start, end)).toBe(start + EVENT_DEFAULT_DURATION_MS);
  });
});
