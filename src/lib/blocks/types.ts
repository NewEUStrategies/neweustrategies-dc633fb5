// Block editor (Gutenberg/Foxiz-style) - typy podstawowe.
// Każdy wpis może być serializowany jako BlocksDoc i renderowany publicznie.

export type BlockType =
  | "paragraph"
  | "heading"
  | "image"
  | "list"
  | "quote"
  | "code"
  | "embed"
  | "video"
  | "gallery"
  | "separator"
  | "callout"
  | "table"
  | "button"
  | "columns"
  | "html"
  | "liveblog"
  // Foxiz-style extended blocks
  | "review"
  | "proscons"
  | "spoiler"
  | "faq"
  | "toc"
  | "newsletter"
  | "affiliate"
  | "xquote"
  | "compare"
  // Auth/form blocks (strukturalne - zamiast raw HTML)
  | "login-form"
  | "register-form"
  | "lost-password-form"
  | "reset-password-form"
  // Gutenberg core - batch 1
  | "audio"
  | "cover"
  | "file"
  | "media-text"
  | "group"
  | "spacer"
  | "page-break"
  | "read-more"
  | "pullquote"
  | "preformatted"
  | "verse"
  | "details"
  // Gutenberg core - batch 2 (layout + widgets)
  | "row"
  | "stack"
  | "grid"
  | "buttons"
  | "social-icons"
  | "search"
  | "latest-posts"
  // Gutenberg core - batch 3 (taxonomy + widgets)
  | "tag-cloud"
  | "categories-list"
  | "archives"
  | "calendar"
  // Phase 2 - theme/post blocks
  | "post-title"
  | "post-date"
  | "post-author"
  | "post-excerpt"
  | "post-featured-image"
  | "post-terms"
  | "site-title"
  | "site-tagline"
  | "site-logo"
  // Phase 2 - navigation & loops
  | "navigation"
  | "post-navigation-link"
  | "query-loop"
  // Phase 2 - post utilities
  | "breadcrumbs"
  | "reading-time"
  | "share-buttons"
  | "post-views"
  | "author-bio"
  | "related-posts"
  // Phase 3 - Foxiz/Ruby custom
  | "post-stats"
  | "post-rating"
  | "loginout"
  | "more-posts"
  // Phase 4 - interactive
  | "accordion"
  | "tabs"
  | "countdown"
  | "progress"
  // Phase 4 - presentation
  | "icon-box"
  | "stats-counter"
  | "testimonials"
  | "pricing-table"
  | "timeline"
  // Phase 4 - marketing/sections
  | "hero"
  | "cta-section"
  | "image-carousel"
  | "contact-form"
  | "map"
  // Phase 4 - data + social proof
  | "team-grid"
  | "logo-grid"
  | "feature-grid"
  | "alert-banner"
  | "divider-text"
  // Phase 4 - konwersja / SEO
  | "step-list"
  | "comparison-table"
  | "banner-image"
  | "video-hero";




export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json };

export interface BlockStyle {
  align?: "left" | "center" | "right" | "wide" | "full";
  marginTop?: number;   // px
  marginBottom?: number;
}

export interface Block {
  id: string;
  type: BlockType;
  /** Dane lokalne dla każdego typu - kształt definiuje rejestr. */
  data: Record<string, Json>;
  style?: BlockStyle;
}

export interface BlocksDoc {
  version: 1;
  blocks: Block[];
  /** Opcjonalne metadane (np. ostrzeżenia z migracji). */
  meta?: Record<string, Json>;
}

export const EMPTY_BLOCKS_DOC: BlocksDoc = { version: 1, blocks: [] };

export function newBlockId(): string {
  // krótki, czytelny id (bez zależności od uuid)
  return "b_" + Math.random().toString(36).slice(2, 10);
}

/** Per-language content split - taka sama strategia jak w content_pl/en. */
export interface LocalizedBlocks {
  pl: BlocksDoc;
  en: BlocksDoc;
}
