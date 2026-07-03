// Runtime validation + normalization of a BuilderDocument coming across a trust
// boundary (builder_data JSONB from the DB, payloads received by server fns).
//
// This is the builder-side counterpart to `safeParseBlocks` for the blocks
// engine. Where the blocks schema is all-or-nothing (one bad block ⇒ empty
// doc), the builder tree is large and authored incrementally, so this parser is
// *coercive and resilient*: it guarantees the structural invariants the public
// renderer relies on (every section/column exposes an array of children, every
// widget has a known `type` and an object `content`, every column has a `span`
// object) and **drops only irrecoverable nodes** instead of discarding the
// whole page. Cosmetic fields (style, advanced, layout, background, overlay,
// border, typography, shape dividers, …) are passed through untouched — the
// renderer already sanitizes every user string at render time, so re-validating
// them here would risk stripping legitimate styling.
import type {
  BuilderDocument,
  SectionNode,
  ColumnNode,
  InnerSectionNode,
  WidgetNode,
  WidgetContent,
  WidgetType,
  ResponsiveValue,
} from "./types";
import { emptyDocument } from "./types";

// Canonical, ordered list of every widget type the renderer understands. Kept
// in lockstep with the `WidgetType` union (compile-time assertions below) and
// with the runtime registry (a drift test in schema.test.ts compares the two).
export const WIDGET_TYPES = [
  // Basic
  "heading",
  "text",
  "image",
  "button",
  "divider",
  "spacer",
  // Media
  "video",
  "gallery",
  "icon",
  "map",
  "tts",
  // Dynamic
  "post-list",
  "carousel",
  "categories",
  "tags",
  // Forms
  "newsletter",
  "contact",
  "cta",
  "join-us",
  "customize-interests",
  // Navigation
  "nav-link",
  "mega-menu",
  // Site chrome
  "social-icons",
  "lang-switcher",
  "theme-toggle",
  "account-link",
  "search-button",
  "copyright",
  // Rich blocks
  "accordion",
  "tabs",
  "testimonial",
  "pricing",
  // Rich content (embeds the blocks engine)
  "rich-text",
  // Home-page building blocks
  "section-label",
  "hot-topic-bar",
  "rated-list",
  "dark-featured-card",
  // Slider
  "slider",
  // Animated heading
  "animated-heading",
  // Advertising
  "ad-slot",
  // News ticker
  "news-ticker",
  // Podcast
  "podcast-latest",
  // Web Stories
  "web-stories-carousel",
  // Auth forms
  "login-form",
  "register-form",
  "lost-password-form",
  "reset-password-form",
  // Dynamic tags
  "post-title",
  "post-meta",
  "post-tags-dyn",
  "post-categories-dyn",
  "post-author-card",
  "post-breadcrumbs",
  "post-cover",
  "post-excerpt",
  "archive-title",
  "search-form",
  "contact-form",
] as const;

// Compile-time guarantee that WIDGET_TYPES and the WidgetType union never drift:
// if a type is added to one but not the other, one of these assignments fails
// to typecheck.
type WidgetTypeFromList = (typeof WIDGET_TYPES)[number];
const _everyUnionMemberIsListed: WidgetType extends WidgetTypeFromList ? true : never = true;
const _everyListedMemberIsInUnion: WidgetTypeFromList extends WidgetType ? true : never = true;
void _everyUnionMemberIsListed;
void _everyListedMemberIsInUnion;

const WIDGET_TYPE_SET: ReadonlySet<string> = new Set(WIDGET_TYPES);

