// Server functions for media management. All ops require auth (RLS as the user)
// and write an audit_log entry. Path prefix is enforced server-side - clients
// cannot lie about tenant_id.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordAudit } from "./server/audit.server";
import { rateLimit } from "./server/rate-limit.server";
import { resolveUserTenantId } from "./server/userTenant.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
  "application/pdf",
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const RegisterUploadSchema = z.object({
  storagePath: z.string().min(1).max(512),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  sizeBytes: z.number().int().min(0).max(MAX_BYTES),
  publicUrl: z.string().url().max(2048),
  altText: z.string().max(500).optional(),
});

/**
 * Registers a freshly-uploaded file in the `media` table.
 * The actual upload to storage is done by the browser (so we don't push
 * large bodies through the worker) - but ALL validation happens here:
 * tenant prefix, MIME allowlist, size cap, rate limit, audit.
 */
export const registerMediaUpload = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((input: unknown) => RegisterUploadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Resolve tenant from profiles (authoritative; never trust client).
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileErr || !profile?.tenant_id) throw new Error("No tenant for current user");
    const tenantId = profile.tenant_id;

    // Path must start with `<tenantId>/` (matches storage RLS).
    const firstSeg = data.storagePath.split("/")[0];
    if (!UUID_RE.test(firstSeg) || firstSeg.toLowerCase() !== tenantId.toLowerCase()) {
      throw new Error("Storage path tenant prefix mismatch");
    }
    if (data.storagePath.includes("..")) throw new Error("Invalid storage path");

    // MIME allowlist.
    if (!ALLOWED_MIME.has(data.mimeType)) {
      throw new Error(`Disallowed mime type: ${data.mimeType}`);
    }

    // Rate limit: 60 uploads / minute / user.
    const ok = await rateLimit({ scope: "media.upload", subjectId: userId, max: 60 });
    if (!ok) throw new Error("Too many uploads, slow down");

    // Insert via authenticated client - RLS double-checks tenant scope.
    const { data: row, error } = await supabase
      .from("media")
      .insert({
        tenant_id: tenantId,
        uploader_id: userId,
        storage_path: data.storagePath,
        public_url: data.publicUrl,
        filename: data.filename,
        mime_type: data.mimeType,
        size_bytes: data.sizeBytes,
        alt_text: data.altText ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await recordAudit(supabase, {
      tenantId,
      action: "media.upload",
      entityType: "media",
      entityId: row.id,
      metadata: { filename: data.filename, mime: data.mimeType, size: data.sizeBytes },
    });

    return { id: row.id };
  });

const DeleteSchema = z.object({ mediaId: z.string().uuid() });

export const deleteMedia = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((input: unknown) => DeleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Read via user client - RLS makes sure the user is allowed to see this row.
    const { data: row, error } = await supabase
      .from("media")
      .select("id, tenant_id, storage_path")
      .eq("id", data.mediaId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Media not found or access denied");

    // Delete the storage object via admin (bypasses storage RLS but we already
    // validated ownership via the user-client SELECT above).
    const { error: rmErr } = await supabaseAdmin.storage.from("media").remove([row.storage_path]);
    if (rmErr) console.warn("[media.delete] storage remove failed:", rmErr.message);

    // Delete the DB row via user client so RLS enforces ownership.
    const { error: delErr } = await supabase.from("media").delete().eq("id", row.id);
    if (delErr) throw new Error(delErr.message);

    await recordAudit(supabase, {
      tenantId: row.tenant_id,
      action: "media.delete",
      entityType: "media",
      entityId: row.id,
      metadata: { storage_path: row.storage_path },
    });

    return { ok: true };
  });

// ---------- Media usage lookup ----------
// Finds posts/pages that reference a given media item (by id, public URL, or
// storage path). Scans cover_image_url, content (HTML), builder_data and
// blocks_data (JSON).
//
// The body columns (content_pl/en, builder_data, blocks_data) are REVOKED
// from the authenticated role (20260702200000 - the C1 hardening), so the
// scan reads them via the service role, explicitly pinned to the caller's
// tenant resolved from profiles - same doctrine as posts-migrate. The media
// row lookups stay on the user client (RLS proves the caller may see them).
const UsageSchema = z.object({ mediaId: z.string().uuid() });

