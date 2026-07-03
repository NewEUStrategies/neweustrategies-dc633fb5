// WordPress.com importer via Lovable connector gateway.
// Per-tenant, RLS-protected, lossless Gutenberg parsing.
//
// Public exports:
//   - listWpComSites: returns the WP.com sites accessible to the connected account
//   - previewWpComPosts: lists posts on a given site without writing anything
//   - createWpImportJob: creates a tracked job row and returns its id immediately
//   - runWpImportJob: executes a previously created job, streaming progress to DB
//   - getWpImportJob: polls a job (progress, log, final report)
//
// Background pattern:
//   client calls createWpImportJob (fast) -> gets jobId
//   client calls runWpImportJob (long-running, no need to await result)
//   client polls getWpImportJob during processing to render progress + log
//
// Sync mode (`sync_existing = true`) updates posts whose slug already exists
// instead of skipping them. Media import (`import_media = true`) downloads
// the featured image and every same-host <img> referenced in content,
// uploads to the `media` bucket and rewrites URLs in the imported HTML
// before parsing.

import { toJson } from "@/lib/builder/types";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { parseGutenberg } from "@/lib/blocks/gutenberg";
import { localizedBlocksToBuilderDoc } from "@/lib/builder/migrate/blocksToBuilder";
import type { LocalizedBlocks } from "@/lib/blocks/types";
import { recordAudit } from "./server/audit.server";
import { rateLimit } from "./server/rate-limit.server";
import { normalizeSourcePath, normalizeTargetPath } from "./seo/redirects";

/**
 * Redirect capture for the WP migration: map the ORIGINAL WordPress permalink
 * (wp.URL, e.g. "/2023/05/moj-wpis/") onto the new canonical path. Without
 * this every imported post loses its inbound links and search equity the
 * moment DNS flips. Upserts into the redirect manager; best-effort - an entry
 * failure must never fail the import job.
 */
async function captureWpRedirect(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
  wpUrl: string | undefined,
  newPath: string,
): Promise<boolean> {
  try {
    if (!wpUrl) return false;
    const source = normalizeSourcePath(wpUrl);
    // Internal path target only - the WP permalink maps onto our own URL.
    const target = normalizeTargetPath(newPath);
    if (!source || !target || source === target || source === "/") return false;
    const { error } = await supabase.from("redirects").upsert(
      {
        tenant_id: tenantId,
        source_path: source,
        target_path: target,
        status_code: 301,
        source: "wp_import",
        created_by: userId,
        is_enabled: true,
      },
      { onConflict: "tenant_id,source_path" },
    );
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.warn("[wp-import] redirect capture failed:", e);
    return false;
  }
}
import type { Json } from "@/integrations/supabase/types";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/wordpress_com";
const MAX_LOG_ENTRIES = 500;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const ALLOWED_MEDIA_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
]);

function authHeaders(): HeadersInit {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const wpKey = process.env.WORDPRESS_COM_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY is not configured");
  if (!wpKey)
    throw new Error(
      "WORDPRESS_COM_API_KEY is not configured - connect WordPress.com in Connectors",
    );
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": wpKey,
    Accept: "application/json",
  };
}

async function wpFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${GATEWAY_URL}${path}`, { headers: authHeaders() });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WordPress.com API ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`WordPress.com API returned non-JSON: ${text.slice(0, 200)}`);
  }
}

// ---------- shared helpers ----------

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function resolveTenant(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data?.tenant_id) throw new Error("No tenant for current user");
  return data.tenant_id as string;
}

async function resolveBlogPage(
  supabase: SupabaseClient,
  tenantId: string,
  authorId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("pages")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("slug", "blog")
    .is("parent_id", null)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: created, error } = await supabase
    .from("pages")
    .insert({
      tenant_id: tenantId,
      author_id: authorId,
      slug: "blog",
      title_pl: "Blog",
      title_en: "Blog",
      status: "published",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message || "Cannot create default blog page");
  return created.id as string;
}

async function ensureUniqueSlug(
  supabase: SupabaseClient,
  tenantId: string,
  desired: string,
  excludePostId?: string,
): Promise<string> {
  const base = slugify(desired) || `wp-${Date.now().toString(36)}`;
  let candidate = base;
  for (let i = 0; i < 50; i += 1) {
    let q = supabase
      .from("posts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("slug", candidate)
      .limit(1);
    if (excludePostId) q = q.neq("id", excludePostId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return candidate;
    candidate = `${base}-${i + 2}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// ---------- WP.com response shapes ----------

