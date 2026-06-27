// Dynamic sitemap for crawlers. Pulls all published pages + posts and
// emits absolute URLs derived from the incoming request host (works on
// preview, custom domain and prod without baking a placeholder URL).
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SUPPORTED_LANGS } from "@/lib/seo/meta";

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

// hreflang alternates per URL (x-default + one self-addressable ?lang= per
// language). Mirrors the in-page <link rel="alternate"> cluster so crawlers get
// the language graph from both the sitemap and the rendered head.
export function alternateLinks(loc: string): string[] {
  const lines = [
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(loc)}"/>`,
  ];
  for (const l of SUPPORTED_LANGS) {
    lines.push(`    <xhtml:link rel="alternate" hreflang="${l}" href="${xmlEscape(`${loc}?lang=${l}`)}"/>`);
  }
  return lines;
}

function originFromRequest(): string {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "";
  return host ? `${proto}://${host}` : "";
}

async function buildPagePaths(): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin
    .from("pages")
    .select("id")
    .eq("status", "published")
    .is("deleted_at", null);
  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  const paths = new Map<string, string>();
  await Promise.all(
    ids.map(async (id) => {
      const { data: p } = await supabaseAdmin.rpc("page_full_path", { _page_id: id });
      if (typeof p === "string") paths.set(id, p);
    }),
  );
  return paths;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const origin = originFromRequest();
        const entries: SitemapEntry[] = [
          { loc: `${origin}/`, changefreq: "daily", priority: "1.0" },
          { loc: `${origin}/blog`, changefreq: "daily", priority: "0.8" },
        ];

        const pagePaths = await buildPagePaths();
        for (const [, path] of pagePaths) {
          entries.push({ loc: `${origin}/${path}`, changefreq: "weekly", priority: "0.6" });
        }

        const { data: posts } = await supabaseAdmin
          .from("posts")
          .select("slug, parent_page_id, updated_at, published_at")
          .eq("status", "published")
          .is("deleted_at", null);
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
