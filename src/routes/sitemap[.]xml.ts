// Dynamic sitemap for crawlers. Pulls all published pages + posts and
// emits absolute URLs derived from the incoming request host (works on
// preview, custom domain and prod without baking a placeholder URL).
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_LANG,
  SUPPORTED_LANGS,
  localizedPath,
  stripLangPrefix,
} from "@/lib/i18n/localePath";

interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: "daily" | "weekly" | "monthly";
  priority?: string;
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// hreflang alternates per URL (x-default + one self-addressable URL per
// language). Each variant uses the language PATH prefix the site serves (PL at
// the bare path, EN under "/en"), mirroring the in-page <link rel="alternate">
// cluster so crawlers get the same language graph from sitemap and head. `loc`
// is the canonical (default-language) absolute URL.
export function alternateLinks(loc: string): string[] {
  let origin = "";
  let path = loc;
  try {
    const u = new URL(loc);
    origin = u.origin;
    path = u.pathname;
  } catch {
    /* relative loc - localize the raw string */
  }
  const canonical = stripLangPrefix(path).pathname;
  const href = (lang: (typeof SUPPORTED_LANGS)[number]) =>
    xmlEscape(`${origin}${localizedPath(canonical, lang)}`);
  const lines = [
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${href(DEFAULT_LANG)}"/>`,
  ];
  for (const l of SUPPORTED_LANGS) {
    lines.push(`    <xhtml:link rel="alternate" hreflang="${l}" href="${href(l)}"/>`);
  }
  return lines;
}

function originFromRequest(): string {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "";
  return host ? `${proto}://${host}` : "";
}

// Paths of ALL published pages (a noindex page still parents indexable posts,
// so it stays in the path map) + the set of page ids excluded from their own
// sitemap entry via the per-page `seo_noindex` flag.
async function buildPagePaths(): Promise<{ paths: Map<string, string>; noindex: Set<string> }> {
  const { data } = await supabaseAdmin
    .from("pages")
    .select("id, seo_noindex")
    .eq("status", "published")
    .is("deleted_at", null);
  const rows = (data ?? []) as Array<{ id: string; seo_noindex: boolean }>;
  const noindex = new Set(rows.filter((r) => r.seo_noindex).map((r) => r.id));
  const paths = new Map<string, string>();
  await Promise.all(
    rows.map(async ({ id }) => {
      const { data: p } = await supabaseAdmin.rpc("page_full_path", { _page_id: id });
      if (typeof p === "string") paths.set(id, p);
    }),
  );
  return { paths, noindex };
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const origin = originFromRequest();
        const entries: SitemapEntry[] = [
          { loc: `${origin}/`, changefreq: "daily", priority: "1.0" },
          { loc: `${origin}/blog`, changefreq: "daily", priority: "0.8" },
          { loc: `${origin}/sitemap`, changefreq: "weekly", priority: "0.3" },
        ];

        // Crawler surfaces degrade, never 500: on a DB failure the sitemap
        // still serves the static entries instead of poisoning the crawl.
        try {
          const { paths: pagePaths, noindex: noindexPages } = await buildPagePaths();
          for (const [id, path] of pagePaths) {
            // Pages marked noindex are excluded - a sitemap must not advertise
            // URLs the robots meta asks crawlers to skip.
            if (noindexPages.has(id)) continue;
            entries.push({ loc: `${origin}/${path}`, changefreq: "weekly", priority: "0.6" });
          }

          const { data: posts } = await supabaseAdmin
            .from("posts")
            .select("slug, parent_page_id, updated_at, published_at")
            .eq("status", "published")
            .is("deleted_at", null)
            .eq("seo_noindex", false);
          for (const row of posts ?? []) {
            const p = row as {
              slug: string;
              parent_page_id: string;
              updated_at: string | null;
              published_at: string | null;
            };
            const path = pagePaths.get(p.parent_page_id);
            if (!path) continue;
            entries.push({
              loc: `${origin}/${path}/${p.slug}`,
              lastmod: (p.updated_at ?? p.published_at ?? "").slice(0, 10) || undefined,
              changefreq: "monthly",
              priority: "0.7",
            });
          }
        } catch (e) {
          console.warn("[seo] sitemap content read failed:", e);
        }

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`,
          ...entries.map((e) =>
            [
              "  <url>",
              `    <loc>${xmlEscape(e.loc)}</loc>`,
              ...alternateLinks(e.loc),
              e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
              e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
              e.priority ? `    <priority>${e.priority}</priority>` : null,
              "  </url>",
            ]
              .filter(Boolean)
              .join("\n"),
          ),
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=600, s-maxage=3600",
          },
        });
      },
    },
  },
});