interface WpSite {
  ID: number;
  name: string;
  description: string;
  URL: string;
  jetpack: boolean;
}
interface WpSitesResponse {
  sites: WpSite[];
}

interface WpPost {
  ID: number;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  status: string;
  date: string;
  modified: string;
  URL: string;
  featured_image: string | null;
}
interface WpPostsResponse {
  found: number;
  posts: WpPost[];
}

// ---------- text helpers ----------

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
    .replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}
function mapStatus(wp: string): "draft" | "published" | "archived" {
  if (wp === "publish") return "published";
  if (wp === "trash") return "archived";
  return "draft";
}

// ---------- media import ----------

const WP_HOST_RE = /(wp\.com|wordpress\.com|files\.wordpress\.com)$/i;

function isLikelyWpMediaUrl(url: string, siteHost: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return (
      u.host === siteHost || WP_HOST_RE.test(u.host) || /\.files\.wordpress\.com$/i.test(u.host)
    );
  } catch {
    return false;
  }
}

function extName(url: string, mime: string): string {
  const m = url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  if (m) return m[1].toLowerCase();
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  if (mime === "image/avif") return "avif";
  return "bin";
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface MediaImporter {
  importUrl(url: string): Promise<string>;
  count: number;
}

function createMediaImporter(opts: {
  tenantId: string;
  userId: string;
  siteHost: string;
}): MediaImporter {
  const cache = new Map<string, string>(); // sourceUrl -> publicUrl
  let count = 0;
  return {
    get count() {
      return count;
    },
    async importUrl(sourceUrl: string): Promise<string> {
      if (cache.has(sourceUrl)) return cache.get(sourceUrl)!;
      if (!isLikelyWpMediaUrl(sourceUrl, opts.siteHost)) return sourceUrl;
      // Lazy import of admin client (server-only).
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const res = await fetch(sourceUrl, { redirect: "follow" });
      if (!res.ok) throw new Error(`fetch ${res.status} ${sourceUrl}`);
      const ct = (res.headers.get("content-type") || "application/octet-stream")
        .split(";")[0]
        .trim();
      if (!ALLOWED_MEDIA_MIME.has(ct)) throw new Error(`mime not allowed: ${ct}`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_MEDIA_BYTES)
        throw new Error(`file too large (${buf.byteLength} bytes)`);

      const hash = (await sha256Hex(buf)).slice(0, 32);
      const ext = extName(sourceUrl, ct);
      const path = `${opts.tenantId}/wp-import/${hash}.${ext}`;

      const { error: upErr } = await supabaseAdmin.storage
        .from("media")
        .upload(path, new Uint8Array(buf), { contentType: ct, upsert: true });
      if (upErr) throw new Error(`storage upload: ${upErr.message}`);

      const { data: pub } = supabaseAdmin.storage.from("media").getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      // Best-effort row in `media`. Idempotent on path (unique not enforced, so we check).
      const { data: existing } = await supabaseAdmin
        .from("media")
        .select("id")
        .eq("storage_path", path)
        .maybeSingle();
      if (!existing?.id) {
        const filename =
          sourceUrl.split("/").pop()?.split("?")[0]?.slice(0, 200) || `${hash}.${ext}`;
        await supabaseAdmin.from("media").insert({
          tenant_id: opts.tenantId,
          uploader_id: opts.userId,
          storage_path: path,
          public_url: publicUrl,
          filename,
          mime_type: ct,
          size_bytes: buf.byteLength,
        });
      }

      cache.set(sourceUrl, publicUrl);
      count += 1;
      return publicUrl;
    },
  };
}

// Find all <img src="..."> and srcset entries that look like WP media for the site,
// import them, then rewrite URLs in-place. Returns the rewritten HTML.
async function rewriteHtmlMedia(
  html: string,
  importer: MediaImporter,
  siteHost: string,
  onError: (sourceUrl: string, err: unknown) => void,
): Promise<string> {
  const urls = new Set<string>();
  const re =
    /(src|href|data-src|data-large-file|data-medium-file|data-orig-file|poster)\s*=\s*"([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (isLikelyWpMediaUrl(m[2], siteHost)) urls.add(m[2]);
  }
  const reSrcset = /srcset\s*=\s*"([^"]+)"/gi;
  while ((m = reSrcset.exec(html)) !== null) {
    for (const part of m[1].split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url && isLikelyWpMediaUrl(url, siteHost)) urls.add(url);
    }
  }

  const map = new Map<string, string>();
  for (const u of urls) {
    try {
      const next = await importer.importUrl(u);
      if (next !== u) map.set(u, next);
    } catch (e) {
      onError(u, e);
    }
  }
  if (map.size === 0) return html;
  let out = html;
  for (const [from, to] of map) {
    // Global plain-string replace (avoid regex special chars).
    out = out.split(from).join(to);
  }
  return out;
}

