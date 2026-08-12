// K3b: rejestr zgód RODO na osi czasu leada. Zapytanie pytało o kolumny
// `granted`/`version`/`text_excerpt`, których w `crm_consent_log` nie ma - a
// ponieważ `fetchAll` połyka błąd, cała historia zgód znikała bez śladu.
// Test wiąże listę kolumn z DEFINICJĄ TABELI w migracji, więc kolejna literówka
// jest czerwona w CI, a nie cicha w produkcji.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONSENT_LOG_TIMELINE_COLUMNS,
  CONSENT_LOG_TIMELINE_SELECT,
  CONSENT_TEXT_EXCERPT_LEN,
  consentExcerpt,
} from "../consentLog";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const MIGRATION = "supabase/migrations/20260630053403_8783ac8b-8092-4a26-975b-be3447edc0c6.sql";

function consentLogColumns(): string[] {
  const sql = read(MIGRATION);
  const start = sql.indexOf("CREATE TABLE public.crm_consent_log (");
  expect(start).toBeGreaterThan(-1);
  const body = sql.slice(
    start + "CREATE TABLE public.crm_consent_log (".length,
    sql.indexOf("\n);", start),
  );
  return body
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((name) => /^[a-z_]+$/.test(name));
}

describe("kontrakt kolumn crm_consent_log", () => {
  const columns = consentLogColumns();

  it("migracja definiuje given/consent_version/consent_text (a nie granted/version/text_excerpt)", () => {
    expect(columns).toContain("given");
    expect(columns).toContain("consent_version");
    expect(columns).toContain("consent_text");
    expect(columns).not.toContain("granted");
    expect(columns).not.toContain("version");
    expect(columns).not.toContain("text_excerpt");
  });

  it("każda kolumna z selecta osi czasu istnieje w tabeli", () => {
    for (const col of CONSENT_LOG_TIMELINE_COLUMNS) expect(columns).toContain(col);
    expect(CONSENT_LOG_TIMELINE_SELECT).toBe(
      "id, consent_key, given, consent_version, consent_text, form_name, created_at",
    );
  });

  it("oś czasu i drawer nie odwołują się już do nieistniejących kolumn", () => {
    for (const path of [
      "src/lib/crm.functions.ts",
      "src/routes/admin.crm.index.tsx",
      "src/routes/admin.crm.$id.tsx",
    ]) {
      const src = read(path);
      expect(src).not.toContain("text_excerpt");
      expect(src).not.toMatch(/\bc\.granted\b/);
      expect(src).not.toMatch(/\bc\.version\b/);
    }
    expect(read("src/lib/crm.functions.ts")).toContain("CONSENT_LOG_TIMELINE_SELECT");
  });
});

describe("consentExcerpt", () => {
  it("przepuszcza krótką treść i null", () => {
    expect(consentExcerpt(null)).toBeNull();
    expect(consentExcerpt("Zgoda RODO")).toBe("Zgoda RODO");
  });

  it("skraca długą treść zgody do limitu osi czasu", () => {
    const long = "x".repeat(CONSENT_TEXT_EXCERPT_LEN + 40);
    expect(consentExcerpt(long)).toHaveLength(CONSENT_TEXT_EXCERPT_LEN);
  });
});
