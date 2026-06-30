// Layout-space reservation for ad slots - the core of our zero-CLS strategy.
//
// Cumulative Layout Shift happens when an ad arrives and *pushes* the
// surrounding content. The fix is to reserve the slot's box up-front, before
// any payload loads, so the creative lands into space that was already there.
//
// Strategy, in order of preference:
//   1. width + height known  -> reserve via `aspect-ratio` (responsive: the box
//      keeps the creative's proportions while scaling down on narrow screens,
//      capped at the intrinsic width so it never upscales past the creative).
//   2. height only           -> reserve a `min-height` floor.
//   3. nothing declared      -> fall back to a sensible per-position floor so
//      even un-sized slots hold space instead of collapsing to 0px.

import type { CSSProperties } from "react";
import type { AdPosition } from "./types";

export interface AdDimensions {
  width: number | null;
  height: number | null;
}

/**
 * Per-position fallback heights (px) for slots whose creative has no declared
 * dimensions. Tuned to the common IAB formats each position hosts so the
 * reserved space is close to the eventual creative and the residual shift is
 * negligible.
 */
export const DEFAULT_RESERVE_HEIGHT: Record<AdPosition, number> = {
  header_banner: 90, // leaderboard / 728x90 family
  top_of_post: 250, // medium rectangle / responsive
  mid_post: 250,
  bottom_of_post: 250,
  sidebar: 250,
  in_feed: 250,
  footer_slideup: 90, // anchored bar; fixed-positioned so it never shifts flow
};

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Builds the inline style that reserves a slot's layout box. Always returns a
 * full-width, centered box so the reserved area matches the rendered ad in the
 * responsive grid; the height comes from the best signal available.
 */
export function reserveStyle(dims: AdDimensions, position?: AdPosition): CSSProperties {
  const width = isPositive(dims.width) ? dims.width : null;
  const height = isPositive(dims.height) ? dims.height : null;

  if (width && height) {
    return {
      width: "100%",
      maxWidth: width,
      aspectRatio: `${width} / ${height}`,
    };
  }

  if (height) {
    return {
      width: "100%",
      maxWidth: width ?? undefined,
      minHeight: height,
    };
  }

  const fallback = position ? DEFAULT_RESERVE_HEIGHT[position] : 0;
  return fallback > 0 ? { width: "100%", minHeight: fallback } : { width: "100%" };
}