// ---------- job log helpers ----------

type LogLevel = "info" | "warn" | "error";
interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  wp_id?: number;
}

interface JobPatch {
  log?: LogEntry[];
  processed?: number;
  imported?: number;
  updated_count?: number;
  skipped?: number;
  failed?: number;
  media_imported?: number;
  status?: "running" | "completed" | "failed" | "canceled";
  error?: string | null;
  total?: number;
  finished_at?: string | null;
}

async function readJobStatus(supabase: SupabaseClient, jobId: string): Promise<string | null> {
  const { data } = await supabase
    .from("wp_import_jobs")
    .select("status")
    .eq("id", jobId)
    .maybeSingle();
  return (data?.status as string | undefined) ?? null;
}

function firstContentImage(html: string): string | null {
  const m = html.match(/<img[^>]+src\s*=\s*"([^"]+)"/i);
  return m ? m[1] : null;
}

async function patchJob(supabase: SupabaseClient, jobId: string, patch: JobPatch): Promise<void> {
  const { error } = await supabase.from("wp_import_jobs").update(patch).eq("id", jobId);
  if (error) console.warn("[wp-import] job patch failed:", error.message);
}

class JobLogger {
  private buffer: LogEntry[] = [];
  constructor(
    private supabase: SupabaseClient,
    private jobId: string,
  ) {}
  async load(): Promise<void> {
    const { data } = await this.supabase
      .from("wp_import_jobs")
      .select("log")
      .eq("id", this.jobId)
      .maybeSingle();
    if (data?.log && Array.isArray(data.log)) {
      this.buffer = (data.log as unknown as LogEntry[]).slice(-MAX_LOG_ENTRIES);
    }
  }
  async push(level: LogLevel, msg: string, wp_id?: number): Promise<void> {
    this.buffer.push({ ts: new Date().toISOString(), level, msg, wp_id });
    if (this.buffer.length > MAX_LOG_ENTRIES) {
      this.buffer = this.buffer.slice(-MAX_LOG_ENTRIES);
    }
    await patchJob(this.supabase, this.jobId, { log: this.buffer });
  }
}

// ---------- public server functions ----------

export const listWpComSites = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async () => {
    try {
      const res = await wpFetch<WpSitesResponse>(
        "/rest/v1.1/me/sites?fields=ID,name,description,URL,jetpack",
      );
      return {
        sites: (res.sites ?? []).map((s) => ({
          id: s.ID,
          name: s.name,
          url: s.URL,
          description: s.description,
        })),
        warning: null as string | null,
      };
    } catch (e) {
      // Site-scoped OAuth tokens (the common case when the connector was authorized
      // for a single blog) cannot call /me/sites - WP.com returns 400
      // "authorization_required". Degrade gracefully so the UI still works.
      const msg = e instanceof Error ? e.message : String(e);
      return {
        sites: [] as Array<{ id: number; name: string; url: string; description: string }>,
        warning: msg,
      };
    }
  });

