// PARYTET GRUP USTAWIEŃ NEWSLETTERA: TS ⇔ SQL ⇔ schemat (PLAN S1 §4.2).
//
// Grupa to biała lista kolumn, które wolno zapisać z jednego edytora. Istnieje
// w TRZECH miejscach: `NEWSLETTER_SETTINGS_GROUPS` (klient liczy patch),
// funkcja `admin_newsletter_settings_patch` (serwer odrzuca kolumnę spoza
// grupy) i blok komentarza `newsletter-groups` w jej migracji (czytelny kontrakt).
// Rozjazd TS → SQL = zapis odrzucony 22023 dopiero na produkcji; nowa kolumna
// tabeli bez grupy = ustawienie, którego żaden edytor nie zapisze.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Database } from "@/integrations/supabase/types";
import { NEWSLETTER_SETTINGS_GROUPS, type NewsletterSettingsColumn } from "../settingsQueries";

const MIGRATION = "supabase/migrations/20261020100100_newsletter_settings_patch.sql";
/** Kolumny techniczne - pisze je sam serwer, nie edytor. */
const SYSTEM_COLUMNS = ["tenant_id", "updated_at", "updated_by"] as const;

type SettingsRow = Database["public"]["Tables"]["newsletter_settings"]["Row"];

// Parytet NA POZIOMIE TYPÓW: kolumna dodana do `types.ts` bez grupy zatrzymuje
// typecheck, zanim ktokolwiek uruchomi testy.
type Uncovered = Exclude<
  keyof SettingsRow,
  NewsletterSettingsColumn | (typeof SYSTEM_COLUMNS)[number]
>;
type Unknown = Exclude<NewsletterSettingsColumn, keyof SettingsRow>;
const everyColumnHasGroup: [Uncovered] extends [never] ? true : Uncovered = true;
const everyGroupColumnExists: [Unknown] extends [never] ? true : Unknown = true;

const sorted = (list: readonly string[]) => [...list].sort();

function tsGroups(): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(NEWSLETTER_SETTINGS_GROUPS).map(([group, columns]) => [group, sorted(columns)]),
  );
}

/** Blok komentarza `-- newsletter-groups:begin` … `:end` (jedna linia na grupę). */
function commentGroups(sql: string): Record<string, string[]> {
  const begin = sql.indexOf("-- newsletter-groups:begin");
  const end = sql.indexOf("-- newsletter-groups:end");
  expect(begin, "brak znacznika newsletter-groups:begin").toBeGreaterThanOrEqual(0);
  expect(end, "brak znacznika newsletter-groups:end").toBeGreaterThan(begin);
  const out: Record<string, string[]> = {};
  for (const line of sql.slice(begin, end).split("\n").slice(1)) {
    const m = /^\s*--\s+([a-z_]+):\s*(.+?)\s*$/.exec(line);
    if (m) out[m[1]] = sorted(m[2].split(",").map((c) => c.trim()));
  }
  return out;
}

/** Ta sama lista w KODZIE funkcji: `WHEN '<grupa>' THEN ARRAY[…]`. */
function codeGroups(sql: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of sql.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+ARRAY\[([^\]]*)\]/g)) {
    out[m[1]] = sorted([...m[2].matchAll(/'([a-z0-9_]+)'/g)].map((c) => c[1]));
  }
  return out;
}

/** Kolumny wiersza `newsletter_settings` z typów generowanych (stan bazy). */
function rowColumns(): string[] {
  const source = readFileSync("src/integrations/supabase/types.ts", "utf8");
  const m = /^ {6}newsletter_settings: \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/m.exec(source);
  expect(m, "newsletter_settings bez wiersza w types.ts").not.toBeNull();
  return [...m![1].matchAll(/^ {10}([a-z0-9_]+)\??:/gm)].map((c) => c[1]);
}

describe("parytet grup NEWSLETTER_SETTINGS_GROUPS", () => {
  it("parytet typów jest spełniony (asercja kompilatora)", () => {
    expect(everyColumnHasGroup).toBe(true);
    expect(everyGroupColumnExists).toBe(true);
  });

  it("TS = blok `newsletter-groups` migracji = lista w kodzie funkcji SQL", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const ts = tsGroups();
    expect(commentGroups(sql)).toEqual(ts);
    expect(codeGroups(sql)).toEqual(ts);
  });

  it("każda kolumna tabeli poza technicznymi należy do ≥ 1 grupy; grupy nie znają kolumn spoza tabeli", () => {
    const columns = rowColumns();
    const grouped = new Set<string>(Object.values(NEWSLETTER_SETTINGS_GROUPS).flat());
    const system = new Set<string>(SYSTEM_COLUMNS);
    expect(columns.filter((c) => !system.has(c) && !grouped.has(c))).toEqual([]);
    expect([...grouped].filter((c) => !columns.includes(c))).toEqual([]);
    // Kanarek parsera: realna tabela ma dziesiątki kolumn.
    expect(columns.length).toBeGreaterThan(40);
  });

  it("żadna grupa nie dopuszcza kolumn technicznych", () => {
    for (const columns of Object.values(NEWSLETTER_SETTINGS_GROUPS)) {
      for (const system of SYSTEM_COLUMNS) {
        expect(columns as readonly string[]).not.toContain(system);
      }
    }
  });
});
