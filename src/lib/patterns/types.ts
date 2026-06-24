// Pattern library types. A pattern is a ready-to-use starter for a page or post.
// Stored in code (not the DB) so the catalog ships out of the box and can be
// updated without migrations.
import type { BuilderDocument } from "@/lib/builder/types";

export type PatternKind = "page" | "post";

export interface PatternI18nText {
  pl: string;
  en: string;
}

export interface PatternBase {
  /** Stable identifier for analytics + selection. */
  id: string;
  kind: PatternKind;
  /** Visual category surfaced as a filter chip. */
  category: "landing" | "about" | "article" | "longform" | "contact" | "pricing" | "blog";
  name: PatternI18nText;
  description: PatternI18nText;
  /** Optional preview thumbnail. When absent, we render the live document. */
  thumbnail?: string;
  /** Default title applied to the new page/post (pre-fill for i18n editing). */
  defaultTitle: PatternI18nText;
  /** Optional default excerpt (used for posts/SEO meta). */
  defaultExcerpt?: PatternI18nText;
}

export interface PagePattern extends PatternBase {
  kind: "page";
  /** Initial builder document applied to the page on apply(). */
  builder: BuilderDocument;
}

export interface PostPattern extends PatternBase {
  kind: "post";
  /** Raw HTML body (PL + EN) for the post editor. */
  content: PatternI18nText;
}

export type Pattern = PagePattern | PostPattern;