const ListInput = z.object({
  site: z.string().min(1).max(255),
  number: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).max(10_000).default(0),
  status: z.enum(["publish", "draft", "any"]).default("publish"),
  // Content type filter - default to "post" so pages/attachments are never imported by accident.
  type: z.enum(["post", "page", "any"]).default("post"),
});

export const previewWpComPosts = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data }) => {
    const site = encodeURIComponent(data.site);
    const qs = new URLSearchParams({
      number: String(data.number),
      offset: String(data.offset),
      status: data.status,
      type: data.type,
      fields: "ID,slug,title,excerpt,date,modified,URL,featured_image,status",
    });
    const res = await wpFetch<WpPostsResponse>(`/rest/v1.1/sites/${site}/posts?${qs.toString()}`);
    return {
      found: res.found,
      posts: (res.posts ?? []).map((p) => ({
        id: p.ID,
        slug: p.slug,
        title: stripTags(p.title),
        excerpt: stripTags(p.excerpt).slice(0, 240),
        date: p.date,
        status: p.status,
        url: p.URL,
        featured_image: p.featured_image,
      })),
    };
  });

// ---- jobs ----

const JobInput = ListInput.extend({
  language: z.enum(["pl", "en"]).default("pl"),
  only_ids: z.array(z.number().int()).max(100).optional(),
  sync_existing: z.boolean().default(false),
  import_media: z.boolean().default(false),
});

export const createWpImportJob = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => JobInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!(await rateLimit({ scope: "wp.import", subjectId: userId, max: 10 }))) {
      throw new Error("Rate limit exceeded - please wait a minute before importing again");
    }
    const tenantId = await resolveTenant(supabase, userId);
    const { data: row, error } = await supabase
      .from("wp_import_jobs")
      .insert({
        tenant_id: tenantId,
        actor_id: userId,
        site: data.site,
        language: data.language,
        status: "running",
        options: toJson({
          number: data.number,
          offset: data.offset,
          status: data.status,
          type: data.type,
          sync_existing: data.sync_existing,
          import_media: data.import_media,
          only_ids: data.only_ids ?? null,
        }),
        log: toJson([
          {
            ts: new Date().toISOString(),
            level: "info",
            msg: `Job queued for ${data.site}`,
          },
        ]),
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message || "cannot create job");
    return { jobId: row.id as string };
  });

const RunInput = JobInput.extend({ jobId: z.string().uuid() });

