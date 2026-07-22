// Server-only helper: mirror mediów z WordPressa do naszego bucketa `media`.
// Ściąga plik, sprawdza rozmiar/MIME, deduplikuje po sha256, uploaduje przez
// service-role client (storage) + wpisuje wiersz w `media` przez user-scoped
// clienta (RLS + tenant). Nie modyfikuje NIC poza tabelą media i storage.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { BuilderDocument, WidgetContent, Json } from "@/lib/builder/types";

const ALLOWED_MIME = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
  "application/pdf",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
]);
const MAX_ASSETS_PER_PAGE = 200;
const MAX_BYTES = 15 * 1024 * 1024;

function extFromUrl(u: string): string {
  const clean = u.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "bin";
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "avif":
      return "image/avif";
    case "pdf":
      return "application/pdf";
    case "mp3":
      return "audio/mpeg";
    case "mp4":
    case "m4a":
      return "audio/mp4";
    case "wav":
      return "audio/wav";
    case "webm":
      return "audio/webm";
    case "ogg":
    case "oga":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}

function filenameFromUrl(u: string): string {
  try {
    const url = new URL(u);
    const last = url.pathname.split("/").filter(Boolean).pop() ?? "asset";
    return decodeURIComponent(last)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 128);
  } catch {
    return "asset";
  }
}

export interface MirrorEntry {
  publicUrl: string;
  mediaId: string;
}

export type MirrorMap = Map<string, MirrorEntry>;

export interface MirrorOptions {
  html: string;
  extraUrls?: string[];
  tenantId: string;
  userId: string;
  supabase: SupabaseClient<Database>;
  includeExternal?: boolean; // mirror linki spoza wp-content
}

export interface MirrorResult {
  map: MirrorMap;
  warnings: string[];
  mirroredCount: number;
  reusedCount: number;
  failed: Array<{ url: string; reason: string }>;
}

