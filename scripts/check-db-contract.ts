/**
 * Bramka po-wdrożeniowa: czy WSZYSTKIE wymagane tabele, widoki i RPC istnieją
 * w bazie (Lovable Cloud / Supabase).
 *
 * Oczekiwany zbiór obiektów nie jest ręczną listą - wynika z forward-only
 * migracji w supabase/migrations (CREATE minus DROP/RENAME), więc kontrakt
 * aktualizuje się sam wraz z każdą nową migracją.
 *
 * Sondowanie idzie przez Data API (PostgREST), więc działa na kluczu
 * publikowalnym i nie potrzebuje połączenia bezpośrednio do Postgresa:
 *   - tabela/widok: GET /rest/v1/<name>?select=*&limit=0  → PGRST205 = brak
 *   - funkcja:      POST /rest/v1/rpc/<name>              → PGRST202 = brak
 * Brak uprawnień (401/403/42501) oznacza, że obiekt ISTNIEJE - RLS/GRANT-y
 * pilnują osobne bramki.
 *
 * Usage:
 *   bun run check:db-contract
 * Env: SUPABASE_URL (lub VITE_SUPABASE_URL) + SUPABASE_PUBLISHABLE_KEY
 *      (lub VITE_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  classifyProbe,
  contractFailed,
  extractExpectedContract,
  renderContractReport,
  type ContractReport,
  type DbObject,
} from "../src/lib/ci/dbContract";
import { MIGRATIONS_DIR, stripSqlComments } from "./lib/sqlMigrations";

const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
const key =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
  process.env["SUPABASE_PUBLISHABLE_KEY"] ||
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

const CONCURRENCY = 8;

function loadMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")) }));
}

async function probe(object: DbObject): Promise<"present" | "missing" | "inconclusive"> {
  const headers: Record<string, string> = {
    apikey: key as string,
    Authorization: `Bearer ${key as string}`,
    "Content-Type": "application/json",
  };
  const target =
    object.kind === "function"
      ? `${url}/rest/v1/rpc/${object.name}`
      : `${url}/rest/v1/${object.name}?select=*&limit=0`;

  try {
    const res = await fetch(target, {
      method: object.kind === "function" ? "POST" : "GET",
      headers,
      ...(object.kind === "function" ? { body: "{}" } : {}),
    });
    let code: string | null = null;
    let hint: string | null = null;
    if (!res.ok) {
      const text = await res.text();
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed !== null && typeof parsed === "object") {
          const body = parsed as { code?: unknown; hint?: unknown };
          code = typeof body.code === "string" ? body.code : null;
          hint = typeof body.hint === "string" ? body.hint : null;
        }
      } catch {
        code = null;
      }
    }
    return classifyProbe(res.status, code, hint);

  } catch {
    return "inconclusive";
  }
}

async function main(): Promise<void> {
  if (!url || !key) {
    console.error("✗ Brak SUPABASE_URL / klucza Supabase - nie mogę zweryfikować kontraktu bazy.");
    process.exit(1);
  }

  const contract = extractExpectedContract(loadMigrations());
  const all: DbObject[] = [...contract.tables, ...contract.views, ...contract.functions];

  const missing: DbObject[] = [];
  const inconclusive: DbObject[] = [];

  for (let i = 0; i < all.length; i += CONCURRENCY) {
    const batch = all.slice(i, i + CONCURRENCY);
    const verdicts = await Promise.all(batch.map(probe));
    verdicts.forEach((verdict, idx) => {
      if (verdict === "missing") missing.push(batch[idx]);
      else if (verdict === "inconclusive") inconclusive.push(batch[idx]);
    });
  }

  const report: ContractReport = { checked: all.length, missing, inconclusive };
  const markdown = renderContractReport(report);
  console.log(markdown);

  mkdirSync("reports", { recursive: true });
  writeFileSync(
    "reports/db-contract.json",
    `${JSON.stringify(
      {
        checked: report.checked,
        missing: report.missing.map((o) => ({ kind: o.kind, name: o.name, file: o.file })),
        inconclusive: report.inconclusive.map((o) => ({ kind: o.kind, name: o.name })),
      },
      null,
      2,
    )}\n`,
  );

  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) writeFileSync(summary, `${markdown}\n`, { flag: "a" });

  if (contractFailed(report)) {
    console.error(`✗ Brakuje ${report.missing.length} obiektów w bazie po wdrożeniu.`);
    process.exit(1);
  }
  console.log(`✓ Kontrakt bazy spełniony (${report.checked} obiektów).`);
}

void main();
