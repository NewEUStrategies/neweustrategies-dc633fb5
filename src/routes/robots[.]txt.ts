// Robots policy: allow public crawlers, block admin/auth/api surfaces,
// advertise every crawl surface (sitemap, news sitemap, llms.txt) and apply
// the admin-managed AI-crawler policy (GEO: search-assistant crawlers drive
// AI-answer citations; training crawlers can be opted out independently).
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { aiCrawlerDirectives, parseSeoSettings } from "@/lib/seo/settings";
import { fetchSeoSettingsValue } from "@/lib/server/publishedContent.server";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const req = getRequest();
        const proto = req.headers.get("x-forwarded-proto") ?? "https";
        const host = req.headers.get("host") ?? "";
        const origin = host ? `${proto}://${host}` : "";
        const settings = parseSeoSettings(await fetchSeoSettingsValue());

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
        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
