// Typy formularza edytora wpisu - wspólny kontrakt trasy admin.posts.$slug
// i hooków/kart edytora (rozbicie monolitu ~1550 linii; zachowanie bez zmian).
import type { BuilderDocument } from "@/lib/builder/types";
import type { LocalizedBlocks } from "@/lib/blocks/types";
import type { LayoutOverrides, PostFormat } from "@/lib/postLayouts";
import type { PostWorkflowStatus } from "@/lib/content/workflow";
import type { TocOverride } from "@/lib/toc/settings";

export type EditorType = "blocks" | "richtext" | "markdown" | "builder";

export interface PostForm {
  id: string;
  slug: string;
  status: PostWorkflowStatus;
  editor: EditorType;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  content_pl: string | null;
  content_en: string | null;
  cover_image_url: string | null;
  audio_url_pl: string | null;
  audio_url_en: string | null;
  read_minutes: number | null;
  published_at: string | null;
  publish_at: string | null;
  builder_data: BuilderDocument | null;
  blocks_data: LocalizedBlocks | null;
  parent_page_id: string;
  post_format: PostFormat;
  layout_overrides: LayoutOverrides | null;
  takeaways_pl: string[];
  takeaways_en: string[];
  takeaways_variant: "card" | "heading" | "ghost" | null;
  toc_override: TocOverride | null;
  custom_meta: Record<string, string> | null;
  related_override: Record<string, unknown> | null;
  seo_title_pl: string | null;
  seo_title_en: string | null;
  seo_description_pl: string | null;
  seo_description_en: string | null;
  seo_canonical_url: string | null;
  seo_noindex: boolean;
  seo_og_image_url: string | null;
  og_image_generated_url: string | null;
}

export interface CategoryOpt {
  id: string;
  name_pl: string;
  name_en: string;
}

export interface TagOpt {
  id: string;
  name: string;
}