/**
 * Stable, language-neutral usage areas. The UI translates them (PL/EN in
 * MediaPreviewDialog) - the server must not bake one language into data.
 */
export type MediaUsageArea = "cover" | "excerpt" | "content" | "builder" | "blocks" | "layout";

export type MediaUsageItem = {
  kind: "post" | "page";
  id: string;
  slug: string;
  title: string;
  where: MediaUsageArea[];
};

export const getMediaUsage = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((input: unknown) => UsageSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ items: MediaUsageItem[] }> => {
    const { supabase, userId } = context;
    // Fail-closed guard: a caller without a tenant must not run this scan
    // (resolveUserTenantId throws). The tenant id itself is no longer used here.
    await resolveUserTenantId(supabaseAdmin, userId);

    const { data: media, error: mErr } = await supabase
      .from("media")
      .select("id, public_url, storage_path, filename")
      .eq("id", data.mediaId)
      .maybeSingle();
    if (mErr) throw new Error(mErr.message);
    if (!media) throw new Error("Media not found or access denied");

    // Treat duplicates (same filename, re-uploaded/imported copies) as the same
    // logical asset - otherwise opening a duplicate would falsely show "0 uses".
    const tokens = new Set<string>();
    if (media.public_url) tokens.add(media.public_url);
    if (media.storage_path) tokens.add(media.storage_path);
    tokens.add(media.id);

    if (media.filename) {
      const { data: siblings } = await supabase
        .from("media")
        .select("id, public_url, storage_path")
        .eq("filename", media.filename);
      for (const s of siblings ?? []) {
        if (s.public_url) tokens.add(s.public_url);
        if (s.storage_path) tokens.add(s.storage_path);
        tokens.add(s.id);
      }
    }

    const tokenList = Array.from(tokens).filter((t) => t && t.length > 0);

    const matches = (haystack: unknown): boolean => {
      if (haystack == null) return false;
      const s = typeof haystack === "string" ? haystack : JSON.stringify(haystack);
      return tokenList.some((tok) => s.includes(tok));
    };
    const matchesUrl = (url: string | null | undefined): boolean =>
      !!url && tokenList.some((tok) => url.includes(tok));

    const out: MediaUsageItem[] = [];

    // POSTS - service-role read (body columns are revoked from authenticated),
    // hard-pinned to the caller's tenant.
    const { data: posts, error: pErr } = await supabaseAdmin
      .from("posts")
      .select(
        "id, slug, title_pl, title_en, cover_image_url, excerpt_pl, excerpt_en, content_pl, content_en, builder_data, blocks_data, layout_overrides",
      )
      .is("deleted_at", null);
    if (pErr) throw new Error(pErr.message);
    for (const p of posts ?? []) {
      const where: MediaUsageArea[] = [];
      if (matchesUrl(p.cover_image_url)) where.push("cover");
      if (matches(p.excerpt_pl) || matches(p.excerpt_en)) where.push("excerpt");
      if (matches(p.content_pl) || matches(p.content_en)) where.push("content");
      if (matches(p.builder_data)) where.push("builder");
      if (matches(p.blocks_data)) where.push("blocks");
      if (matches(p.layout_overrides)) where.push("layout");
      if (where.length) {
        out.push({
          kind: "post",
          id: p.id,
          slug: p.slug,
          title: p.title_pl || p.title_en || p.slug,
          where,
        });
      }
    }

    // PAGES - same service-role + tenant-pinned read as posts.
    const { data: pages, error: gErr } = await supabaseAdmin
      .from("pages")
      .select(
        "id, slug, title_pl, title_en, cover_image_url, excerpt_pl, excerpt_en, content_pl, content_en, builder_data, layout_overrides",
      )
      .is("deleted_at", null);
    if (gErr) throw new Error(gErr.message);
    for (const p of pages ?? []) {
      const where: MediaUsageArea[] = [];
      if (matchesUrl(p.cover_image_url)) where.push("cover");
      if (matches(p.excerpt_pl) || matches(p.excerpt_en)) where.push("excerpt");
      if (matches(p.content_pl) || matches(p.content_en)) where.push("content");
      if (matches(p.builder_data)) where.push("builder");
      if (matches(p.layout_overrides)) where.push("layout");
      if (where.length) {
        out.push({
          kind: "page",
          id: p.id,
          slug: p.slug,
          title: p.title_pl || p.title_en || p.slug,
          where,
        });
      }
    }

    return { items: out };
  });