export const runWpImportJob = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => RunInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const tenantId = await resolveTenant(supabase, userId);

    // Verify job ownership (RLS already blocks cross-tenant reads, but be explicit).
    const { data: job } = await supabase
      .from("wp_import_jobs")
      .select("id, status, tenant_id")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job || job.tenant_id !== tenantId) throw new Error("Job not found");
    if (job.status !== "running") throw new Error(`Job already ${job.status}`);

    const logger = new JobLogger(supabase, data.jobId);
    await logger.load();

    let processed = 0;
    let imported = 0;
    let updated_count = 0;
    let skipped = 0;
    let failed = 0;

    try {
      const parentPageId = await resolveBlogPage(supabase, tenantId, userId);
      // Base path of imported posts (usually "blog") - the target side of the
      // old-permalink -> new-URL redirects captured per post below.
      const { data: parentPathRaw } = await supabase.rpc("page_full_path", {
        _page_id: parentPageId,
      });
      const parentPath = typeof parentPathRaw === "string" && parentPathRaw ? parentPathRaw : null;
      let redirects_created = 0;

      const site = encodeURIComponent(data.site);
      const qs = new URLSearchParams({
        number: String(data.number),
        offset: String(data.offset),
        status: data.status,
        type: data.type,
        fields: "ID,slug,title,excerpt,content,date,modified,URL,featured_image,status",
      });
      await logger.push("info", `Fetching posts from ${data.site}…`);
      const res = await wpFetch<WpPostsResponse>(`/rest/v1.1/sites/${site}/posts?${qs.toString()}`);
      const filtered = data.only_ids
        ? res.posts.filter((p) => data.only_ids!.includes(p.ID))
        : res.posts;

      await patchJob(supabase, data.jobId, { total: filtered.length });
      await logger.push(
        "info",
        `Got ${filtered.length} posts to process (sync=${data.sync_existing}, media=${data.import_media}).`,
      );

      let siteHost = data.site;
      try {
        siteHost = new URL(data.site.startsWith("http") ? data.site : `https://${data.site}`).host;
      } catch {
        /* keep */
      }

      const importer = data.import_media
        ? createMediaImporter({ tenantId, userId, siteHost })
        : null;

      for (const wp of filtered) {
        // Cooperative cancellation: re-check status each iteration.
        const liveStatus = await readJobStatus(supabase, data.jobId);
        if (liveStatus === "canceled") {
          await logger.push("warn", "Import canceled by user.");
          await patchJob(supabase, data.jobId, {
            status: "canceled",
            finished_at: new Date().toISOString(),
          });
          return {
            jobId: data.jobId,
            status: "canceled" as const,
            processed,
            imported,
            updated_count,
            skipped,
            failed,
            media_imported: importer?.count ?? 0,
          };
        }

        try {
          const desiredSlug = wp.slug || slugify(stripTags(wp.title)) || `wp-${wp.ID}`;

          // Inline media (optional) - rewrite first so we can pick a cover from content if needed.
          let html = wp.content || "";
          if (importer && html) {
            html = await rewriteHtmlMedia(html, importer, siteHost, (u, err) => {
              void logger.push(
                "warn",
                `Media skipped ${u}: ${err instanceof Error ? err.message : "unknown"}`,
                wp.ID,
              );
            });
          }

          // Cover: normalize empty -> null, fallback to first content image.
          const rawCover = (wp.featured_image ?? "").trim();
          let coverUrl: string | null = rawCover.length > 0 ? rawCover : firstContentImage(html);
          if (coverUrl && importer) {
            try {
              coverUrl = await importer.importUrl(coverUrl);
            } catch (e) {
              await logger.push(
                "warn",
                `Cover image failed: ${e instanceof Error ? e.message : "unknown"}`,
                wp.ID,
              );
            }
          }

          const doc = parseGutenberg(html);
          const title = stripTags(wp.title);
          const excerpt = stripTags(wp.excerpt).slice(0, 1000);

          const blocksPayload =
            data.language === "pl"
              ? { pl: doc, en: { version: 1, blocks: [] } }
              : { pl: { version: 1, blocks: [] }, en: doc };
          const blocks_data = JSON.parse(JSON.stringify(blocksPayload)) as Json;
          const builder_data = JSON.parse(
            JSON.stringify(
              localizedBlocksToBuilderDoc(blocksPayload as unknown as LocalizedBlocks),
            ),
          ) as Json;

          const titleField =
            data.language === "pl"
              ? { title_pl: title, title_en: "" }
              : { title_pl: "", title_en: title };
          const excerptField =
            data.language === "pl"
              ? { excerpt_pl: excerpt, excerpt_en: null }
              : { excerpt_pl: null, excerpt_en: excerpt };

          const status = mapStatus(wp.status);

          // Existing post?
          const { data: existing } = await supabase
            .from("posts")
            .select("id, cover_image_url")
            .eq("tenant_id", tenantId)
            .eq("slug", desiredSlug)
            .maybeSingle();

          if (existing?.id && !data.sync_existing) {
            skipped += 1;
            await logger.push("info", `Skipped (slug exists): ${desiredSlug}`, wp.ID);
          } else if (existing?.id && data.sync_existing) {
            const prevCover = (existing.cover_image_url as string | null) ?? null;
            const { error: upErr } = await supabase
              .from("posts")
              .update({
                editor: "builder",
                status,
                published_at: status === "published" ? wp.date : null,
                cover_image_url: coverUrl,
                blocks_data,
                builder_data,
                ...titleField,
                ...excerptField,
              })
              .eq("id", existing.id);
            if (upErr) throw new Error(upErr.message);
            updated_count += 1;
            if (prevCover !== coverUrl) {
              await logger.push(
                "info",
                coverUrl ? `Cover updated: ${desiredSlug}` : `Cover cleared: ${desiredSlug}`,
                wp.ID,
              );
            }
            if (status === "published" && parentPath) {
              const made = await captureWpRedirect(
                supabase,
                userId,
                tenantId,
                wp.URL,
                `/${parentPath}/${desiredSlug}`,
              );
              if (made) redirects_created += 1;
            }
            await logger.push("info", `Updated: ${desiredSlug}`, wp.ID);
            await recordAudit(supabase, {
              tenantId,
              action: "post.update",
              entityType: "post",
              entityId: existing.id as string,
              metadata: {
                source: "wordpress_com",
                wp_id: wp.ID,
                cover_changed: prevCover !== coverUrl,
              },
            });
          } else {
            const slug = await ensureUniqueSlug(supabase, tenantId, desiredSlug);
            const { data: inserted, error } = await supabase
              .from("posts")
              .insert({
                tenant_id: tenantId,
                author_id: userId,
                slug,
                parent_page_id: parentPageId,
                editor: "builder",
                status,
                published_at: status === "published" ? wp.date : null,
                cover_image_url: coverUrl,
                blocks_data,
                builder_data,
                ...titleField,
                ...excerptField,
              })
              .select("id, slug")
              .single();
            if (error || !inserted) throw new Error(error?.message || "insert failed");
            imported += 1;
            if (status === "published" && parentPath) {
              const made = await captureWpRedirect(
                supabase,
                userId,
                tenantId,
                wp.URL,
                `/${parentPath}/${inserted.slug as string}`,
              );
              if (made) redirects_created += 1;
            }
            await logger.push("info", `Imported: ${inserted.slug as string}`, wp.ID);
            await recordAudit(supabase, {
              tenantId,
              action: "post.create",
              entityType: "post",
              entityId: inserted.id as string,
              metadata: { source: "wordpress_com", wp_id: wp.ID },
            });
          }
        } catch (e) {
          failed += 1;
          await logger.push("error", e instanceof Error ? e.message : "unknown error", wp.ID);
        } finally {
          processed += 1;
          await patchJob(supabase, data.jobId, {
            processed,
            imported,
            updated_count,
            skipped,
            failed,
            media_imported: importer?.count ?? 0,
          });
        }
      }

      await patchJob(supabase, data.jobId, {
        status: "completed",
        finished_at: new Date().toISOString(),
      });
      await logger.push(
        "info",
        `Done. imported=${imported}, updated=${updated_count}, skipped=${skipped}, failed=${failed}, media=${importer?.count ?? 0}, redirects=${redirects_created}`,
      );

      return {
        jobId: data.jobId,
        status: "completed" as const,
        processed,
        imported,
        updated_count,
        skipped,
        failed,
        media_imported: importer?.count ?? 0,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      await logger.push("error", `Job aborted: ${msg}`);
      await patchJob(supabase, data.jobId, {
        status: "failed",
        error: msg,
        finished_at: new Date().toISOString(),
      });
      throw e;
    }
  });

