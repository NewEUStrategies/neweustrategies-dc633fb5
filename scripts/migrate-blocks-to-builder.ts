/**
 * Data migration: convert legacy content (posts + pages) into the builder
 * editor, so the builder becomes the single page-composition engine.
 *   - "blocks"  content → a full-width `rich-text` widget (embeds the blocks doc)
 *   - "richtext"/"markdown" HTML content → a full-width `text` widget, with
 *     footnotes ([fn]) and the manual <!--TOC--> marker pre-processed exactly
 *     like the public HTML render path (no rendering regression).
 *
 * Safety properties:
 *   - DRY-RUN by default. Pass `--apply` to write.
 *   - `--apply` REQUIRES a service-role key (SUPABASE_SERVICE_ROLE_KEY) - the
 *     anon/publishable key cannot (and must not) write content.
 *   - Non-destructive & reversible: the original `blocks_data` / `content_*`
 *     columns are left untouched; the migration only sets `builder_data` and
 *     flips `editor` to "builder". Revert a row: `UPDATE <table> SET
 *     editor='<blocks|richtext|markdown>' WHERE id=…`.
 *   - Idempotent: only rows whose editor is in {blocks, richtext, markdown} are
 *     considered.
 *
 * Optional flag: --only=blocks | --only=html  (default: both).
 *
 * Usage (Bun auto-loads .env):
 *   bun run scripts/migrate-blocks-to-builder.ts            # dry-run (all)
 *   SUPABASE_SERVICE_ROLE_KEY=… bun run scripts/migrate-blocks-to-builder.ts --apply
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL), and a key
 *      (SUPABASE_SERVICE_ROLE_KEY for --apply, else SUPABASE_PUBLISHABLE_KEY /
 *      VITE_SUPABASE_PUBLISHABLE_KEY for a read-only dry-run).
 */
import { createClient } from "@supabase/supabase-js";
import type { LocalizedBlocks } from "../src/lib/blocks/types";
import type { BuilderDocument } from "../src/lib/builder/types";
import {
  localizedBlocksToBuilderDoc,
  hasBlocksContent,
} from "../src/lib/builder/migrate/blocksToBuilder";
import { htmlToBuilderDoc, hasHtmlContent } from "../src/lib/builder/migrate/htmlToBuilder";

type Row = {
  id: string;
  slug: string | null;
  editor: string | null;
  blocks_data: LocalizedBlocks | null;
  content_pl: string | null;
  content_en: string | null;
};

const TABLES = ["posts", "pages"] as const;
const HTML_EDITORS = ["richtext", "markdown"] as const;

const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const doBlocks = !onlyArg || onlyArg === "blocks";
const doHtml = !onlyArg || onlyArg === "html";
const SOURCE_EDITORS = [
  ...(doBlocks ? (["blocks"] as const) : []),
  ...(doHtml ? HTML_EDITORS : []),
];

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
  fail(
    "--apply requires SUPABASE_SERVICE_ROLE_KEY (the anon/publishable key cannot write content).",
  );
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

function blockCount(doc: LocalizedBlocks | null, lang: "pl" | "en"): number {
  const b = doc?.[lang]?.blocks;
  return Array.isArray(b) ? b.length : 0;
}

/** Build the builder doc + a human description for a row, or null to skip. */
function planRow(r: Row): { builder: BuilderDocument; desc: string } | null {
  if (r.editor === "blocks") {
    if (!hasBlocksContent(r.blocks_data)) return null;
    return {
      builder: localizedBlocksToBuilderDoc(r.blocks_data as LocalizedBlocks),
      desc: `blocks pl:${blockCount(r.blocks_data, "pl")} en:${blockCount(r.blocks_data, "en")}`,
    };
  }
  if ((HTML_EDITORS as readonly string[]).includes(r.editor ?? "")) {
    if (!hasHtmlContent(r.content_pl, r.content_en)) return null;
    return {
      builder: htmlToBuilderDoc(r.content_pl, r.content_en),
      desc: `${r.editor} html pl:${(r.content_pl ?? "").length} en:${(r.content_en ?? "").length} chars`,
    };
  }
  return null;
}

async function migrateTable(
  table: string,
): Promise<{ candidates: number; migrated: number; skippedEmpty: number }> {
  // `pages` has no `blocks_data` column - only posts carry legacy block payloads.
  const cols =
    table === "posts"
      ? "id, slug, editor, blocks_data, content_pl, content_en"
      : "id, slug, editor, content_pl, content_en";
  const { data, error } = await supabase
    .from(table)
    .select(cols)
    .in("editor", SOURCE_EDITORS as unknown as string[]);
  if (error) fail(`Reading ${table}: ${error.message}`);

  const rows = (data ?? []) as Row[];
  const plans = rows.map((r) => ({ r, plan: planRow(r) }));
  const candidates = plans.filter((p) => p.plan !== null);
  const skippedEmpty = rows.length - candidates.length;

  console.log(
    `\n# ${table}: ${rows.length} migratable-editor row(s) (${candidates.length} with content, ${skippedEmpty} empty/skipped)`,
  );

  let migrated = 0;
  for (const { r, plan } of candidates) {
    const tag = apply ? "APPLY" : "DRY-RUN";
    console.log(`  [${tag}] ${table}/${r.slug ?? r.id}  (${plan!.desc})`);
    if (apply) {
      const { error: upErr } = await supabase
        .from(table)
        .update({ builder_data: plan!.builder, editor: "builder" })
        .eq("id", r.id)
        .eq("editor", r.editor as string); // guard: don't clobber rows changed concurrently
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
  if (onlyArg && onlyArg !== "blocks" && onlyArg !== "html") {
    fail(`--only must be 'blocks' or 'html' (got '${onlyArg}')`);
  }
  console.log(
    `content → builder migration | editors: ${SOURCE_EDITORS.join(", ")} | ` +
      `mode: ${apply ? "APPLY (writing)" : "DRY-RUN (no writes)"} | ` +
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

  console.log(`\nSummary: ${totalCandidates} row(s) with migratable content.`);
  if (apply) {
    console.log(`Migrated ${totalMigrated} row(s) to editor='builder'.`);
    console.log(
      "Revert a row with:  UPDATE <table> SET editor='<blocks|richtext|markdown>' WHERE id='<id>';  " +
        "(original blocks_data / content_* were preserved)",
    );
  } else {
    console.log(
      "Dry-run only - no changes written. Re-run with --apply and a service-role key to migrate.",
    );
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