export function isKnownWidgetType(type: unknown): type is WidgetType {
  return typeof type === "string" && WIDGET_TYPE_SET.has(type);
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function asArray(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

/**
 * Node id, or a synthesized fallback for legacy/imported nodes saved without
 * one. The fallback is derived from the node's POSITION in the document (not
 * `newId()`): parsing runs independently on the server and in the browser, and
 * a random id would make the SSR HTML disagree with the client render - React
 * then throws the whole hydrated tree away and re-renders from scratch.
 */
function takeId(raw: Record<string, unknown>, path: string): string {
  return typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `auto-${path}`;
}

/** ResponsiveValue<number> guard: keep only the numeric breakpoint keys. */
function coerceSpan(raw: unknown): ResponsiveValue<number> {
  if (!isObject(raw)) return {};
  const out: ResponsiveValue<number> = {};
  if (typeof raw.desktop === "number") out.desktop = raw.desktop;
  if (typeof raw.tablet === "number") out.tablet = raw.tablet;
  if (typeof raw.mobile === "number") out.mobile = raw.mobile;
  return out;
}

function coerceWidget(raw: unknown, path: string): WidgetNode | null {
  if (!isObject(raw)) return null;
  // Unknown widget types are dropped: the renderer would render nothing for
  // them anyway, and shipping them risks a future eager switch arm crashing on
  // unexpected content.
  if (!isKnownWidgetType(raw.type)) return null;
  const content: WidgetContent = isObject(raw.content) ? (raw.content as WidgetContent) : {};
  return { ...raw, id: takeId(raw, path), kind: "widget", type: raw.type, content } as WidgetNode;
}

function coerceColumn(raw: unknown, path: string): ColumnNode | null {
  if (!isObject(raw)) return null;
  const children = asArray(raw.children)
    .map((child, i) => coerceWidget(child, `${path}.w${i}`))
    .filter((w): w is WidgetNode => w !== null);
  return {
    ...raw,
    id: takeId(raw, path),
    kind: "column",
    span: coerceSpan(raw.span),
    children,
  } as ColumnNode;
}

function coerceInnerSection(raw: Record<string, unknown>, path: string): InnerSectionNode {
  const columns = asArray(raw.columns)
    .map((col, i) => coerceColumn(col, `${path}.c${i}`))
    .filter((c): c is ColumnNode => c !== null);
  return { ...raw, id: takeId(raw, path), kind: "inner-section", columns } as InnerSectionNode;
}

function coerceSectionChild(raw: unknown, path: string): ColumnNode | InnerSectionNode | null {
  if (!isObject(raw)) return null;
  // Distinguish inner-sections from columns by their discriminator or shape:
  // an inner-section nests `columns`; a column nests widget `children`.
  if (
    raw.kind === "inner-section" ||
    (Array.isArray(raw.columns) && !Array.isArray(raw.children))
  ) {
    return coerceInnerSection(raw, path);
  }
  return coerceColumn(raw, path);
}

function coerceSection(raw: unknown, path: string): SectionNode | null {
  if (!isObject(raw)) return null;
  const children = asArray(raw.children)
    .map((child, i) => coerceSectionChild(child, `${path}.c${i}`))
    .filter((c): c is ColumnNode | InnerSectionNode => c !== null);
  return { ...raw, id: takeId(raw, path), kind: "section", children } as SectionNode;
}

/**
 * Coerce arbitrary JSON into a renderable BuilderDocument. Returns an empty doc
 * for a non-object, the wrong `version`, or a missing/invalid `sections` array
 * (preserving the historical `parseBuilderDoc` contract); otherwise normalizes
 * every node and drops only the irrecoverable ones.
 */
export function safeParseBuilderDoc(raw: unknown): BuilderDocument {
  if (!isObject(raw)) return emptyDocument();
  if (raw.version !== 1 || !Array.isArray(raw.sections)) return emptyDocument();
  const sections = raw.sections
    .map((section, i) => coerceSection(section, `s${i}`))
    .filter((s): s is SectionNode => s !== null);
  return { version: 1, sections };
}

/** Strict check: is this already a structurally valid, render-safe document? */
export function isBuilderDoc(value: unknown): value is BuilderDocument {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.sections)) return false;
  return value.sections.every(
    (s) =>
      isObject(s) &&
      Array.isArray((s as { children?: unknown }).children) &&
      (s as { children: unknown[] }).children.every((c) => {
        if (!isObject(c)) return false;
        if (c.kind === "inner-section") return Array.isArray((c as { columns?: unknown }).columns);
        return (
          Array.isArray((c as { children?: unknown }).children) &&
          (c as { children: unknown[] }).children.every(
            (w) => isObject(w) && isKnownWidgetType((w as { type?: unknown }).type),
          )
        );
      }),
  );
}
