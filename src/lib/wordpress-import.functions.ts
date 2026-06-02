// WordPress.com importer via Lovable connector gateway.
// Per-tenant, RLS-protected, lossless Gutenberg parsing.
//
// Public exports:
//   - listWpComSites: returns the WP.com sites accessible to the connected account
//   - previewWpComPosts: lists posts on a given site without writing anything
//   - importWpComPosts: imports a batch of posts into our `posts` table

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseGutenberg } from "@/lib/blocks/gutenberg";
import { recordAudit } from "./server/audit.server";
import { rateLimit } from "./server/rate-limit.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/wordpress_com";

function authHeaders(): HeadersInit {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const wpKey = process.env.WORDPRESS_COM_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY is not configured");
  if (!wpKey) throw new Error("WORDPRESS_COM_API_KEY is not configured - connect WordPress.com in Connectors");
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

// ---------- shared helpers (kept local to avoid coupling with content.functions) ----------

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
    .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  if (error || !data?.tenant_id) throw new Error("No tenant for current user");
  return data.tenant_id as string;
}

async function resolveBlogPage(
  supabase: SupabaseClient, tenantId: string, authorId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("pages").select("id")
    .eq("tenant_id", tenantId).eq("slug", "blog").is("parent_id", null)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: created, error } = await supabase
    .from("pages")
    .insert({
      tenant_id: tenantId, author_id: authorId, slug: "blog",
      title_pl: "Blog", title_en: "Blog", status: "published",
      published_at: new Date().toISOString(),
    })
    .select("id").single();
  if (error || !created) throw new Error(error?.message || "Cannot create default blog page");
  return created.id as string;
}

async function ensureUniqueSlug(
  supabase: SupabaseClient, tenantId: string, desired: string,
): Promise<string> {
  const base = slugify(desired) || `wp-${Date.now().toString(36)}`;
  let candidate = base;
  for (let i = 0; i < 50; i += 1) {
    const { data, error } = await supabase
      .from("posts").select("id").eq("tenant_id", tenantId).eq("slug", candidate).limit(1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return candidate;
    candidate = `${base}-${i + 2}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// ---------- WP.com response shapes (typed subsets) ----------

interface WpSite {
  ID: number;
  name: string;
  description: string;
  URL: string;
  jetpack: boolean;
}
interface WpSitesResponse { sites: WpSite[] }

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
interface WpPostsResponse { found: number; posts: WpPost[] }

// ---------- text helpers ----------

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&#8211;/g, "-").replace(/&#8212;/g, "-")
    .replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}
function mapStatus(wp: string): "draft" | "published" | "archived" {
  if (wp === "publish") return "published";
  if (wp === "trash") return "archived";
  return "draft";
}

// ---------- public server functions ----------

export const listWpComSites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const res = await wpFetch<WpSitesResponse>("/rest/v1.1/me/sites?fields=ID,name,description,URL,jetpack");
    return {
      sites: (res.sites ?? []).map((s) => ({
        id: s.ID, name: s.name, url: s.URL, description: s.description,
      })),
    };
  });

const ListInput = z.object({
  site: z.string().min(1).max(255),
  number: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).max(10_000).default(0),
  status: z.enum(["publish", "draft", "any"]).default("publish"),
});

export const previewWpComPosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data }) => {
    const site = encodeURIComponent(data.site);
    const qs = new URLSearchParams({
      number: String(data.number),
      offset: String(data.offset),
      status: data.status,
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

const ImportInput = ListInput.extend({
  language: z.enum(["pl", "en"]).default("pl"),
  // Optional whitelist to import only specific post IDs from the listing
  only_ids: z.array(z.number().int()).max(100).optional(),
});

interface ImportReport {
  attempted: number;
  imported: number;
  skipped_existing: number;
  errors: Array<{ id: number; message: string }>;
  posts: Array<{ wp_id: number; id: string; slug: string }>;
}

export const importWpComPosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ImportInput.parse(i))
  .handler(async ({ data, context }): Promise<ImportReport> => {
    const { supabase, userId } = context;
    if (!(await rateLimit({ scope: "wp.import", subjectId: userId, max: 10 }))) {
      throw new Error("Rate limit exceeded - please wait a minute before importing again");
    }

    const tenantId = await resolveTenant(supabase, userId);
    const parentPageId = await resolveBlogPage(supabase, tenantId, userId);

    const site = encodeURIComponent(data.site);
    const qs = new URLSearchParams({
      number: String(data.number),
      offset: String(data.offset),
      status: data.status,
      fields: "ID,slug,title,excerpt,content,date,modified,URL,featured_image,status",
    });
    const res = await wpFetch<WpPostsResponse>(`/rest/v1.1/sites/${site}/posts?${qs.toString()}`);
    const filtered = data.only_ids
      ? res.posts.filter((p) => data.only_ids!.includes(p.ID))
      : res.posts;

    const report: ImportReport = {
      attempted: filtered.length, imported: 0, skipped_existing: 0, errors: [], posts: [],
    };

    for (const wp of filtered) {
      try {
        const desiredSlug = wp.slug || slugify(stripTags(wp.title)) || `wp-${wp.ID}`;
        // Skip if a post already exists with this slug for the tenant
        const { data: existing } = await supabase
          .from("posts").select("id").eq("tenant_id", tenantId).eq("slug", desiredSlug).maybeSingle();
        if (existing?.id) {
          report.skipped_existing += 1;
          continue;
        }
        const slug = await ensureUniqueSlug(supabase, tenantId, desiredSlug);
        const title = stripTags(wp.title);
        const excerpt = stripTags(wp.excerpt).slice(0, 1000);
        const doc = parseGutenberg(wp.content);

        const blocksPayload = data.language === "pl"
          ? { pl: doc, en: { version: 1, blocks: [] } }
          : { pl: { version: 1, blocks: [] }, en: doc };
        // Round-trip via JSON to satisfy the generated `Json` column type
        // without resorting to `any` / `as any`.
        const blocks_data = JSON.parse(JSON.stringify(blocksPayload)) as Record<string, unknown>;

        const titleField = data.language === "pl" ? { title_pl: title, title_en: "" } : { title_pl: "", title_en: title };
        const excerptField = data.language === "pl"
          ? { excerpt_pl: excerpt, excerpt_en: null }
          : { excerpt_pl: null, excerpt_en: excerpt };

        const status = mapStatus(wp.status);
        const { data: inserted, error } = await supabase
          .from("posts")
          .insert({
            tenant_id: tenantId, author_id: userId, slug,
            parent_page_id: parentPageId,
            editor: "blocks",
            status,
            published_at: status === "published" ? wp.date : null,
            cover_image_url: wp.featured_image,
            blocks_data,
            ...titleField,
            ...excerptField,
          })
          .select("id, slug").single();
        if (error || !inserted) throw new Error(error?.message || "insert failed");
        report.imported += 1;
        report.posts.push({ wp_id: wp.ID, id: inserted.id as string, slug: inserted.slug as string });
      } catch (e) {
        report.errors.push({
          id: wp.ID,
          message: e instanceof Error ? e.message : "Unknown error",
        });
      }
    }

    await recordAudit(supabase, {
      tenantId, action: "post.create", entityType: "post.import.wordpress_com",
      entityId: null,
      metadata: {
        site: data.site, language: data.language,
        attempted: report.attempted, imported: report.imported,
        skipped: report.skipped_existing, errors: report.errors.length,
      },
    });

    return report;
  });
