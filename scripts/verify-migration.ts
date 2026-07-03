/**
 * Read-only verification of the blocks/html → builder migration.
 *
 * The migration (scripts/migrate-blocks-to-builder.ts) flipped rows to
 * editor='builder' and wrote builder_data, but nobody had confirmed the result
 * against the live data. This script does exactly that, WITHOUT writing anything:
 * it reads every editor='builder' row, parses builder_data, and audits each
 * `text` widget body (the HTML→text migration target) for
 *   - un-processed [fn] footnote shortcodes,
 *   - footnote ref ↔ list-entry parity (dangling anchors / orphan notes),
 *   - inline style="" attributes (silently stripped by the widget sanitizer),
 *   - empty/blank builder documents.
 *
 * It NEVER mutates data (no service-role key needed; a publishable key is fine
 * and, under RLS, sees published rows). Exit code is non-zero when any row has
 * warnings, so it can gate CI / a post-deploy check.
 *
 * Usage (Bun auto-loads .env):
 *   bun run scripts/verify-migration.ts                 # all builder rows
 *   bun run scripts/verify-migration.ts --table=posts   # one table
 *   SUPABASE_SERVICE_ROLE_KEY=… bun run scripts/verify-migration.ts   # include drafts
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL) and a key
 *      (SUPABASE_SERVICE_ROLE_KEY to include drafts, else *_PUBLISHABLE_KEY).
 */
import { createClient } from "@supabase/supabase-js";
import type { BuilderDocument } from "../src/lib/builder/types";
import { auditBuilderDoc } from "../src/lib/builder/migrate/verifyMigration";

type Row = {
  id: string;
  slug: string | null;
  editor: string | null;
  builder_data: BuilderDocument | null;
};

const ALL_TABLES = ["posts", "pages"] as const;

const tableArg = process.argv.find((a) => a.startsWith("--table="))?.split("=")[1];
const TABLES = tableArg ? [tableArg] : ([...ALL_TABLES] as string[]);

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const key = serviceKey || anonKey;

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!url) fail("Missing SUPABASE_URL (or VITE_SUPABASE_URL).");
if (!key) fail("Missing a Supabase key (SUPABASE_SERVICE_ROLE_KEY or *_PUBLISHABLE_KEY).");
if (tableArg && !(ALL_TABLES as readonly string[]).includes(tableArg)) {
  fail(`--table must be one of: ${ALL_TABLES.join(", ")} (got '${tableArg}')`);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

interface TableReport {
  rows: number;
  emptyDocs: number;
  rowsWithWarnings: number;
  totalWarnings: number;
}

async function verifyTable(table: string): Promise<TableReport> {
  const { data, error } = await supabase
    .from(table)
    .select("id, slug, editor, builder_data")
    .eq("editor", "builder");
  if (error) fail(`Reading ${table}: ${error.message}`);

  const rows = (data ?? []) as Row[];
  console.log(`\n# ${table}: ${rows.length} builder row(s)`);

  let emptyDocs = 0;
  let rowsWithWarnings = 0;
  let totalWarnings = 0;

  for (const r of rows) {
    const ref = r.slug ?? r.id;
    const doc = r.builder_data;
    if (!doc || !Array.isArray(doc.sections) || doc.sections.length === 0) {
      emptyDocs++;
      console.log(`  ⚠ ${table}/${ref}: builder_data is empty/invalid (no sections)`);
      rowsWithWarnings++;
      totalWarnings++;
      continue;
    }
    const audit = auditBuilderDoc(doc);
    if (audit.warnings.length === 0) {
      console.log(`  ✓ ${table}/${ref}: ${audit.htmlBodies} text body(ies) OK`);
      continue;
    }
    rowsWithWarnings++;
    totalWarnings += audit.warnings.length;
    console.log(
      `  ⚠ ${table}/${ref}: ${audit.warnings.length} warning(s) across ${audit.htmlBodies} text body(ies)`,
    );
    for (const w of audit.warnings) console.log(`      - ${w}`);
  }

  return { rows: rows.length, emptyDocs, rowsWithWarnings, totalWarnings };
}

async function main(): Promise<void> {
  console.log(
    `migration verification (read-only) | tables: ${TABLES.join(", ")} | ` +
      `key: ${serviceKey ? "service-role (incl. drafts)" : "publishable (published rows only)"}`,
  );

  let totalRows = 0;
  let totalWarnings = 0;
  let rowsWithWarnings = 0;
  for (const table of TABLES) {
    const r = await verifyTable(table);
    totalRows += r.rows;
    totalWarnings += r.totalWarnings;
    rowsWithWarnings += r.rowsWithWarnings;
  }

  console.log(
    `\nSummary: ${totalRows} builder row(s) checked · ` +
      `${rowsWithWarnings} row(s) with warnings · ${totalWarnings} warning(s) total.`,
  );
  if (totalWarnings > 0) {
    console.log(
      "Review the warnings above. Revert a row if needed: UPDATE <table> SET editor='<blocks|richtext|markdown>' WHERE id='<id>';",
    );
    process.exit(2);
  }
  console.log("All migrated builder content passed verification. ✓");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
