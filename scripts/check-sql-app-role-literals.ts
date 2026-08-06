/**
 * Gate inwariantu: kazdy literal roli przekazany do public.has_role() MUSI byc
 * wartoscia enuma public.app_role.
 *
 * PRZYCZYNA ZRODLOWA (powtarzalna, patrz migracja 20260725090100). `has_role`
 * ma jeden podpis: has_role(uuid, public.app_role). Literal tekstowy trafia tam
 * jako `unknown` i jest rzutowany na enum. W cialach funkcji plpgsql instrukcje
 * NIE sa parsowane przy CREATE FUNCTION (check_function_bodies dotyczy tylko
 * funkcji SQL), wiec literal poza enumem NIE wywala migracji - wywala sie
 * dopiero w RUNTIME jako `22P02 invalid input value for enum app_role: "..."`.
 *
 * Jesli taki literal siedzi w trzeciej galezi `OR` bramki roli, to jest
 * osiagalny WYLACZNIE dla wolajacego bez wczesniejszych rol - a wiec nigdy w
 * testach dymnych na koncie administratora. Tak przez 9 wystapien przezyl
 * 'tenant_admin': admin/edytor konczyli na pierwszym `OR`, zwykly czlonek
 * dostawal 500 zamiast czystego 42501.
 *
 * INWARIANT: zbior literalow w has_role(...) ⊆ zbior wartosci app_role
 * odtworzony z migracji (CREATE TYPE ... AS ENUM + ALTER TYPE ... ADD VALUE).
 * Skanujemy takze pgTAP (supabase/tests) i TypeScript (src), bo ten sam literal
 * podany po stronie klienta konczy sie tym samym bledem enuma.
 *
 * Usage: bun run scripts/check-sql-app-role-literals.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MIGRATIONS_DIR,
  extractLatestDefinitions,
  stripSqlComments,
  stripTsComments,
} from "./lib/sqlMigrations";

/** Poza migracjami (tam liczy sie stan koncowy funkcji) skanujemy pgTAP i klienta. */
const SCAN_DIRS = ["supabase/tests", "src"] as const;
const SCAN_EXTENSIONS = [".sql", ".ts", ".tsx"] as const;

/**
 * Fixture'y testowe to NIE sciezki wywolan: plik testowy nigdy nie rozmawia z
 * baza, a bramki parsujace SQL musza miec w fixture'ach literal POZA enumem,
 * zeby dowiesc, ze go widza (`src/lib/ci/__tests__/authzGates.test.ts`).
 * Skanujemy wiec kod produkcyjny; realne wywolanie w `src/**` nadal jest
 * naruszeniem.
 */
function isTestFixture(file: string): boolean {
  return (
    file.includes("__tests__") ||
    file.includes(".test.") ||
    file.includes(".spec.") ||
    file.endsWith("/testUtils.ts")
  );
}

interface Hit {
  readonly literal: string;
  readonly file: string;
  /** Numer linii; 0 dla trafien w ciele funkcji (klucz w `where`). */
  readonly line: number;
  /** Doprecyzowanie miejsca - klucz funkcji dla migracji. */
  readonly where: string;
}

/** Wartosci enuma app_role odtworzone z forward-only migracji. */
function collectAppRoleValues(): Set<string> {
  const values = new Set<string>();
  const createRe = /CREATE\s+TYPE\s+(?:public\.)?"?app_role"?\s+AS\s+ENUM\s*\(([^)]*)\)/gi;
  const addValueRe =
    /ALTER\s+TYPE\s+(?:public\.)?"?app_role"?\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi;

  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

    createRe.lastIndex = 0;
    let created: RegExpExecArray | null;
    while ((created = createRe.exec(sql)) !== null) {
      for (const raw of created[1].split(",")) {
        const value = raw.trim().replace(/^'|'$/g, "");
        if (value !== "") values.add(value);
      }
    }

    addValueRe.lastIndex = 0;
    let added: RegExpExecArray | null;
    while ((added = addValueRe.exec(sql)) !== null) values.add(added[1]);
  }
  return values;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (SCAN_EXTENSIONS.some((ext) => full.endsWith(ext))) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * Literaly roli w wywolaniach has_role(...). Dopasowujemy pierwszy literal po
 * przecinku, z opcjonalnym jawnym rzutowaniem (`'admin'::app_role`), zeby
 * pokryc oba style obecne w repo.
 */
