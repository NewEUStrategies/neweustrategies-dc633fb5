// Dynamic robots.txt.
// - On canonical brand hosts: allow indexing + advertise every sitemap surface.
// - On legacy Lovable preview / worker hosts: fully disallow, so search
//   engines drop cached *.lovable.app / <uuid>.lovableproject.com URLs.
// - On unknown hosts: safe default of full disallow.
//
// Do 2026-08-03 deklarowana była JEDNA sitemapa (/sitemap.xml), więc
// /news-sitemap.xml - trasa istniejąca i wymagana przez Google News - nie był
// odkrywalny ŻADNYM kanałem: ani z robots.txt, ani z indeksu (indeksu nie było).
// Teraz robots.txt ogłasza indeks + news sitemap, a treść składa czysty builder
// (@/lib/seo/robots), objęty testem kontraktu.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { buildRobotsTxt } from "@/lib/seo/robots";
import { parseSeoSettings } from "@/lib/seo/settings";

const CANONICAL_ORIGIN = "https://neweuropeanstrategies.com";
const CANONICAL_HOSTS = new Set(["neweuropeanstrategies.com", "www.neweuropeanstrategies.com"]);

function isLegacyPublicHost(host: string): boolean {
  if (!host) return false;
  return (
    host.endsWith(".lovable.app") ||
    host.endsWith(".lovableproject.com") ||
    host.endsWith(".pages.dev") ||
    host.endsWith(".workers.dev")
  );
}

function isEditorOrLocal(host: string): boolean {
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (host.endsWith(".localhost")) return true;
  if (host.endsWith(".lovable.dev")) return true;
  if (host.startsWith("id-preview--")) return true;
  return false;
}

/**
 * Sitemapy do ogłoszenia. Indeks jest zawsze; news sitemap tylko gdy redakcja
 * ma go włączonego - trasa odpowiada wtedy 404, a robots.txt kierujący crawlera
 * na 404 to gotowy błąd w raporcie Search Console. Odczyt ustawień jest
 * best-effort: przy awarii zostaje sam indeks (crawl działa dalej).
 */
async function sitemapPathsFor(host: string): Promise<string[]> {
  const paths = ["/sitemap.xml"];
  try {
    const { resolveCrawlerTenantIdForHost } = await import("@/lib/server/tenant.server");
    const tenantId = await resolveCrawlerTenantIdForHost(host);
    if (!tenantId) return paths;
    const { fetchSeoSettingsValue } = await import("@/lib/server/publishedContent.server");
    const settings = parseSeoSettings(await fetchSeoSettingsValue(tenantId));
    if (settings.news_sitemap_enabled) paths.push("/news-sitemap.xml");
  } catch (e) {
    console.warn("[seo] robots.txt sitemap settings unavailable:", e);
  }
  return paths;
}

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const req = getRequest();
        const host = (await trustedPublicHost(req)) ?? "";
        const canonical = CANONICAL_HOSTS.has(host);

        const body = buildRobotsTxt({
          mode: canonical
            ? "canonical"
            : isEditorOrLocal(host) || isLegacyPublicHost(host)
              ? "legacy"
              : "unknown",
          origin: CANONICAL_ORIGIN,
          sitemapPaths: canonical ? await sitemapPathsFor(host) : [],
        });

        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            "X-Robots-Tag": canonical ? "all" : "noindex, nofollow",
          },
        });
      },
    },
  },
});
