// BRAMKA: slowniki lejka Google Ads w TS zgadzaja sie z CHECK-ami migracji
// 20260926120000_event_ads_funnel.sql.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW. Kolumny sa `text` z `CHECK`-iem, wiec
// kompilator widzi `string` - nowa wartosc dopisana po jednej stronie wychodzi
// dopiero jako odmowa `23514` przy zapisie kampanii albo jako cichy wiersz
// odrzucony w beaconie lejka (endpoint zawsze odpowiada 204).
//   * kroki lejka (`event_funnel_events_step_values`) - endpoint odrzuca krok
//     spoza listy PRZED baza;
//   * rodzaje klikniec (`..._click_id_type_values`) w OBU tabelach;
//   * rodzaje dopasowania kampanii i zrodla kosztu (formularze panelu).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CLICK_ID_TYPES } from "@/lib/analytics/adAttribution";
import { AD_CAMPAIGN_MATCH_KINDS, AD_COST_SOURCES } from "@/lib/events/adsFunnelApi";
import { EVENT_FUNNEL_STEPS } from "@/lib/events/eventFunnelWire";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Ostatnia definicja kazdego nazwanego `CONSTRAINT ... CHECK (... IN (...))`. */
function checkLists(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /CONSTRAINT\s+([a-z0-9_]+)\s+CHECK\s*\(\s*[a-z_]+\s+IN\s*\(([^)]*)\)\s*\)/gi;
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const match of sql.matchAll(re)) {
      out.set(
        match[1] as string,
        (match[2] as string)
          .split(",")
          .map((value) => value.trim().replace(/^'|'$/g, ""))
          .filter((value) => value !== "")
          .sort(),
      );
    }
  }
  return out;
}

const LISTS = checkLists();

function values(constraint: string): string[] {
  const found = LISTS.get(constraint);
  if (found === undefined) throw new Error(`brak ograniczenia ${constraint} w migracjach`);
  return found;
}

describe("parytet slownikow lejka Google Ads z baza", () => {
  it.each([
    ["event_funnel_events_step_values", EVENT_FUNNEL_STEPS],
    ["event_funnel_events_click_id_type_values", CLICK_ID_TYPES],
    ["event_registration_attributions_click_id_type_values", CLICK_ID_TYPES],
    ["event_ad_campaigns_match_kind_values", AD_CAMPAIGN_MATCH_KINDS],
    ["event_ad_campaign_costs_source_values", AD_COST_SOURCES],
  ] as const)("%s", (constraint, list) => {
    expect(values(constraint)).toEqual([...list].sort());
  });

  it("bramka mierzy niepusty zbior (parser nie zgubil migracji)", () => {
    expect(values("event_ad_campaigns_platform_values")).toEqual(["google_ads"]);
  });
});
