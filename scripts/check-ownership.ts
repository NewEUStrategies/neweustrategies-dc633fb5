/**
 * Bramka własnicielska: każda trasa administracyjna i każda migracja bazy ma
 * wskazanego właściciela technicznego, a dokumenty utrzymaniowe istnieją i nie
 * wygasły.
 *
 * Cienki runner - inwariant, uzasadnienie i cała logika żyją w
 * `src/lib/ci/ownership.ts` (konwencja jak `check-gate-coverage.ts`). Dzięki
 * temu bramka ma test jednostkowy (`src/lib/ci/__tests__/ownership.test.ts`),
 * a nie tylko przebieg w CI.
 *
 * Rejestr: `governance/ownership.json`. Instrukcja edycji: `governance/README.md`.
 *
 * Usage: bun run check:ownership
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  analyzeOwnership,
  ownershipFailed,
  parseRegistry,
  renderOwnershipReport,
  type MigrationSource,
} from "../src/lib/ci/ownership";

const REGISTRY_PATH = "governance/ownership.json";
const ROUTES_DIR = "src/routes";
const MIGRATIONS_DIR = "supabase/migrations";

/**
 * Trasy panelu to pliki `admin*.{ts,tsx}` w katalogu tras.
 *
 * Skan jest REKURENCYJNY, choć dziś wszystkie 193 trasy leżą płasko. Płaski
 * `readdirSync` czynił bramkę ślepą na `src/routes/admin/cokolwiek.tsx` -
 * a bramka, której cała wartość polega na kompletności, nie może mieć miejsca,
 * w którym trasa znika bez śladu.
 *
 * `.ts` LICZY SIĘ TAK SAMO JAK `.tsx`. Router bierze oba, a repo ma 55 tras
 * w czystym `.ts` (`sitemaps.$section.ts`, `llms[.]txt.ts`, `mcp.ts`, cały
 * `lovable/email/**`). Trasa panelu bez JSX-a - handler, przekierowanie,
 * eksport danych - jest naturalnie plikiem `.ts` i przy filtrze na samo `.tsx`
 * ZNIKAŁABY z bramki po cichu: zero wpisu w rejestrze, zielona bramka.
 * Dziś takiej trasy nie ma (jedyne `admin*.ts` to test w `__tests__/`),
 * więc ta zmiana niczego nie przenosi - zamyka drogę następnej.
 *
 * Pliki testowe odpadają po katalogu `__tests__` ORAZ po `.test.`/`.spec.`
 * w nazwie, bo test bywa położony obok trasy, nie w katalogu testów.
 */
function readRouteFiles(): string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
      // Ścieżka względem katalogu tras, zawsze z ukośnikiem - wzorce w rejestrze
      // dopasowują się do niej w całości.
      const routePath = relative(ROUTES_DIR, full).split(sep).join("/");
      if (routePath.startsWith("admin")) found.push(routePath);
    }
  };

  walk(ROUTES_DIR);
  return found.sort();
}

function readMigrations(): MigrationSource[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8") }));
}

/** Uszkodzony rejestr ma dać zdanie po polsku, a nie stos wywołań `JSON.parse`. */
function loadRegistry(): ReturnType<typeof parseRegistry> {
  let raw: string;
  try {
    raw = readFileSync(REGISTRY_PATH, "utf8");
  } catch {
    console.error(
      [
        `✗ [ownership] nie mogę odczytać ${REGISTRY_PATH}.`,
        "  Bramkę uruchamia się z KATALOGU GŁÓWNEGO repozytorium: bun run check:ownership",
      ].join("\n"),
    );
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(
      [
        `✗ [ownership] ${REGISTRY_PATH} nie jest poprawnym JSON-em.`,
        `  ${error instanceof Error ? error.message : String(error)}`,
        "  Instrukcja edycji rejestru: governance/README.md",
      ].join("\n"),
    );
    process.exit(1);
  }

  try {
    return parseRegistry(parsed);
  } catch (error) {
    console.error(
      [
        `✗ [ownership] ${REGISTRY_PATH} ma poprawny JSON, ale zły kształt.`,
        `  ${error instanceof Error ? error.message : String(error)}`,
        "  Opis każdego pola: governance/README.md §2",
      ].join("\n"),
    );
    process.exit(1);
  }
}

function main(): void {
  const registry = loadRegistry();

  // Dokumenty, których istnienia rejestr wymaga: umowa, runbook ciągłości oraz
  // sam rejestr z instrukcją edycji. Brak któregokolwiek to nie jest usterka
  // kosmetyczna - to powrót do stanu sprzed naprawy.
  const requiredDocuments = [
    registry.kontraktUtrzymaniowy.dokument,
    registry.kontraktUtrzymaniowy.runbookCiaglosci,
    "governance/README.md",
  ];
  const documentExists: Record<string, boolean> = {};
  for (const path of requiredDocuments) documentExists[path] = existsSync(path);

  const report = analyzeOwnership({
    registry,
    routeFiles: readRouteFiles(),
    migrations: readMigrations(),
    documentExists,
    today: new Date().toISOString().slice(0, 10),
  });

  const rendered = renderOwnershipReport(report);
  if (ownershipFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
