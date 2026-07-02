// Site-wide SEO / GEO / AEO settings, stored as one JSON blob under the
// site_settings key "seo". One Zod schema + defaults shared by the admin
// screen (useSettings), the public head() (resolveSetting on the bulk map) and
// the server routes (robots.txt, feeds, news sitemap), so every consumer
// agrees on shape and fallbacks.
import { z } from "zod";
import { SITE_NAME } from "@/lib/seo/meta";

export const SEO_SETTINGS_KEY = "seo";

/**
 * AI/LLM crawlers relevant to Generative Engine Optimization. Search-assistant
 * crawlers (OAI-SearchBot, PerplexityBot, ClaudeBot) drive citations and
 * zero-click brand visibility; training crawlers (GPTBot, CCBot, ...) only
 * feed model training. The policy lets a publisher stay visible in AI answers
 * while opting out of training if that is the editorial stance.
 */
export const AI_SEARCH_CRAWLERS: readonly string[] = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "DuckAssistBot",
];

export const AI_TRAINING_CRAWLERS: readonly string[] = [
  "GPTBot",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "meta-externalagent",
  "Amazonbot",
  "cohere-training-data-crawler",
];

export const SeoSettingsSchema = z.object({
  /** Append " - <site name>" to derived document titles. */
  title_suffix_enabled: z.boolean(),
  /** Custom suffix; empty falls back to the site name. */
  title_suffix: z.string().max(120),
  /** Site-wide RSS feeds (/rss.xml, /en/rss.xml). */
  rss_enabled: z.boolean(),
  rss_item_count: z.number().int().min(5).max(100),
  /** Google News sitemap (/news-sitemap.xml). */
  news_sitemap_enabled: z.boolean(),
  /** Stable publication name for <news:name>; empty falls back to site name. */
  news_publication_name: z.string().max(120),
  /** llms.txt - the site guide for AI assistants (GEO). */
  llms_txt_enabled: z.boolean(),
  /** Allow AI SEARCH crawlers (citations / AI answers). Keep on for GEO. */
  ai_search_crawlers_allowed: z.boolean(),
  /** Allow AI TRAINING crawlers (model training, no citation value). */
  ai_training_crawlers_allowed: z.boolean(),
  /** Organization sameAs profile URLs (one per line in the admin). */
  organization_same_as: z.array(z.string().url().max(500)).max(20),
  /** Publisher logo for NewsArticle/Organization JSON-LD (~600x60 or square). */
  publisher_logo_url: z.string().max(2048),
  /** Optional X/Twitter handle ("@brand") for twitter:site. */
  twitter_site: z.string().max(60),
});

export type SeoSettings = z.infer<typeof SeoSettingsSchema>;

export const DEFAULT_SEO_SETTINGS: SeoSettings = {
  title_suffix_enabled: true,
  title_suffix: "",
  rss_enabled: true,
  rss_item_count: 30,
  news_sitemap_enabled: true,
  news_publication_name: "",
  llms_txt_enabled: true,
  ai_search_crawlers_allowed: true,
  ai_training_crawlers_allowed: true,
  organization_same_as: [],
  publisher_logo_url: "",
  twitter_site: "",
};

/** Effective <title> suffix (null = disabled). */
export function effectiveTitleSuffix(settings: SeoSettings): string | null {
  if (!settings.title_suffix_enabled) return null;
  return settings.title_suffix.trim() || SITE_NAME;
}

/** Effective Google News publication name. */
export function effectiveNewsPublicationName(settings: SeoSettings): string {
  return settings.news_publication_name.trim() || SITE_NAME;
}

/**
 * Parse an unknown site_settings value into SeoSettings, tolerating partial
 * blobs (deep-merged over defaults) and falling back to defaults entirely on
 * shape errors - a corrupted row must never take rendering down.
 */
export function parseSeoSettings(raw: unknown): SeoSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SEO_SETTINGS;
  const merged = { ...DEFAULT_SEO_SETTINGS, ...(raw as Record<string, unknown>) };
  const parsed = SeoSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SEO_SETTINGS;
}

/** robots.txt directive blocks for the AI-crawler policy. */
export function aiCrawlerDirectives(settings: SeoSettings): string[] {
  const lines: string[] = [];
  const block = (agents: readonly string[]) => {
    for (const agent of agents) {
      lines.push(`User-agent: ${agent}`);
    }
    lines.push("Disallow: /", "");
  };
  if (!settings.ai_search_crawlers_allowed) block(AI_SEARCH_CRAWLERS);
  if (!settings.ai_training_crawlers_allowed) block(AI_TRAINING_CRAWLERS);
  return lines;
}