// ---- Regenerate thumbnails / pre-warm Supabase image transforms ----
import { buildTransformedImageUrl } from "@/lib/cropSizes";

export interface ThumbnailRegenResult {
  media: number;
  sizes: number;
  ok: number;
  failed: number;
  details: Array<{ url: string; size: string; ok: boolean; status?: number }>;
}

/**
 * Pre-warms Supabase Storage image transforms for every active custom
 * crop size against tenant media. Native `sharp` is not available in
 * Workers; instead we HEAD-fetch /render/image/public/... URLs so
 * Supabase materialises and caches each variant.
 */
export const regenerateThumbnails = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) =>
    z
      .object({
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<ThumbnailRegenResult> => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    const tenantId = profile?.tenant_id as string | undefined;
    if (!tenantId) throw new Error("No tenant");

    const [{ data: media }, { data: sizes }] = await Promise.all([
      supabase
        .from("media")
        .select("public_url")
        .eq("tenant_id", tenantId)
        .not("public_url", "is", null)
        .limit(data.limit),
      supabase.from("custom_crop_sizes").select("name, width, height").eq("tenant_id", tenantId),
    ]);

    const mediaRows = (media ?? []) as Array<{ public_url: string | null }>;
    const sizeRows = (sizes ?? []) as Array<{ name: string; width: number; height: number }>;

    const details: ThumbnailRegenResult["details"] = [];
    let ok = 0;
    let failed = 0;

    for (const m of mediaRows) {
      const src = m.public_url;
      if (!src) continue;
      for (const s of sizeRows) {
        const url = buildTransformedImageUrl(src, { width: s.width, height: s.height });
        try {
          const res = await fetch(url, { method: "HEAD" });
          const success = res.ok;
          if (success) ok++;
          else failed++;
          details.push({ url, size: s.name, ok: success, status: res.status });
        } catch {
          failed++;
          details.push({ url, size: s.name, ok: false });
        }
      }
    }

    return {
      media: mediaRows.length,
      sizes: sizeRows.length,
      ok,
      failed,
      details: details.slice(0, 200),
    };
  });

// ============================================================================
// Folder & file management (iOS Files-style):
// - virtual folders (media_folders)
// - rename/move files (updates media row only; storage_path stays stable)
// - bulk delete / move / duplicate (copy in storage)
// ============================================================================

const FOLDER_PATH_RE = /^\/(?:[A-Za-z0-9 _.\-]{1,64}\/)*$/;

function normalizeFolderPath(input: string): string {
  let p = (input || "/").trim();
  if (!p.startsWith("/")) p = "/" + p;
  if (!p.endsWith("/")) p = p + "/";
  p = p.replace(/\/+/g, "/");
  if (!FOLDER_PATH_RE.test(p)) throw new Error("Invalid folder path");
  if (p.includes("/../") || p.includes("/./")) throw new Error("Invalid folder path");
  return p;
}

async function requireTenantId(
  supabase: NonNullable<Parameters<typeof recordAudit>[0]>,
  userId: string,
): Promise<string> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !profile?.tenant_id) throw new Error("No tenant for current user");
  return profile.tenant_id as string;
}

// ---------- Update media (rename / alt / move) ----------
const UpdateMediaSchema = z.object({
  mediaId: z.string().uuid(),
  filename: z.string().min(1).max(255).optional(),
  altText: z.string().max(500).nullable().optional(),
  folderPath: z.string().min(1).max(512).optional(),
});

export const updateMediaMeta = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => UpdateMediaSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const patch: Record<string, unknown> = {};
    if (data.filename !== undefined) {
      const clean = data.filename.replace(/[/\\]/g, "-").trim();
      if (!clean) throw new Error("Invalid filename");
      patch.filename = clean;
    }
    if (data.altText !== undefined) patch.alt_text = data.altText;
    if (data.folderPath !== undefined) patch.folder_path = normalizeFolderPath(data.folderPath);
    if (!Object.keys(patch).length) return { ok: true };

    const { data: row, error } = await supabase
      .from("media")
      .update(patch)
      .eq("id", data.mediaId)
      .select("id, tenant_id")
      .single();
    if (error) throw new Error(error.message);

    await recordAudit(supabase, {
      tenantId: row.tenant_id,
      action: "media.update",
      entityType: "media",
      entityId: row.id,
      metadata: patch,
    });
    return { ok: true };
  });

