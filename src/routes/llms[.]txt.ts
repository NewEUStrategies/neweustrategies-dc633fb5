// llms.txt (llmstxt.org) - the GEO surface: a concise markdown guide served to
// AI assistants and answer engines describing the publication, its sections,
// the freshest articles per language and the machine-readable resources. This
// is how the site earns accurate, canonical citations in AI answers
// (zero-click brand visibility).
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { localizedPath } from "@/lib/i18n/localePath";
import { SITE_DEFAULT_DESCRIPTION, SITE_NAME } from "@/lib/seo/meta";
import { buildLlmsTxt, type LlmsTxtArticle } from "@/lib/seo/llms";
import { parseSeoSettings } from "@/lib/seo/settings";
import {
  fetchPublicCategories,
  fetchPublishedPosts,
  fetchSeoSettingsValue,
} from "@/lib/server/publishedContent.server";

function originFromRequest(): string {
  const req = getRequest();
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "";
  return host ? `${proto}://${host}` : "";
}

const LATEST_COUNT = 15;

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async () => {
        const origin = originFromRequest();
        const settings = parseSeoSettings(await fetchSeoSettingsValue());
        if (!settings.llms_txt_enabled) {
          return new Response("llms.txt disabled", { status: 404 });
        }

        const [posts, categories] = await Promise.all([
          fetchPublishedPosts(LATEST_COUNT * 2),
          fetchPublicCategories(),
        ]);

        const toArticle = (lang: "pl" | "en") =>
          posts
            .filter((p) => (lang === "en" ? p.title_en : p.title_pl))
            .slice(0, LATEST_COUNT)
            .map(
              (p): LlmsTxtArticle => ({
                title: lang === "en" ? p.title_en : p.title_pl,
                url: `${origin}${localizedPath(p.path, lang)}`,
                description: lang === "en" ? p.excerpt_en : p.excerpt_pl,
                publishedAt: p.published_at,
              }),
            );

        const body = buildLlmsTxt({
          siteName: SITE_NAME,
          origin,
          descriptionPl: SITE_DEFAULT_DESCRIPTION.pl,
          descriptionEn: SITE_DEFAULT_DESCRIPTION.en,
          sections: categories.map((c) => ({
            name:
              c.name_pl && c.name_en && c.name_pl !== c.name_en
                ? `${c.name_pl} / ${c.name_en}`
                : c.name_pl || c.name_en,
            url: `${origin}/category/${c.slug}`,
            description: c.description_pl || c.description_en,
          })),
          latestPl: toArticle("pl"),
          latestEn: toArticle("en"),
        });

        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400",
          },
        });
      },
    },
  },
});
