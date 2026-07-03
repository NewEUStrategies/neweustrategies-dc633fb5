// Robots policy: allow public crawlers, block admin/auth/api surfaces,
// advertise every crawl surface (sitemap, news sitemap, llms.txt) and apply
// the admin-managed AI-crawler policy (GEO: search-assistant crawlers drive
// AI-answer citations; training crawlers can be opted out independently).
//
// FAIL-CLOSED: a host no tenant has claimed (and that is not a preview host)
// gets a blanket "Disallow: /". Serving an allow-all robots.txt there would
// invite crawlers to index the default tenant's content under a foreign
// domain (duplicate content + cross-tenant exposure). robots.txt itself must
// always answer 200 - a 404 means "allow everything" to crawlers.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { requestPublicHost } from "@/lib/http/requestHost";
import { aiCrawlerDirectives, parseSeoSettings } from "@/lib/seo/settings";
import { fetchSeoSettingsValue } from "@/lib/server/publishedContent.server";
import { resolveCrawlerTenantIdForHost } from "@/lib/server/tenant.server";

const TEXT_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
} as const;

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const req = getRequest();
        const proto = req.headers.get("x-forwarded-proto") ?? "https";
        const host = requestPublicHost(req) ?? "";
        const origin = host ? `${proto}://${host}` : "";
        const tenantId = await resolveCrawlerTenantIdForHost(host);
        if (!tenantId) {
          return new Response("User-agent: *\nDisallow: /\n", { headers: TEXT_HEADERS });
        }
        const settings = parseSeoSettings(await fetchSeoSettingsValue(tenantId));

        const lines: string[] = [
          "User-agent: *",
          "Allow: /",
          "Disallow: /admin",
          "Disallow: /admin/",
          "Disallow: /login",
          "Disallow: /api/",
          "",
          ...aiCrawlerDirectives(settings),
        ];
        if (origin) {
          lines.push(`Sitemap: ${origin}/sitemap.xml`);
          if (settings.news_sitemap_enabled) {
            lines.push(`Sitemap: ${origin}/news-sitemap.xml`);
          }
          if (settings.llms_txt_enabled) {
            lines.push("", `# AI assistants: site guide at ${origin}/llms.txt`);
          }
        }
        const body = lines.join("\n");
        return new Response(body, { headers: TEXT_HEADERS });
      },
    },
  },
});
