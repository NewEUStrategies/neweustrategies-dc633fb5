// Web Stories domain types + zod schema for `pages` JSON column.
import { z } from "zod";

export type WebStoryStatus = "draft" | "published" | "archived";

export const StoryPageSchema = z.object({
  id: z.string(),
  background: z.enum(["image", "video", "color"]).default("image"),
  media_url: z.string().default(""),
  poster_url: z.string().default(""),
  color: z.string().default("#131822"),
  title_pl: z.string().default(""),
  title_en: z.string().default(""),
  caption_pl: z.string().default(""),
  caption_en: z.string().default(""),
  cta_label_pl: z.string().default(""),
  cta_label_en: z.string().default(""),
  cta_href: z.string().default(""),
  text_position: z.enum(["top", "center", "bottom"]).default("bottom"),
  text_align: z.enum(["left", "center", "right"]).default("left"),
  duration_seconds: z.number().int().min(2).max(30).default(6),
});
export type StoryPage = z.infer<typeof StoryPageSchema>;

export const StoryPagesSchema = z.array(StoryPageSchema);

export interface WebStory {
  id: string;
  tenant_id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  description_pl: string;
  description_en: string;
  cover_url: string | null;
  pages: StoryPage[];
  status: WebStoryStatus;
  published_at: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export function newStoryPage(): StoryPage {
  return StoryPageSchema.parse({
    id: `p_${Math.random().toString(36).slice(2, 10)}`,
  });
}

export function storyTitle(s: Pick<WebStory, "title_pl" | "title_en">, lang: "pl" | "en"): string {
  return (lang === "en" ? s.title_en || s.title_pl : s.title_pl || s.title_en) || "";
}

export function storyDescription(
  s: Pick<WebStory, "description_pl" | "description_en">,
  lang: "pl" | "en",
): string {
  return (
    (lang === "en" ? s.description_en || s.description_pl : s.description_pl || s.description_en) ||
    ""
  );
}

export function pageTitle(p: StoryPage, lang: "pl" | "en"): string {
  return (lang === "en" ? p.title_en || p.title_pl : p.title_pl || p.title_en) || "";
}
export function pageCaption(p: StoryPage, lang: "pl" | "en"): string {
  return (lang === "en" ? p.caption_en || p.caption_pl : p.caption_pl || p.caption_en) || "";
}
export function pageCtaLabel(p: StoryPage, lang: "pl" | "en"): string {
  return (
    (lang === "en" ? p.cta_label_en || p.cta_label_pl : p.cta_label_pl || p.cta_label_en) || ""
  );
}

export function safeParsePages(input: unknown): StoryPage[] {
  const r = StoryPagesSchema.safeParse(input);
  return r.success ? r.data : [];
}
