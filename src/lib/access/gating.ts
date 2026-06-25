// Pure, framework-free paywall logic. Shared by the SSR content resolver, the
// client unlock hook and the article renderer so the "is this body locked?"
// decision lives in exactly one place and is unit-testable without a DB or DOM.
import type { AccessMode } from "@/hooks/useContentAccess";

/** The gated body columns of a post/page, as returned by `get_entity_content`. */
export interface BodyParts {
  content_pl: string | null;
  content_en: string | null;
  builder_data: unknown;
  blocks_data: unknown;
}

/** Empty body - what an unentitled caller receives from the server. */
export const EMPTY_BODY: BodyParts = {
  content_pl: null,
  content_en: null,
  builder_data: null,
  blocks_data: null,
};

/** `true` for modes that require entitlement (everything except `public`). */
export function isGatedMode(mode: AccessMode | null | undefined): boolean {
  return mode === "members" || mode === "paid";
}

function hasBuilderSections(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const sections = (value as { sections?: unknown }).sections;
  return Array.isArray(sections) && sections.length > 0;
}

function hasBlocks(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  // blocks_data is localized: { pl?: {blocks: [...]}, en?: {blocks: [...]} }.
  return Object.values(value as Record<string, unknown>).some((doc) => {
    if (!doc || typeof doc !== "object") return false;
    const blocks = (doc as { blocks?: unknown }).blocks;
    return Array.isArray(blocks) && blocks.length > 0;
  });
}

/** Whether a body actually carries something renderable in any locale/editor. */
export function hasRenderableBody(body: BodyParts): boolean {
  return (
    !!(body.content_pl && body.content_pl.trim()) ||
    !!(body.content_en && body.content_en.trim()) ||
    hasBuilderSections(body.builder_data) ||
    hasBlocks(body.blocks_data)
  );
}

/**
 * Decide whether the paywall should replace the body.
 *
 * Entitlement is proven by body presence: the server (get_entity_content) only
 * ships a body to an authorized caller, so for gated modes "no renderable body"
 * means "not entitled (yet)". This holds for the anonymous SSR payload, for an
 * unauthorized client, and during the brief window before an entitled body is
 * unlocked client-side. Public content is never gated.
 */
export function shouldShowPaywall(mode: AccessMode | null | undefined, body: BodyParts): boolean {
  if (!isGatedMode(mode)) return false;
  return !hasRenderableBody(body);
}

/**
 * Pick the body to render: a client-unlocked body takes precedence over the
 * (possibly gated/empty) body that arrived from the SSR resolver.
 */
export function pickBody(ssrBody: BodyParts, unlocked: BodyParts | null): BodyParts {
  if (unlocked && hasRenderableBody(unlocked)) return unlocked;
  return ssrBody;
}