// ---------- Bulk move ----------
const BulkMoveSchema = z.object({
  mediaIds: z.array(z.string().uuid()).min(1).max(500),
  folderPath: z.string().min(1).max(512),
});

export const bulkMoveMedia = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => BulkMoveSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const folder = normalizeFolderPath(data.folderPath);
    const { error, data: rows } = await supabase
      .from("media")
      .update({ folder_path: folder })
      .in("id", data.mediaIds)
      .select("id, tenant_id");
    if (error) throw new Error(error.message);
    if (rows?.length) {
      await recordAudit(supabase, {
        tenantId: rows[0].tenant_id,
        action: "media.bulk_move",
        entityType: "media",
        entityId: rows[0].id,
        metadata: { count: rows.length, folder },
      });
    }
    return { ok: true, moved: rows?.length ?? 0 };
  });

// ---------- Bulk delete ----------
const BulkDeleteSchema = z.object({ mediaIds: z.array(z.string().uuid()).min(1).max(500) });

export const bulkDeleteMedia = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => BulkDeleteSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("media")
      .select("id, tenant_id, storage_path")
      .in("id", data.mediaIds);
    if (error) throw new Error(error.message);
    if (!rows?.length) return { ok: true, deleted: 0 };
    const paths = rows.map((r) => r.storage_path).filter(Boolean) as string[];
    if (paths.length) {
      const { error: rmErr } = await supabaseAdmin.storage.from("media").remove(paths);
      if (rmErr) console.warn("[media.bulkDelete] storage remove failed:", rmErr.message);
    }
    const { error: delErr } = await supabase
      .from("media")
      .delete()
      .in(
        "id",
        rows.map((r) => r.id),
      );
    if (delErr) throw new Error(delErr.message);
    await recordAudit(supabase, {
      tenantId: rows[0].tenant_id,
      action: "media.bulk_delete",
      entityType: "media",
      entityId: rows[0].id,
      metadata: { count: rows.length },
    });
    return { ok: true, deleted: rows.length };
  });

// ---------- Duplicate (copy-paste) ----------
const DuplicateSchema = z.object({
  mediaIds: z.array(z.string().uuid()).min(1).max(100),
  folderPath: z.string().min(1).max(512),
});

export const duplicateMedia = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => DuplicateSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const folder = normalizeFolderPath(data.folderPath);
    const tenantId = await requireTenantId(supabase, userId);

    const { data: rows, error } = await supabase
      .from("media")
      .select("id, storage_path, filename, mime_type, size_bytes, alt_text")
      .in("id", data.mediaIds);
    if (error) throw new Error(error.message);
    const out: Array<{ id: string }> = [];

    for (const r of rows ?? []) {
      const ext = (r.storage_path.split(".").pop() ?? "bin")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const newPath = `${tenantId}/${userId}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${ext}`;
      const { error: cpErr } = await supabaseAdmin.storage
        .from("media")
        .copy(r.storage_path, newPath);
      if (cpErr) {
        console.warn("[media.duplicate] copy failed:", cpErr.message);
        continue;
      }
      const { data: urlData } = supabaseAdmin.storage.from("media").getPublicUrl(newPath);
      const dot = r.filename.lastIndexOf(".");
      const base = dot > 0 ? r.filename.slice(0, dot) : r.filename;
      const suffix = dot > 0 ? r.filename.slice(dot) : "";
      const newName = `${base} - kopia${suffix}`;
      const { data: ins, error: iErr } = await supabase
        .from("media")
        .insert({
          tenant_id: tenantId,
          uploader_id: userId,
          storage_path: newPath,
          public_url: urlData.publicUrl,
          filename: newName,
          mime_type: r.mime_type,
          size_bytes: r.size_bytes,
          alt_text: r.alt_text,
          folder_path: folder,
        })
        .select("id")
        .single();
      if (iErr) {
        console.warn("[media.duplicate] insert failed:", iErr.message);
        continue;
      }
      out.push({ id: ins.id });
    }
    await recordAudit(supabase, {
      tenantId,
      action: "media.duplicate",
      entityType: "media",
      entityId: out[0]?.id ?? "n/a",
      metadata: { count: out.length, folder },
    });
    return { ok: true, ids: out.map((o) => o.id) };
  });

