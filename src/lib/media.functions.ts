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
