/**
 * Bramka inwariantu: KAŻDE RPC WOŁANE PRZEZ KLIENTA ISTNIEJE I CELUJE
 * W ISTNIEJĄCĄ RELACJĘ.
 *
 * Cienki runner - cała logika (dwa sprawdzenia, zbiór relacji wycofanych,
 * raport) żyje w `src/lib/ci/rpcContract.ts`, więc inwariant ma test jednostkowy
 * (`src/lib/ci/__tests__/rpcContract.test.ts`), a nie tylko przebieg w CI.
 *
 * Po co: ciała funkcji plpgsql/sql NIE są walidowane przy `CREATE FUNCTION`,
 * a `supabase db push` nigdy nie odtwarza bazy od zera - funkcja mówiąca
 * o tabeli po `RENAME` działa na produkcji i rzuca 42P01 na każdej świeżej
 * bazie (CI e2e, staging, nowe środowisko). Tak przez dwa tygodnie żyła
 * generacja „inmail" systemu „Zapytanie do eksperta".
 *
 * Usage: bun run check:rpc-contract
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  analyzeRpcContract,
  renderRpcContractReport,
  rpcContractFailed,
  type ClientSource,
  type RpcDefinition,
} from "../src/lib/ci/rpcContract";
import type { MigrationFile } from "../src/lib/ci/dbContract";
import {
  MIGRATIONS_DIR,
  extractLatestDefinitions,
  stripSqlComments,
  stripTsComments,
} from "./lib/sqlMigrations";

/** Katalogi ze źródłami, które mogą wołać `supabase.rpc(...)`. */
const CLIENT_ROOTS = ["src", "scripts", "e2e"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "coverage",
  "__snapshots__",
  // Testy cytują nazwy RPC w atrapach i fixture'ach (także celowo nieistniejące,
  // żeby dowieść, że bramka je łapie) - skan po nich zapalałby bramkę na jej
  // WŁASNEJ dokumentacji. Ten sam wzorzec, co stripSqlComments w bramkach SQL.
  "__tests__",
]);
const CLIENT_EXT = /\.(?:ts|tsx)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx)$/;

/**
 * RPC dostarczane poza katalogiem migracji. Wartość to uzasadnienie widoczne
 * w logu - wpis wolno dodać tylko dla funkcji, której naprawdę nie tworzy
 * żadna migracja (rozszerzenie platformy, inny schemat).
 */
const EXTERNAL_RPCS: Readonly<Record<string, string>> = {};

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function loadMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
    }));
}

function loadClients(): ClientSource[] {
  return CLIENT_ROOTS.filter((root) => existsSync(root))
    .flatMap((root) => walk(root, []))
    .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
    .filter((file) => CLIENT_EXT.test(file) && !TEST_FILE.test(file))
    .map((file) => ({ file, code: stripTsComments(readFileSync(file, "utf8")) }));
}

function loadDefinitions(): RpcDefinition[] {
  return [...extractLatestDefinitions().values()].map((def) => ({
    key: `${def.name}/${def.arity}`,
    name: def.name.replace(/^public\./, ""),
    file: def.file,
    body: def.body,
    attrs: def.attrs,
  }));
}

function main(): void {
  const report = analyzeRpcContract({
    migrations: loadMigrations(),
    definitions: loadDefinitions(),
    clients: loadClients(),
    externalRpcs: EXTERNAL_RPCS,
  });

  const rendered = renderRpcContractReport(report);
  if (rpcContractFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
