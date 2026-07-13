// Dynamic sitemap for crawlers. Pulls all published pages + posts and
// emits absolute URLs derived from the incoming request host (works on
// preview, custom domain and prod without baking a placeholder URL).
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { requestPublicHost } from "@/lib/http/requestHost";
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

function requestContext(): { origin: string; host: string } {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = requestPublicHost(req) ?? "";
  return { origin: host ? `${proto}://${host}` : "", host };
}

// Paths of ALL published pages (a noindex page still parents indexable posts,
// so it stays in the path map) + the set of page ids excluded from their own
// sitemap entry via the per-page `seo_noindex` flag. Service-role read -
// bypasses RLS - so it is explicitly scoped to the host's tenant.
async function buildPagePaths(
  tenantId: string,
): Promise<{ paths: Map<string, string>; noindex: Set<string> }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("pages")
    .select("id, seo_noindex")
    .eq("tenant_id", tenantId)
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
        const { origin, host } = requestContext();

        // FAIL-CLOSED: a host no tenant has claimed (and that is not a
        // preview host) must not advertise anyone's URLs - answer 404 rather
        // than map the default tenant's content onto a foreign domain.
        const { resolveCrawlerTenantIdForHost } = await import("@/lib/server/tenant.server");
        const tenantId = await resolveCrawlerTenantIdForHost(host);
        if (!tenantId) {
          return new Response("Unknown host", { status: 404 });
        }

        const entries: SitemapEntry[] = [
          { loc: `${origin}/`, changefreq: "daily", priority: "1.0" },
          { loc: `${origin}/blog`, changefreq: "daily", priority: "0.8" },
          { loc: `${origin}/podcasts`, changefreq: "weekly", priority: "0.6" },
          { loc: `${origin}/web-stories`, changefreq: "weekly", priority: "0.6" },
          { loc: `${origin}/live`, changefreq: "daily", priority: "0.6" },
          // Community surfaces - indexable, previously absent from the sitemap.
          { loc: `${origin}/events`, changefreq: "daily", priority: "0.7" },
          { loc: `${origin}/qa`, changefreq: "weekly", priority: "0.6" },
          { loc: `${origin}/polls`, changefreq: "weekly", priority: "0.5" },
          { loc: `${origin}/tracker`, changefreq: "daily", priority: "0.7" },
          { loc: `${origin}/programs`, changefreq: "weekly", priority: "0.7" },
          { loc: `${origin}/people`, changefreq: "weekly", priority: "0.5" },
          { loc: `${origin}/experts`, changefreq: "weekly", priority: "0.7" },
          { loc: `${origin}/contribute`, changefreq: "monthly", priority: "0.4" },
          { loc: `${origin}/sitemap`, changefreq: "weekly", priority: "0.3" },
        ];

        // Crawler surfaces degrade, never 500: on a DB failure the sitemap
        // still serves the static entries instead of poisoning the crawl.
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { paths: pagePaths, noindex: noindexPages } = await buildPagePaths(tenantId);
          for (const [id, path] of pagePaths) {
            // Pages marked noindex are excluded - a sitemap must not advertise
            // URLs the robots meta asks crawlers to skip.
            if (noindexPages.has(id)) continue;
            entries.push({ loc: `${origin}/${path}`, changefreq: "weekly", priority: "0.6" });
          }

          const { data: posts } = await supabaseAdmin
            .from("posts")
            .select("slug, parent_page_id, updated_at, published_at")
            .eq("tenant_id", tenantId)
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

          // Published podcast programs (series) - each program has its own page.
          const { data: shows } = await supabaseAdmin
            .from("podcast_shows")
            .select("slug, updated_at")
            .eq("tenant_id", tenantId)
            .eq("status", "published")
            .is("deleted_at", null);
          for (const row of shows ?? []) {
            const sh = row as { slug: string; updated_at: string | null };
            entries.push({
              loc: `${origin}/podcasts/${sh.slug}`,
              lastmod: (sh.updated_at ?? "").slice(0, 10) || undefined,
              changefreq: "weekly",
              priority: "0.6",
            });
          }

          // Published podcast episodes - previously absent from the sitemap, so
          // crawlers had no way to discover them.
          const { data: podcasts } = await supabaseAdmin
            .from("podcasts")
            .select("slug, updated_at, published_at")
            .eq("tenant_id", tenantId)
            .eq("status", "published")
            .is("deleted_at", null);
          for (const row of podcasts ?? []) {
            const ep = row as {
              slug: string;
              updated_at: string | null;
              published_at: string | null;
            };
            entries.push({
              loc: `${origin}/podcast/${ep.slug}`,
              lastmod: (ep.updated_at ?? ep.published_at ?? "").slice(0, 10) || undefined,
              changefreq: "monthly",
              priority: "0.6",
            });
          }

          // Published research programs (specialization landing pages).
          const { data: programs } = await supabaseAdmin
            .from("research_programs")
            .select("slug, updated_at, created_at")
            .eq("tenant_id", tenantId)
            .eq("status", "published");
          for (const row of programs ?? []) {
            const pr = row as {
              slug: string;
              updated_at: string | null;
              created_at: string | null;
            };
            entries.push({
              loc: `${origin}/programs/${pr.slug}`,
              lastmod: (pr.updated_at ?? pr.created_at ?? "").slice(0, 10) || undefined,
              changefreq: "weekly",
              priority: "0.6",
            });
          }

          // Published web stories - previously absent from the sitemap, so
          // crawlers had no way to discover them.
          const { data: stories } = await supabaseAdmin
            .from("web_stories")
            .select("slug, updated_at, published_at")
            .eq("tenant_id", tenantId)
            .eq("status", "published");
          for (const row of stories ?? []) {
            const s = row as {
              slug: string;
              updated_at: string | null;
              published_at: string | null;
            };
            entries.push({
              loc: `${origin}/web-stories/${s.slug}`,
              lastmod: (s.updated_at ?? s.published_at ?? "").slice(0, 10) || undefined,
              changefreq: "monthly",
              priority: "0.5",
            });
          }

          // Published EU policy tracker dossiers - the tracker positions
          // itself as a source of truth; each dossier is an indexable page.
          const { data: dossiers } = await supabaseAdmin
            .from("eu_policy_items")
            .select("slug, updated_at, created_at")
            .eq("tenant_id", tenantId)
            .eq("status", "published");
          for (const row of dossiers ?? []) {
            const d = row as {
              slug: string;
              updated_at: string | null;
              created_at: string | null;
            };
            entries.push({
              loc: `${origin}/tracker/${d.slug}`,
              lastmod: (d.updated_at ?? d.created_at ?? "").slice(0, 10) || undefined,
              changefreq: "weekly",
              priority: "0.6",
            });
          }

          // Published community events - indexable detail pages with dates.
          const { data: eventRows } = await supabaseAdmin
            .from("events")
            .select("slug, updated_at, created_at")
            .eq("tenant_id", tenantId)
            .eq("status", "published");
          for (const row of eventRows ?? []) {
            const ev = row as {
              slug: string;
              updated_at: string | null;
              created_at: string | null;
            };
            entries.push({
              loc: `${origin}/events/${ev.slug}`,
              lastmod: (ev.updated_at ?? ev.created_at ?? "").slice(0, 10) || undefined,
              changefreq: "weekly",
              priority: "0.6",
            });
          }

          // Huby ekspertów - profile z odznaką 'expert' i publicznym profilem
          // autorskim są pełnoprawnymi landing page (indeksowalne).
          const { data: expertBadges } = await supabaseAdmin
            .from("profile_badges")
            .select("user_id")
            .eq("tenant_id", tenantId)
            .eq("badge", "expert");
          const expertIds = Array.from(
            new Set((expertBadges ?? []).map((b) => (b as { user_id: string }).user_id)),
          );
          if (expertIds.length > 0) {
            const [{ data: expertProfiles }, { data: publicAps }] = await Promise.all([
              supabaseAdmin.from("profiles").select("id, slug, updated_at").in("id", expertIds),
              supabaseAdmin
                .from("author_profiles")
                .select("user_id, is_public")
                .in("user_id", expertIds),
            ]);
            const publicIds = new Set(
              (publicAps ?? [])
                .filter((a) => (a as { is_public: boolean }).is_public)
                .map((a) => (a as { user_id: string }).user_id),
            );
            for (const row of expertProfiles ?? []) {
              const pr = row as { id: string; slug: string | null; updated_at: string | null };
              if (!pr.slug || !publicIds.has(pr.id)) continue;
              entries.push({
                loc: `${origin}/author/${pr.slug}`,
                lastmod: (pr.updated_at ?? "").slice(0, 10) || undefined,
                changefreq: "weekly",
                priority: "0.7",
              });
            }
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
            // Zawsze rewaliduj u klienta; CDN trzyma świeżą kopię przez 60s,
            // stare zwracane jako fallback do 30 min - dzięki temu zmiany SEO
            // (nowy wpis, seo_noindex, redirect) propagują się bez ręcznego
            // odswieżania cache.
            "Cache-Control":
              "public, max-age=0, s-maxage=60, stale-while-revalidate=1800, must-revalidate",
          },
        });
      },
    },
  },
});
