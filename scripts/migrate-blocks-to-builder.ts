/**
 * Data migration: convert legacy "blocks" content (posts + pages) into the
 * builder editor, wrapping each localized blocks document in a full-width
 * `rich-text` widget. This converges existing content onto the builder as the
 * single page-composition engine.
 *
 * Safety properties:
 *   - DRY-RUN by default. Pass `--apply` to write.
 *   - `--apply` REQUIRES a service-role key (SUPABASE_SERVICE_ROLE_KEY) - the
 *     anon/publishable key cannot (and must not) write content.
 *   - Non-destructive & reversible: the original `blocks_data` column is left
 *     untouched; the migration only sets `builder_data` and flips `editor` to
 *     "builder". To revert a row: `UPDATE <table> SET editor='blocks' WHERE id=…`.
 *   - Idempotent: only rows with `editor = 'blocks'` are considered.
 *
 * Usage (Bun auto-loads .env):
 *   bun run scripts/migrate-blocks-to-builder.ts            # dry-run
 *   SUPABASE_SERVICE_ROLE_KEY=… bun run scripts/migrate-blocks-to-builder.ts --apply
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL), and a key
 *      (SUPABASE_SERVICE_ROLE_KEY for --apply, else SUPABASE_PUBLISHABLE_KEY /
 *      VITE_SUPABASE_PUBLISHABLE_KEY for a read-only dry-run).
 */
import { createClient } from "@supabase/supabase-js";
import type { LocalizedBlocks } from "../src/lib/blocks/types";
import { localizedBlocksToBuilderDoc, hasBlocksContent } from "../src/lib/builder/migrate/blocksToBuilder";

type Row = {
  id: string;
  slug: string | null;
  editor: string | null;
  blocks_data: LocalizedBlocks | null;
};

const TABLES = ["posts", "pages"] as const;

const apply = process.argv.includes("--apply");
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
if (apply && !serviceKey) {
  fail("--apply requires SUPABASE_SERVICE_ROLE_KEY (the anon/publishable key cannot write content).");
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

function blockCount(doc: LocalizedBlocks | null, lang: "pl" | "en"): number {
  const b = doc?.[lang]?.blocks;
  return Array.isArray(b) ? b.length : 0;
}

async function migrateTable(table: string): Promise<{ candidates: number; migrated: number; skippedEmpty: number }> {
  const { data, error } = await supabase
    .from(table)
    .select("id, slug, editor, blocks_data")
    .eq("editor", "blocks");
  if (error) fail(`Reading ${table}: ${error.message}`);

  const rows = (data ?? []) as Row[];
  const candidates = rows.filter((r) => hasBlocksContent(r.blocks_data));
  const skippedEmpty = rows.length - candidates.length;

  console.log(`\n# ${table}: ${rows.length} with editor='blocks' (${candidates.length} with content, ${skippedEmpty} empty/skipped)`);

  let migrated = 0;
  for (const r of candidates) {
    const pl = blockCount(r.blocks_data, "pl");
    const en = blockCount(r.blocks_data, "en");
    const tag = apply ? "APPLY" : "DRY-RUN";
    console.log(`  [${tag}] ${table}/${r.slug ?? r.id}  (pl:${pl} en:${en} blocks)`);
    if (apply) {
      const builder = localizedBlocksToBuilderDoc(r.blocks_data as LocalizedBlocks);
      const { error: upErr } = await supabase
        .from(table)
        .update({ builder_data: builder, editor: "builder" })
        .eq("id", r.id)
        .eq("editor", "blocks"); // guard: don't clobber rows changed concurrently
      if (upErr) {
        console.error(`    ✗ update failed: ${upErr.message}`);
        continue;
      }
      migrated++;
    }
  }
  return { candidates: candidates.length, migrated, skippedEmpty };
}

async function main(): Promise<void> {
  console.log(
    `blocks → builder migration | mode: ${apply ? "APPLY (writing)" : "DRY-RUN (no writes)"} | ` +
      `key: ${serviceKey ? "service-role" : "publishable (read-only / published rows only)"}`,
  );
  if (!serviceKey) {
    console.log(
      "Note: with a publishable key, RLS limits visibility to published rows; run with " +
        "SUPABASE_SERVICE_ROLE_KEY to include drafts.",
    );
  }

  let totalCandidates = 0;
  let totalMigrated = 0;
  for (const table of TABLES) {
    const r = await migrateTable(table);
    totalCandidates += r.candidates;
    totalMigrated += r.migrated;
  }

  console.log(`\nSummary: ${totalCandidates} row(s) with block content.`);
  if (apply) {
    console.log(`Migrated ${totalMigrated} row(s) to editor='builder'.`);
    console.log("Revert a row with:  UPDATE <table> SET editor='blocks' WHERE id='<id>';  (blocks_data was preserved)");
  } else {
    console.log("Dry-run only - no changes written. Re-run with --apply and a service-role key to migrate.");
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
