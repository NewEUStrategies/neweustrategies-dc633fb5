/**
 * One-off operational script: migrate legacy CV files from the public `media`
 * bucket to the private `cv` bucket, and rewrite `profile_cv_files.file_url`
 * to store the new storage path (contract: `<tenant_id>/users/<user_id>/...`).
 *
 * Why this exists:
 *   - Before the T1 hardening (Vault + private cv bucket) CV files were
 *     uploaded to the PUBLIC `media` bucket and `file_url` stored either a
 *     full public URL or a `media/...` path.
 *   - After the fix new uploads land in the PRIVATE `cv` bucket and
 *     `file_url` stores ONLY the storage path.
 *   - Migration cannot happen in SQL (bytes must be copied between buckets)
 *     and cannot happen from the Lovable sandbox (no prod storage access +
 *     service role key is not exposed here). Run this locally / from CI with
 *     env vars set from the Supabase dashboard.
 *
 * Prereqs (env):
 *   SUPABASE_URL=...              # https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=... # service role - bypasses RLS + storage RLS
 *
 * Dry run (default):
 *   bun run scripts/migrate-cv-to-private.ts
 *
 * Apply:
 *   APPLY=1 bun run scripts/migrate-cv-to-private.ts
 *
 * Options:
 *   DELETE_SOURCE=1  -> remove the source object from `media` after a verified
 *                      copy + DB update. Off by default so you can roll back.
 *   BATCH=50         -> rows per page (default 100).
 *   LIMIT=0          -> hard cap on processed rows (0 = no cap).
 *
 * Idempotent: rows whose `file_url` already points at the private `cv`
 * bucket are skipped. Safe to re-run.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}

const APPLY = process.env.APPLY === "1";
const DELETE_SOURCE = process.env.DELETE_SOURCE === "1";
const BATCH = Number(process.env.BATCH ?? 100);
const LIMIT = Number(process.env.LIMIT ?? 0);

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface Stats {
  scanned: number;
  alreadyPrivate: number;
  migrated: number;
  missingSource: number;
  failed: number;
  deletedSource: number;
}

const stats: Stats = {
  scanned: 0,
  alreadyPrivate: 0,
  migrated: 0,
  missingSource: 0,
  failed: 0,
  deletedSource: 0,
};

/**
 * Decompose a legacy `file_url` into (bucket, objectPath).
 * Accepts:
 *   - full public URL: `${SUPABASE_URL}/storage/v1/object/public/<bucket>/<path>`
 *   - `<bucket>/<path>`
 *   - bare `<path>` (assumed `media`, legacy default)
 */
function parseLegacyUrl(fileUrl: string): { bucket: string; path: string } | null {
  if (!fileUrl) return null;
  const publicPrefix = `${SUPABASE_URL}/storage/v1/object/public/`;
  if (fileUrl.startsWith(publicPrefix)) {
    const rest = fileUrl.slice(publicPrefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) return null;
    return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) };
  }
  const signedMatch = fileUrl.match(/\/storage\/v1\/object\/sign\/([^/]+)\/(.+?)(?:\?|$)/);
  if (signedMatch) return { bucket: signedMatch[1], path: signedMatch[2] };
  const parts = fileUrl.split("/");
  if (parts.length > 1 && !fileUrl.startsWith("http")) {
    // Heuristic: rows written by the OLD client used `media/<tenant>/...`.
    if (parts[0] === "media" || parts[0] === "cv") {
      return { bucket: parts[0], path: parts.slice(1).join("/") };
    }
    // If it's already the new contract (`<tenant>/users/...`) it must live in `cv`.
    return { bucket: "cv", path: fileUrl };
  }
  return null;
}

function extFromName(name: string, mime: string): string {
  const fromName = name.includes(".") ? name.split(".").pop()! : "";
  if (fromName) return fromName;
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/msword") return "doc";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return "docx";
  return "bin";
}

async function processRow(row: {
  id: string;
  user_id: string;
  tenant_id: string | null;
  file_url: string;
  file_name: string;
  mime_type: string | null;
  uploaded_at: string;
}): Promise<void> {
  stats.scanned += 1;
  const parsed = parseLegacyUrl(row.file_url);
  if (!parsed) {
    stats.failed += 1;
    console.warn(`[skip] ${row.id}: unparseable file_url=${row.file_url}`);
    return;
  }

  if (parsed.bucket === "cv") {
    stats.alreadyPrivate += 1;
    return;
  }

  if (!row.tenant_id) {
    stats.failed += 1;
    console.warn(`[skip] ${row.id}: row has no tenant_id`);
    return;
  }

  const ext = extFromName(row.file_name, row.mime_type ?? "");
  const uploadedTs = new Date(row.uploaded_at).getTime() || Date.now();
  const targetPath = `${row.tenant_id}/users/${row.user_id}/cv-${uploadedTs}-${row.id.slice(0, 8)}.${ext}`;

  console.log(
    `[${APPLY ? "apply" : "dry"}] ${row.id}: ${parsed.bucket}/${parsed.path} -> cv/${targetPath}`,
  );
  if (!APPLY) return;

  const { data: blob, error: dlErr } = await admin.storage.from(parsed.bucket).download(parsed.path);
  if (dlErr || !blob) {
    stats.missingSource += 1;
    console.warn(`  ! source missing: ${dlErr?.message ?? "no body"}`);
    return;
  }

  const { error: upErr } = await admin.storage
    .from("cv")
    .upload(targetPath, blob, {
      contentType: row.mime_type ?? "application/octet-stream",
      upsert: false,
    });
  if (upErr && !/already exists/i.test(upErr.message)) {
    stats.failed += 1;
    console.error(`  ! upload failed: ${upErr.message}`);
    return;
  }

  const { error: updErr } = await admin
    .from("profile_cv_files")
    .update({ file_url: targetPath })
    .eq("id", row.id);
  if (updErr) {
    stats.failed += 1;
    console.error(`  ! db update failed: ${updErr.message}`);
    // Try to clean up the just-uploaded blob so we don't leak orphans.
    await admin.storage.from("cv").remove([targetPath]);
    return;
  }

  stats.migrated += 1;

  if (DELETE_SOURCE) {
    const { error: rmErr } = await admin.storage.from(parsed.bucket).remove([parsed.path]);
    if (rmErr) {
      console.warn(`  ~ could not delete source: ${rmErr.message}`);
    } else {
      stats.deletedSource += 1;
    }
  }
}

async function main(): Promise<void> {
  console.log(
    `CV migration | mode=${APPLY ? "APPLY" : "DRY-RUN"} deleteSource=${DELETE_SOURCE} batch=${BATCH} limit=${LIMIT || "∞"}`,
  );

  let from = 0;
  for (;;) {
    const to = from + BATCH - 1;
    const { data, error } = await admin
      .from("profile_cv_files")
      .select("id,user_id,tenant_id,file_url,file_name,mime_type,uploaded_at")
      .order("uploaded_at", { ascending: true })
      .range(from, to);
    if (error) {
      console.error("query failed:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      await processRow(row);
      if (LIMIT && stats.scanned >= LIMIT) break;
    }
    if (LIMIT && stats.scanned >= LIMIT) break;
    if (data.length < BATCH) break;
    from += BATCH;
  }

  console.log("\n=== summary ===");
  console.table(stats);
  if (!APPLY) {
    console.log("Dry run — re-run with APPLY=1 to write changes.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
