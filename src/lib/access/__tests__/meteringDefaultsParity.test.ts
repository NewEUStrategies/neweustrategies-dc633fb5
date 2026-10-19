// PARYTET DOMYŚLNEJ KONFIGURACJI METERINGU - CZTERY ŹRÓDŁA, JEDNA WARTOŚĆ.
//
//   1. `METERING_DEFAULTS` (`meteringDefaults.ts`, liść dla huba),
//   2. `DEFAULT_METERING_SETTINGS` (`metering.ts`, formularz paywalla),
//   3. `metering_defaults()` (SQL, migracja 20261020090500),
//   4. domyślne kolumn `metering_settings` - wiersz najemcy, który nigdy nie
//      zapisał ustawień - odtworzone z HISTORII migracji (CREATE + ALTER).
//
// Czwarte źródło nie stoi w jednym pliku: tabela powstała z limitem 3
// i wyłączona, a `20260722231619` przestawiło domyślne na 5 i włączone. Test
// odtwarza ten przebieg w kolejności wersji, więc kolejna migracja zmieniająca
// domyślne bez reszty kontraktu jest czerwona tutaj.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DEFAULT_METERING_SETTINGS } from "@/lib/access/metering";
import { stripSqlComments } from "@/lib/ci/ownership";
import { METERING_DEFAULTS } from "../meteringDefaults";

const KATALOG = "supabase/migrations";
const HELPERY = `${KATALOG}/20261020090500_hub_shared_sql_helpers.sql`;
const KOLUMNY = Object.keys(METERING_DEFAULTS);

/** Zapis kanoniczny: jedna spacja, bez spacji przy nawiasach i przecinkach. */
const kanon = (sql: string) =>
  sql
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();

const czytaj = (plik: string) => kanon(stripSqlComments(readFileSync(plik, "utf8")));

/** Literał SQL wartości domyślnej → wartość JSON. */
function wartosc(literal: string): boolean | number {
  if (literal === "true") return true;
  if (literal === "false") return false;
  const n = Number(literal);
  if (!Number.isInteger(n)) throw new Error(`nieobsługiwana wartość domyślna: ${literal}`);
  return n;
}

/** Ciało `metering_defaults()`: pary `'klucz', wartość` z `jsonb_build_object`. */
function zFunkcji(): Record<string, boolean | number> {
  expect(existsSync(HELPERY), `brak migracji toru A: ${HELPERY}`).toBe(true);
  const sql = czytaj(HELPERY);
  const start = sql.indexOf("FUNCTION public.metering_defaults()");
  expect(start, "brak definicji metering_defaults()").toBeGreaterThanOrEqual(0);
  const m = /jsonb_build_object\(([^)]*)\)/.exec(sql.slice(start));
  expect(m, "metering_defaults() bez jsonb_build_object").not.toBeNull();
  const czesci = m![1].split(",");
  const out: Record<string, boolean | number> = {};
  for (let i = 0; i < czesci.length; i += 2) {
    out[czesci[i].replace(/^'|'$/g, "")] = wartosc(czesci[i + 1]);
  }
  return out;
}

/**
 * Domyślne kolumn po odtworzeniu migracji w kolejności wersji: pierwsze
 * `CREATE TABLE IF NOT EXISTS` ustala kolumny (kolejne są bez skutku), każde
 * `ALTER COLUMN … SET DEFAULT` nadpisuje wartość.
 */
function zKolumn(): Record<string, boolean | number> {
  const out: Record<string, boolean | number> = {};
  let utworzona = false;
  const pliki = readdirSync(KATALOG)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const plik of pliki) {
    const surowy = readFileSync(join(KATALOG, plik), "utf8");
    if (!surowy.includes("metering_settings")) continue;
    const sql = kanon(stripSqlComments(surowy));
    for (const instr of sql.split(";").map((i) => i.trim())) {
      if (!utworzona && /CREATE TABLE IF NOT EXISTS public\.metering_settings\(/.test(instr)) {
        utworzona = true;
        for (const kol of KOLUMNY) {
          const d = new RegExp(String.raw`[(,]${kol} [a-z]+[^,]*? DEFAULT ([a-z0-9]+)`).exec(instr);
          if (d) out[kol] = wartosc(d[1]);
        }
      }
      if (/^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?public\.metering_settings /.test(instr)) {
        for (const a of instr.matchAll(/ALTER COLUMN (\w+) SET DEFAULT ([a-z0-9]+)/g)) {
          if (KOLUMNY.includes(a[1])) out[a[1]] = wartosc(a[2]);
        }
      }
    }
  }
  expect(utworzona, "nie znaleziono CREATE TABLE public.metering_settings").toBe(true);
  return out;
}

describe("METERING_DEFAULTS - jedna wartość w czterech miejscach", () => {
  it("= DEFAULT_METERING_SETTINGS z metering.ts", () => {
    expect(METERING_DEFAULTS).toEqual(DEFAULT_METERING_SETTINGS);
  });

  it("= jsonb_build_object w metering_defaults() (090500)", () => {
    expect(zFunkcji()).toEqual(METERING_DEFAULTS);
  });

  it("= domyślne kolumn metering_settings po całej historii migracji", () => {
    expect(zKolumn()).toEqual(METERING_DEFAULTS);
  });

  it("KONTROLA: odtworzenie historii widzi zmianę z 20260722231619", () => {
    // Bez tej kontroli parser ignorujący ALTER dawałby wynik z CREATE
    // (limit 3, wyłączone) - i test wyżej mówiłby „rozjazd", nie „parser".
    const zmiana = czytaj(`${KATALOG}/20260722231619_733b4e71-b378-492d-9edd-e2c8cbe05f35.sql`);
    expect(zmiana).toContain("ALTER COLUMN member_monthly_limit SET DEFAULT 5");
    expect(zKolumn().member_monthly_limit).toBe(5);
  });
});