const GetJobInput = z.object({ jobId: z.string().uuid() });

export const getWpImportJob = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => GetJobInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("wp_import_jobs")
      .select(
        "id, status, site, total, processed, imported, updated_count, skipped, failed, media_imported, log, error, created_at, finished_at",
      )
      .eq("id", data.jobId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Job not found");
    return row;
  });

// ---- cancel ----

const CancelInput = z.object({ jobId: z.string().uuid() });

export const cancelWpImportJob = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => CancelInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const tenantId = await resolveTenant(supabase, userId);
    const { data: job } = await supabase
      .from("wp_import_jobs")
      .select("id, status, tenant_id")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job || job.tenant_id !== tenantId) throw new Error("Job not found");
    if (job.status !== "running") {
      return { jobId: data.jobId, status: job.status as string };
    }
    // Flip status; the runner polls and finalizes (writes finished_at and the
    // "canceled by user" log entry) on its next iteration.
    const { error } = await supabase
      .from("wp_import_jobs")
      .update({ status: "canceled" })
      .eq("id", data.jobId);
    if (error) throw new Error(error.message);
    await recordAudit(supabase, {
      tenantId,
      action: "wp_import.cancel",
      entityType: "wp_import_job",
      entityId: data.jobId,
    });
    return { jobId: data.jobId, status: "canceled" };
  });