const CALL_RE = /has_role\s*\(\s*[^,()]*(?:\([^()]*\))?[^,()]*,\s*'([a-zA-Z0-9_]+)'/g;

function literalsIn(text: string): string[] {
  const out: string[] = [];
  CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CALL_RE.exec(text)) !== null) out.push(match[1]);
  return out;
}

function collectHasRoleLiterals(): Hit[] {
  const hits: Hit[] = [];

  // Migracje: tylko STAN KONCOWY kazdej funkcji. Historyczne definicje
  // nadpisane pozniejszym CREATE OR REPLACE nie opisuja juz zywej bazy, a
  // naglowki migracji naprawczych cytuja naprawiany literal.
  for (const def of extractLatestDefinitions().values()) {
    for (const literal of literalsIn(def.body)) {
      hits.push({ literal, file: def.file, line: 0, where: def.key });
    }
  }

  // Polityki RLS, GRANT-y, DEFAULT-y, widoki: wyrazenia POZA cialami funkcji
  // (te sprawdzilismy juz jako stan koncowy powyzej). Polityka jest wyrazeniem
  // wiecznie zywym - kazde jej wystapienie w migracjach liczy sie osobno.
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const path = join(MIGRATIONS_DIR, file);
    const outsideBodies = stripSqlComments(readFileSync(path, "utf8")).replace(
      /\$([A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/g,
      "",
    );
    for (const literal of literalsIn(outsideBodies)) {
      hits.push({ literal, file: path, line: 0, where: "policy/DDL" });
    }
  }

  for (const dir of SCAN_DIRS) {
    for (const file of listFiles(dir)) {
      if (isTestFixture(file)) continue;
      const raw = readFileSync(file, "utf8");
      if (!raw.includes("has_role")) continue;
      // Komentarze lecą w OBU jezykach - inaczej bramka czyta wlasne (i cudze)
      // naglowki dokumentacyjne jako wywolania.
      const text = file.endsWith(".sql") ? stripSqlComments(raw) : stripTsComments(raw);
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        for (const literal of literalsIn(lines[i])) {
          hits.push({ literal, file, line: i + 1, where: "" });
        }
      }
    }
  }
  return hits;
}

function main(): void {
  const allowed = collectAppRoleValues();
  if (allowed.size === 0) {
    console.error("✗ Nie udalo sie odtworzyc wartosci enuma app_role z migracji.");
    process.exit(1);
  }

  const hits = collectHasRoleLiterals();
  const violations = hits.filter((h) => !allowed.has(h.literal));

  if (violations.length > 0) {
    const byLiteral = new Map<string, Hit[]>();
    for (const v of violations) {
      byLiteral.set(v.literal, [...(byLiteral.get(v.literal) ?? []), v]);
    }
    console.error(
      `\n✗ Literal roli poza enumem app_role w ${violations.length} miejscu/miejscach:\n`,
    );
    for (const [literal, list] of [...byLiteral].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.error(`  • '${literal}' (${list.length}x)`);
      for (const h of list) {
        const suffix = h.line > 0 ? `:${h.line}` : h.where !== "" ? ` (${h.where})` : "";
        console.error(`      ${h.file}${suffix}`);
      }
    }
    console.error(
      `\n  Dozwolone wartosci: ${[...allowed].sort().join(" | ")}` +
        "\n  has_role(uuid, app_role) rzutuje literal w RUNTIME - wartosc poza enumem" +
        "\n  podnosi 22P02 (500) zamiast czystej odmowy 42501, i tylko dla wolajacych," +
        "\n  ktorzy nie przeszli wczesniejszych galezi OR (defekt utajony).",
    );
    process.exit(1);
  }

  console.log(
    `✓ Inwariant app_role OK (${hits.length} literalow has_role zbadanych, ` +
      `enum: ${[...allowed].sort().join(" | ")}).`,
  );
}

main();
