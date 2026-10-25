/**
 * SQL tylko do odczytu dla wdrożenia migracji przez Lovable: co zrobi najbliższe
 * uruchomienie migratora Drizzle (`--pending`, przed wdrożeniem) i czy wpisy
 * zakresu są w rejestrze `drizzle.__drizzle_migrations` z hashem pliku
 * z repozytorium (`--verify`, po wdrożeniu; pusty wynik = OK). Wynik wykonuje
 * się w edytorze SQL albo narzędziem odczytu - procedura w
 * `docs/RUNBOOK_MIGRACJE_LOVABLE.md`.
 *
 * Cienki runner: argumenty, hashe, szablony i kody wyjścia żyją
 * w `src/lib/ci/migrationDeploySql.ts` (test:
 * `src/lib/ci/__tests__/migrationDeploySql.test.ts`). Bez sieci i bez bazy.
 * Typy wyłącznie `node` (`tsconfig.scripts.json`) - bez `Bun.*`.
 *
 * Usage: bun run migrations:deploy-sql -- (--pending|--verify) --from <idx> [--to <idx>]
 * Kod wyjścia: 0 - SQL na stdout; 1 - dziennik albo zakres nie dają zapytania
 * (zły zakres, brak pliku, zły tag); 2 - złe wywołanie.
 */
import { spawnSync } from "node:child_process";
import { readFileOrNull } from "../src/lib/ci/migrationLaneParity";
import { runDeploySqlCli } from "../src/lib/ci/migrationDeploySql";

/** Krótki SHA HEAD do nagłówka; poza repozytorium gita - `unknown`. */
function gitHead(): string {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

process.exit(
  runDeploySqlCli(process.argv.slice(2), {
    read: readFileOrNull,
    head: gitHead,
    out: (text) => console.log(text),
    err: (text) => console.error(text),
  }),
);
