// KONTRAKT: każde `source_type`, które kod zapisuje do `crm_leads`, musi być
// w zbiorze dopuszczonym przez CHECK w bazie.
//
// DLACZEGO TA BRAMKA ISTNIEJE. Repo już raz to przerabiało: `source_type =
// 'club_application'` łamiące `crm_leads_source_type_check` weszło na produkcję
// przy ZIELONYM CI (migracja 20260811150000 opisuje naprawę). Zapisy są w kodzie
// aplikacji, a zbiór dozwolonych wartości - w migracji; nic ich ze sobą nie
// wiązało. Ten test wiąże: czyta OSTATNIĄ definicję CHECK z migracji i porównuje
// ją z literałami w źródłach.
//
// Zapisy do `crm_leads` idą przez klienta serwisowego i najczęściej mają
// przechwycony błąd (`catch` + log), więc naruszenie CHECK nie wywraca żądania -
// po prostu CICHO NIE POWSTAJE lead. Dokładnie tak zgubił się lead klienta
// płacącego (source_type „import" - patrz naprawa w tym samym commicie).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = "supabase/migrations";
const SRC_DIR = "src";

/** Ostatnia (czyli obowiązująca) definicja CHECK-a na `crm_leads.source_type`. */
function allowedSourceTypes(): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let allowed: string[] = [];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const matches = sql.matchAll(
      /ADD CONSTRAINT crm_leads_source_type_check\s+CHECK \(source_type IN \(([^)]*)\)\)/g,
    );
    for (const m of matches) {
      allowed = m[1]
        .split(",")
        .map((s) => s.trim().replace(/^'|'$/g, ""))
        .filter(Boolean);
    }
  }
  return allowed;
}

interface SourceTypeUse {
  file: string;
  line: number;
  value: string;
}

function scanSources(dir: string, out: SourceTypeUse[] = []): SourceTypeUse[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      scanSources(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    // Wygenerowane typy opisują schemat, nie zapisują do niego.
    if (full.includes("integrations/supabase/types.ts")) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) continue;

    const lines = readFileSync(full, "utf8").split("\n");
    lines.forEach((text, index) => {
      // `source_type: "x"` (insert/update) oraz `.eq("source_type", "x")`.
      for (const m of text.matchAll(/source_type:\s*"([^"]+)"/g)) {
        out.push({ file: full, line: index + 1, value: m[1] });
      }
      for (const m of text.matchAll(/"source_type",\s*"([^"]+)"/g)) {
        out.push({ file: full, line: index + 1, value: m[1] });
      }
      // `.in("source_type", ["a", "b"])`
      for (const m of text.matchAll(/"source_type",\s*\[([^\]]*)\]/g)) {
        for (const raw of m[1].split(",")) {
          const value = raw.trim().replace(/^"|"$/g, "");
          if (value) out.push({ file: full, line: index + 1, value });
        }
      }
    });
  }
  return out;
}

describe("kontrakt source_type z bazą", () => {
  const allowed = allowedSourceTypes();

  it("CHECK w migracjach jest odnaleziony i niepusty", () => {
    expect(allowed.length).toBeGreaterThan(5);
    expect(allowed).toContain("manual");
    expect(allowed).toContain("careers");
  });

  it("każdy literał source_type w kodzie mieści się w CHECK-u bazy", () => {
    const uses = scanSources(SRC_DIR);
    // Bezpiecznik samego skanera: gdyby regexy przestały cokolwiek znajdować,
    // test byłby zielony bez sprawdzania czegokolwiek.
    expect(uses.length).toBeGreaterThan(3);
    const violations = uses.filter((u) => !allowed.includes(u.value));
    expect(
      violations.map((v) => `${v.file}:${v.line} -> "${v.value}"`),
      `dozwolone: ${allowed.join(", ")}`,
    ).toEqual([]);
  });
});
