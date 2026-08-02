// Dynamic sitemap for crawlers. Pulls all published pages + posts and
// emits absolute URLs derived from the incoming request host (works on
// preview, custom domain and prod without baking a placeholder URL).
//
// Każdy adres przechodzi przez indeks przekierowań tenanta, więc sitemapa
// publikuje wyłącznie docelowe, kanoniczne URL-e (bez 301/410), a dokument
// dostaje osobne wpisy PL i EN z pełnym, wzajemnym klastrem hreflang.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import {
  DEFAULT_LANG,
  SUPPORTED_LANGS,
  localizedPath,
  stripLangPrefix,
} from "@/lib/i18n/localePath";
import { sitemapLanguageUrls } from "@/lib/seo/sitemapUrls";
import type { RedirectIndex } from "@/lib/seo/redirects";

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

const CANONICAL_ORIGIN = "https://neweuropeanstrategies.com";
const CANONICAL_HOSTS = new Set(["neweuropeanstrategies.com", "www.neweuropeanstrategies.com"]);
function isLegacyPublicHost(host: string): boolean {
  if (!host || CANONICAL_HOSTS.has(host)) return false;
  return (
    host.endsWith(".lovable.app") ||
    host.endsWith(".lovableproject.com") ||
    host.endsWith(".pages.dev") ||
    host.endsWith(".workers.dev")
  );
}

async function requestContext(): Promise<{ origin: string; host: string; legacy: boolean }> {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = (await trustedPublicHost(req)) ?? "";
  const legacy = isLegacyPublicHost(host);
  // Legacy / canonical brand hosts always emit URLs on the canonical origin
  // so search engines converge on neweuropeanstrategies.com regardless of
  // which alias served the sitemap request.
  const origin =
    legacy || CANONICAL_HOSTS.has(host) ? CANONICAL_ORIGIN : host ? `${proto}://${host}` : "";
  return { origin, host, legacy };
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
        const { origin, host } = await requestContext();

        // FAIL-CLOSED: a host no tenant has claimed (and that is not a
        // preview host) must not advertise anyone's URLs - answer 404 rather
        // than map the default tenant's content onto a foreign domain.
        // DEGRADACJA ≠ fail-closed: gdy tenanta nie ma, bo katalog domen jest
        // pusty/nieosiągalny albo host jest podglądowy/lokalny (dev, e2e z
        // placeholderowym Supabase), crawler dostaje statyczny szkielet mapy
        // zamiast 404 - nie ma tu żadnej cudzej treści do wycieku.
        const { resolveCrawlerTenantIdForHost, crawlerDegradeIsSafe } =
          await import("@/lib/server/tenant.server");
        const tenantId = await resolveCrawlerTenantIdForHost(host);
        if (!tenantId && !(await crawlerDegradeIsSafe(host))) {
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
        // Bez tenanta (tryb degradacji powyżej) sekcja dynamiczna nie ma
        // czego czytać - zostaje sam statyczny szkielet.
        try {
          if (!tenantId) throw new Error("degraded: no tenant directory");
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

          // Category and tag archive pages are independently indexable and
          // carry their own localized metadata, breadcrumbs and CollectionPage schema.
          const [{ data: categories }, { data: tags }] = await Promise.all([
            supabaseAdmin.from("categories").select("slug, created_at").eq("tenant_id", tenantId),
            supabaseAdmin.from("tags").select("slug, created_at").eq("tenant_id", tenantId),
          ]);
          for (const row of categories ?? []) {
            const category = row as { slug: string; created_at: string | null };
            entries.push({
              loc: `${origin}/category/${category.slug}`,
              lastmod: (category.created_at ?? "").slice(0, 10) || undefined,
              changefreq: "weekly",
              priority: "0.6",
            });
          }
          for (const row of tags ?? []) {
            const tag = row as { slug: string; created_at: string | null };
            entries.push({
              loc: `${origin}/tag/${tag.slug}`,
              lastmod: (tag.created_at ?? "").slice(0, 10) || undefined,
              changefreq: "weekly",
              priority: "0.5",
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

          // Publiczne sesje Q&A (poza szkicami) - strony z markupem QAPage,
          // więc muszą być odkrywalne dla crawlerów.
          const { data: qaSessions } = await supabaseAdmin
            .from("qa_sessions")
            .select("slug, updated_at, opens_at")
            .eq("tenant_id", tenantId)
            .neq("status", "draft");
          for (const row of qaSessions ?? []) {
            const qa = row as { slug: string; updated_at: string | null; opens_at: string | null };
            entries.push({
              loc: `${origin}/qa/${qa.slug}`,
              lastmod: (qa.updated_at ?? qa.opens_at ?? "").slice(0, 10) || undefined,
              changefreq: "weekly",
              priority: "0.5",
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

        // Indeks przekierowań tenanta: sitemapa publikuje adres docelowy, nie
        // ten, który zaraz odpowie 301/410. Degraduje się do braku kanonizacji,
        // gdy warstwa danych nie odpowiada.
        // W trybie degradacji (brak tenanta - host podglądowy albo niedostępny
        // katalog domen) nie ma czego kanonizować: zostaje sam statyczny
        // szkielet, więc indeks przekierowań po prostu pomijamy.
        let redirectIndex: RedirectIndex | null = null;
        if (tenantId) {
          try {
            const { getRedirectIndexForTenant } = await import("@/lib/seo/redirects.server");
            redirectIndex = await getRedirectIndexForTenant(tenantId);
          } catch (e) {
            console.warn("[seo] sitemap redirect index unavailable:", e);
          }
        }

        const sameOriginHosts = [...CANONICAL_HOSTS, host].filter(Boolean);
        const seen = new Set<string>();
        const urlBlocks: string[] = [];
        for (const entry of entries) {
          const path = entry.loc.startsWith(origin) ? entry.loc.slice(origin.length) : entry.loc;
          for (const variant of sitemapLanguageUrls(
            origin,
            path || "/",
            redirectIndex,
            sameOriginHosts,
          )) {
            if (seen.has(variant.loc)) continue;
            seen.add(variant.loc);
            urlBlocks.push(
              [
                "  <url>",
                `    <loc>${xmlEscape(variant.loc)}</loc>`,
                ...variant.alternates.map(
                  (a) =>
                    `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${xmlEscape(a.href)}"/>`,
                ),
                entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>` : null,
                entry.changefreq ? `    <changefreq>${entry.changefreq}</changefreq>` : null,
                entry.priority ? `    <priority>${entry.priority}</priority>` : null,
                "  </url>",
              ]
                .filter(Boolean)
                .join("\n"),
            );
          }
        }

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`,
          ...urlBlocks,
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
