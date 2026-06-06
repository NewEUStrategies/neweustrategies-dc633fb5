// Server functions for media management. All ops require auth (RLS as the user)
// and write an audit_log entry. Path prefix is enforced server-side - clients
// cannot lie about tenant_id.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordAudit } from "./server/audit.server";
import { rateLimit } from "./server/rate-limit.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "image/avif",
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
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RegisterUploadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Resolve tenant from profiles (authoritative; never trust client).
    const { data: profile, error: profileErr } = await supabase
      .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
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
      tenantId, action: "media.upload", entityType: "media", entityId: row.id,
      metadata: { filename: data.filename, mime: data.mimeType, size: data.sizeBytes },
    });

    return { id: row.id };
  });

const DeleteSchema = z.object({ mediaId: z.string().uuid() });

export const deleteMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

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
      tenantId: row.tenant_id, action: "media.delete", entityType: "media", entityId: row.id,
      metadata: { storage_path: row.storage_path },
    });

    return { ok: true };
  });

// ---------- Media usage lookup ----------
// Finds posts/pages that reference a given media item (by id, public URL, or
// storage path). Scans cover_image_url, content (HTML), builder_data and
// blocks_data (JSON). Scoped to the user's tenant by RLS.
const UsageSchema = z.object({ mediaId: z.string().uuid() });

export type MediaUsageItem = {
  kind: "post" | "page";
  id: string;
  slug: string;
  title: string;
  where: string[];
};

export const getMediaUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UsageSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ items: MediaUsageItem[] }> => {
    const { supabase } = context;

    const { data: media, error: mErr } = await supabase
      .from("media")
      .select("id, public_url, storage_path, filename")
      .eq("id", data.mediaId)
      .maybeSingle();
    if (mErr) throw new Error(mErr.message);
    if (!media) throw new Error("Media not found or access denied");

    // Treat duplicates (same filename, re-uploaded/imported copies) as the same
    // logical asset — otherwise opening a duplicate would falsely show "0 uses".
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

    // POSTS
    const { data: posts, error: pErr } = await supabase
      .from("posts")
      .select("id, slug, title_pl, title_en, cover_image_url, excerpt_pl, excerpt_en, content_pl, content_en, builder_data, blocks_data, layout_overrides")
      .is("deleted_at", null);
    if (pErr) throw new Error(pErr.message);
    for (const p of posts ?? []) {
      const where: string[] = [];
      if (matchesUrl(p.cover_image_url)) where.push("Okładka");
      if (matches(p.excerpt_pl) || matches(p.excerpt_en)) where.push("Zajawka");
      if (matches(p.content_pl) || matches(p.content_en)) where.push("Treść");
      if (matches(p.builder_data)) where.push("Builder");
      if (matches(p.blocks_data)) where.push("Bloki");
      if (matches(p.layout_overrides)) where.push("Layout");
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

    // PAGES
    const { data: pages, error: gErr } = await supabase
      .from("pages")
      .select("id, slug, title_pl, title_en, cover_image_url, excerpt_pl, excerpt_en, content_pl, content_en, builder_data, layout_overrides")
      .is("deleted_at", null);
    if (gErr) throw new Error(gErr.message);
    for (const p of pages ?? []) {
      const where: string[] = [];
      if (matchesUrl(p.cover_image_url)) where.push("Okładka");
      if (matches(p.excerpt_pl) || matches(p.excerpt_en)) where.push("Zajawka");
      if (matches(p.content_pl) || matches(p.content_en)) where.push("Treść");
      if (matches(p.builder_data)) where.push("Builder");
      if (matches(p.layout_overrides)) where.push("Layout");
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
