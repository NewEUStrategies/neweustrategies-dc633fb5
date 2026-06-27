// Runtime validation of BlocksDoc. Used at trust boundaries
// (server fns receiving blocks_data, public renderer hardening).
import { z } from "zod";
import type { BlocksDoc, Block } from "./types";

const JsonSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonSchema),
    z.record(z.string(), JsonSchema),
  ]),
);

const BlockStyleSchema = z.object({
  align: z.enum(["left", "center", "right", "wide", "full"]).optional(),
  marginTop: z.number().int().min(0).max(400).optional(),
  marginBottom: z.number().int().min(0).max(400).optional(),
}).strict();

const BlockSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum([
    "paragraph", "heading", "image", "list", "quote", "code",
    "embed", "video", "gallery", "separator", "callout", "table",
    "button", "columns", "html", "liveblog",
    "review", "proscons", "spoiler", "faq", "toc",
    "newsletter", "affiliate", "xquote", "compare",
    "login-form", "register-form", "lost-password-form", "reset-password-form",
    "audio", "cover", "file", "media-text", "group", "spacer",
    "page-break", "read-more", "pullquote", "preformatted", "verse", "details",
    "row", "stack", "grid", "buttons", "social-icons", "search", "latest-posts",
    "tag-cloud", "categories-list", "archives", "calendar",
    "post-title", "post-date", "post-author", "post-excerpt", "post-featured-image", "post-terms",
    "site-title", "site-tagline", "site-logo",
    "navigation", "post-navigation-link", "query-loop",
    "breadcrumbs", "reading-time", "share-buttons", "post-views",
    "author-bio", "related-posts",
    "post-stats", "post-rating", "loginout", "more-posts",
    "accordion", "tabs", "countdown", "progress",
    "icon-box", "stats-counter", "testimonials", "pricing-table", "timeline",
    "hero", "cta-section", "image-carousel", "contact-form", "map",
    "team-grid", "logo-grid", "feature-grid", "alert-banner", "divider-text",
    "step-list", "comparison-table", "banner-image", "video-hero",



  ]),
  data: z.record(z.string(), JsonSchema),
  style: BlockStyleSchema.optional(),
}).strict();

export const BlocksDocSchema: z.ZodType<BlocksDoc> = z.object({
  version: z.literal(1),
  blocks: z.array(BlockSchema).max(500),
  meta: z.record(z.string(), JsonSchema).optional(),
}).strict() as z.ZodType<BlocksDoc>;

export const LocalizedBlocksSchema = z.object({
  pl: BlocksDocSchema,
  en: BlocksDocSchema,
}).strict();

export function isBlocksDoc(value: unknown): value is BlocksDoc {
  return BlocksDocSchema.safeParse(value).success;
}

export function safeParseBlocks(value: unknown): BlocksDoc {
  const r = BlocksDocSchema.safeParse(value);
  return r.success ? r.data : { version: 1, blocks: [] satisfies Block[] };
}
