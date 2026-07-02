// Browser-side OG-card renderer: draws the branded 1200x630 card on an
// offscreen <canvas> (Red Hat Display is already loaded by the admin shell's
// @font-face) and uploads the PNG to the public "media" bucket. Runs entirely
// in the editor's browser - zero server/runtime dependencies, works on any
// deployment target. Layout math lives in the pure @/lib/seo/ogCard module.
import { supabase } from "@/integrations/supabase/client";
import {
  layoutOgTitle,
  ogCardStoragePath,
  OG_CARD_COLORS,
  OG_CARD_HEIGHT,
  OG_CARD_PADDING,
  OG_CARD_WIDTH,
  type OgCardInput,
} from "@/lib/seo/ogCard";

const TITLE_FONT = "Red Hat Display";
const FONT_STACK = `"${TITLE_FONT}", "Segoe UI", Arial, sans-serif`;

async function ensureFontsLoaded(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`700 72px "${TITLE_FONT}"`),
      document.fonts.load(`600 28px "${TITLE_FONT}"`),
    ]);
  } catch {
    /* fallback fonts still render a correct card */
  }
}

/** Render the card and return it as a PNG blob. */
export async function renderOgCard(input: OgCardInput): Promise<Blob> {
  await ensureFontsLoaded();
  const canvas = document.createElement("canvas");
  canvas.width = OG_CARD_WIDTH;
  canvas.height = OG_CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // Background + subtle depth gradient.
  const gradient = ctx.createLinearGradient(0, 0, OG_CARD_WIDTH, OG_CARD_HEIGHT);
  gradient.addColorStop(0, OG_CARD_COLORS.background);
  gradient.addColorStop(1, "#1B2230");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, OG_CARD_WIDTH, OG_CARD_HEIGHT);

  // Brand accent bar (left edge) + oversized corner glyph for recognition.
  ctx.fillStyle = OG_CARD_COLORS.accent;
  ctx.fillRect(0, 0, 14, OG_CARD_HEIGHT);
  ctx.globalAlpha = 0.08;
  ctx.beginPath();
  ctx.arc(OG_CARD_WIDTH - 60, 40, 220, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const measure = (text: string, fontSizePx: number): number => {
    ctx.font = `700 ${fontSizePx}px ${FONT_STACK}`;
    return ctx.measureText(text).width;
  };

  let y = OG_CARD_PADDING + 40;

  // Kicker (section/category).
  const kicker = input.kicker?.trim();
  if (kicker) {
    ctx.font = `600 26px ${FONT_STACK}`;
    ctx.fillStyle = OG_CARD_COLORS.kicker;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(kicker.toUpperCase(), OG_CARD_PADDING, y);
    y += 56;
  }

  // Title (wrapped + auto-sized by the pure layout core).
  const layout = layoutOgTitle(input.title, measure);
  ctx.font = `700 ${layout.fontSize}px ${FONT_STACK}`;
  ctx.fillStyle = OG_CARD_COLORS.title;
  y += layout.fontSize;
  for (const line of layout.lines) {
    ctx.fillText(line, OG_CARD_PADDING, y);
    y += layout.lineHeight;
  }

  // Footer: accent dot + site name, pinned to the bottom.
  const footerY = OG_CARD_HEIGHT - OG_CARD_PADDING + 10;
  ctx.beginPath();
  ctx.fillStyle = OG_CARD_COLORS.accent;
  ctx.arc(OG_CARD_PADDING + 10, footerY - 9, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `600 28px ${FONT_STACK}`;
  ctx.fillStyle = OG_CARD_COLORS.footer;
  ctx.fillText(input.siteName, OG_CARD_PADDING + 34, footerY);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas PNG export failed"));
    }, "image/png");
  });
}

/**
 * Render + upload the card for an entity and return its public URL. Upsert
 * keeps one object per entity, so regenerating never litters the bucket - but
 * the returned URL carries a cache-busting version so scrapers refetch.
 */
export async function generateAndUploadOgCard(
  kind: "post" | "page",
  entityId: string,
  input: OgCardInput,
): Promise<string> {
  const blob = await renderOgCard(input);
  const path = ogCardStoragePath(kind, entityId);
  const { error } = await supabase.storage
    .from("media")
    .upload(path, blob, { contentType: "image/png", upsert: true });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("media").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now().toString(36)}`;
}