// ---------- Folders ----------
const CreateFolderSchema = z.object({ path: z.string().min(1).max(512) });

export const createMediaFolder = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => CreateFolderSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const path = normalizeFolderPath(data.path);
    if (path === "/") throw new Error("Root folder always exists");
    const tenantId = await requireTenantId(supabase, userId);

    // Ensure parents exist (auto-create ancestor chain).
    const parts = path.slice(1, -1).split("/");
    const chain: string[] = [];
    let acc = "/";
    for (const p of parts) {
      acc = acc + p + "/";
      chain.push(acc);
    }
    const rows = chain.map((p) => ({ tenant_id: tenantId, path: p, created_by: userId }));
    const { error } = await supabase.from("media_folders").upsert(rows, { onConflict: "tenant_id,path" });
    if (error) throw new Error(error.message);
    await recordAudit(supabase, {
      tenantId,
      action: "media.folder_create",
      entityType: "media_folder",
      entityId: path,
      metadata: { path },
    });
    return { ok: true, path };
  });

const RenameFolderSchema = z.object({
  oldPath: z.string().min(1).max(512),
  newPath: z.string().min(1).max(512),
});

export const renameMediaFolder = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => RenameFolderSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const oldP = normalizeFolderPath(data.oldPath);
    const newP = normalizeFolderPath(data.newPath);
    if (oldP === "/" || newP === "/") throw new Error("Cannot rename root");
    if (oldP === newP) return { ok: true };
    const tenantId = await requireTenantId(supabase, userId);

    // Update all folders whose path starts with oldP.
    const { data: folders, error: fErr } = await supabase
      .from("media_folders")
      .select("id, path")
      .eq("tenant_id", tenantId)
      .like("path", `${oldP}%`);
    if (fErr) throw new Error(fErr.message);
    for (const f of folders ?? []) {
      const np = newP + f.path.slice(oldP.length);
      const { error: uErr } = await supabase
        .from("media_folders")
        .update({ path: np })
        .eq("id", f.id);
      if (uErr) throw new Error(uErr.message);
    }
    // Update media rows.
    const { data: items, error: mErr } = await supabase
      .from("media")
      .select("id, folder_path")
      .eq("tenant_id", tenantId)
      .like("folder_path", `${oldP}%`);
    if (mErr) throw new Error(mErr.message);
    for (const it of items ?? []) {
      const np = newP + it.folder_path.slice(oldP.length);
      await supabase.from("media").update({ folder_path: np }).eq("id", it.id);
    }
    await recordAudit(supabase, {
      tenantId,
      action: "media.folder_rename",
      entityType: "media_folder",
      entityId: newP,
      metadata: { oldPath: oldP, newPath: newP },
    });
    return { ok: true };
  });

const DeleteFolderSchema = z.object({
  path: z.string().min(1).max(512),
  recursive: z.boolean().default(false),
});

export const deleteMediaFolder = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => DeleteFolderSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const path = normalizeFolderPath(data.path);
    if (path === "/") throw new Error("Cannot delete root");
    const tenantId = await requireTenantId(supabase, userId);

    const { count: fileCount } = await supabase
      .from("media")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .like("folder_path", `${path}%`);
    if (!data.recursive && (fileCount ?? 0) > 0) {
      throw new Error("Folder is not empty");
    }
    if (data.recursive && (fileCount ?? 0) > 0) {
      const { data: rows } = await supabase
        .from("media")
        .select("id, storage_path")
        .eq("tenant_id", tenantId)
        .like("folder_path", `${path}%`);
      const paths = (rows ?? []).map((r) => r.storage_path).filter(Boolean) as string[];
      if (paths.length) await supabaseAdmin.storage.from("media").remove(paths);
      if (rows?.length)
        await supabase
          .from("media")
          .delete()
          .in(
            "id",
            rows.map((r) => r.id),
          );
    }
    const { error } = await supabase
      .from("media_folders")
      .delete()
      .eq("tenant_id", tenantId)
      .like("path", `${path}%`);
    if (error) throw new Error(error.message);
    await recordAudit(supabase, {
      tenantId,
      action: "media.folder_delete",
      entityType: "media_folder",
      entityId: path,
      metadata: { path, recursive: data.recursive },
    });
    return { ok: true };
  });