const HTML_URL_RE =
  /(?:src|href|data-src|data-lazy-src|poster)\s*=\s*"(https?:\/\/[^"]+\.(?:jpe?g|png|gif|webp|svg|avif|mp4|mp3|wav|ogg|pdf)(?:\?[^"]*)?)"/gi;

function collectUrls(html: string, extra?: string[]): string[] {
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  HTML_URL_RE.lastIndex = 0;
  while ((m = HTML_URL_RE.exec(html)) !== null) set.add(m[1]);
  if (extra) for (const u of extra) if (u) set.add(u);
  return Array.from(set);
}

async function loadAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Downloads media referenced in the given HTML to our storage bucket. Idempotent:
 * if a file with the same sha256 already exists in this tenant's media table,
 * reuses the existing row. Returns a URL rewrite map.
 */
export async function mirrorWpMedia(opts: MirrorOptions): Promise<MirrorResult> {
  const urls = collectUrls(opts.html, opts.extraUrls).slice(0, MAX_ASSETS_PER_PAGE);
  const map: MirrorMap = new Map();
  const warnings: string[] = [];
  const failed: Array<{ url: string; reason: string }> = [];
  let mirrored = 0;
  let reused = 0;
  if (urls.length === 0) {
    return { map, warnings, mirroredCount: 0, reusedCount: 0, failed };
  }
  const admin = await loadAdmin();

  const { assertPublicHttpUrl } = await import("@/lib/http/egressGuard.server");
  for (const url of urls) {
    try {
      if (!opts.includeExternal && !/\/wp-content\/uploads\//i.test(url)) {
        // Skip external CDNs unless explicitly opted-in.
        continue;
      }
      // SSRF guard: block internal/metadata targets before issuing fetch,
      // matching the sibling wordpress-import.functions.ts pattern.
      try {
        await assertPublicHttpUrl(url);
      } catch (guardErr) {
        failed.push({
          url,
          reason: guardErr instanceof Error ? guardErr.message : "Blocked by egress guard",
        });
        continue;
      }
      const res = await fetch(url, { method: "GET", redirect: "manual" });
      if (!res.ok) {
        failed.push({ url, reason: `HTTP ${res.status}` });
        continue;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) {
        failed.push({ url, reason: `Za duży (${buf.byteLength} B)` });
        continue;
      }
      const ext = extFromUrl(url);
      const mime = res.headers.get("content-type")?.split(";")[0].trim() || mimeFromExt(ext);
      if (!ALLOWED_MIME.has(mime)) {
        failed.push({ url, reason: `Niedozwolony MIME ${mime}` });
        continue;
      }
      const sha = createHash("sha256").update(buf).digest("hex");
      // Dedup w bazie: filename oparty o sha ma unikalny prefix - szukamy po storage_path.
      const year = new Date().getFullYear();
      const storagePath = `${opts.tenantId}/wp-import/${year}/${sha}.${ext}`;
      const { data: existing } = await opts.supabase
        .from("media")
        .select("id, public_url, storage_path")
        .eq("tenant_id", opts.tenantId)
        .eq("storage_path", storagePath)
        .maybeSingle();
      if (existing?.public_url) {
        map.set(url, { publicUrl: existing.public_url, mediaId: existing.id });
        reused++;
        continue;
      }
      // Upload przez service-role (bypass RLS na storage.objects tylko dla uploadu).
      const { error: upErr } = await admin.storage
        .from("media")
        .upload(storagePath, buf, { contentType: mime, upsert: true });
      if (upErr) {
        failed.push({ url, reason: `Storage: ${upErr.message}` });
        continue;
      }
      const { data: pub } = admin.storage.from("media").getPublicUrl(storagePath);
      const publicUrl = pub.publicUrl;
      // Wstaw wiersz user-scoped clientem, tenant guard poprzez RLS.
      const { data: row, error: insErr } = await opts.supabase
        .from("media")
        .insert({
          tenant_id: opts.tenantId,
          uploader_id: opts.userId,
          storage_path: storagePath,
          public_url: publicUrl,
          filename: filenameFromUrl(url),
          mime_type: mime,
          size_bytes: buf.byteLength,
        })
        .select("id")
        .single();
      if (insErr || !row) {
        // rollback storage entry, keep going
        await admin.storage.from("media").remove([storagePath]);
        failed.push({ url, reason: insErr?.message ?? "Insert failed" });
        continue;
      }
      map.set(url, { publicUrl, mediaId: row.id });
      mirrored++;
    } catch (e) {
      failed.push({ url, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  if (failed.length > 0) {
    warnings.push(
      `Nie udało się zaimportować ${failed.length} zasobów (${failed
        .slice(0, 3)
        .map((f) => `${filenameFromUrl(f.url)}: ${f.reason}`)
        .join("; ")}${failed.length > 3 ? "..." : ""}).`,
    );
  }
  return { map, warnings, mirroredCount: mirrored, reusedCount: reused, failed };
}

/* ---------------------- URL rewriting -------------------------- */

/** Rewrite absolute URLs inside a string using the mirror map. */
export function rewriteHtml(html: string, map: MirrorMap): string {
  if (!html || map.size === 0) return html;
  let out = html;
  for (const [orig, entry] of map) {
    // Escape RegExp-special characters; encoded and raw forms both appear.
    const escaped = orig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "g"), entry.publicUrl);
  }
  return out;
}

function rewriteJson(value: Json, map: MirrorMap): Json {
  if (typeof value === "string") return rewriteHtml(value, map);
  if (Array.isArray(value)) return value.map((v) => rewriteJson(v, map));
  if (value && typeof value === "object") {
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(value as { [k: string]: Json })) {
      out[k] = rewriteJson(v, map);
    }
    return out;
  }
  return value;
}

function rewriteContent(content: WidgetContent, map: MirrorMap): WidgetContent {
  const out: WidgetContent = {};
  for (const [k, v] of Object.entries(content)) {
    out[k] = rewriteJson(v as Json, map);
  }
  return out;
}

/** Rewrite every media URL that lives inside a builder document. */
export function rewriteBuilderDoc(doc: BuilderDocument, map: MirrorMap): BuilderDocument {
  if (map.size === 0) return doc;
  return {
    ...doc,
    sections: doc.sections.map((s) => ({
      ...s,
      children: s.children.map((c) => {
        if (c.kind === "column") {
          return {
            ...c,
            children: c.children.map((w) => ({ ...w, content: rewriteContent(w.content, map) })),
          };
        }
        return c;
      }),
    })),
  };
}
