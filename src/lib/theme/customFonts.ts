// Custom web-font management for the per-tenant brand theme.
//
// Storage layout: `<tenantId>/fonts/<slug>.<ext>` inside the public `media`
// bucket (already CDN-friendly, tenant-scoped via existing storage policies).
//
// Each uploaded font is stored as one entry inside
// `site_design_tokens.fonts.custom[]` and rendered as an `@font-face` rule by
// <DesignTokensStyle />. The font also appears in the global <FontPicker /> so
// editors can use it for headings/body text just like any built-in option.
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface CustomFont {
  /** Stable id used as the CSS font-family name (slug). */
  id: string;
  /** Display label shown in the picker. */
  label: string;
  /** Public CDN URL of the .woff2/.woff/.ttf file. */
  url: string;
  /** CSS font-weight (400, 700, "100 900" for variable, …). Defaults to 400. */
  weight?: string;
  /** CSS font-style (normal/italic). Defaults to normal. */
  style?: "normal" | "italic";
  /** font-display strategy. Defaults to "swap". */
  display?: "auto" | "block" | "swap" | "fallback" | "optional";
}

export const FONT_SLUG_RE = /^[a-z0-9-]{1,40}$/;

export function slugifyFontName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "font";
}

export function fontFaceCss(f: CustomFont): string {
  if (!f.id || !f.url || !FONT_SLUG_RE.test(f.id)) return "";
  const format = guessFormat(f.url);
  const weight = f.weight ?? "400";
  const style = f.style ?? "normal";
  const display = f.display ?? "swap";
  return [
    "@font-face{",
    `font-family:"${f.id}";`,
    `src:url("${f.url}")${format ? ` format("${format}")` : ""};`,
    `font-weight:${weight};font-style:${style};font-display:${display};`,
    "}",
  ].join("");
}

export function customFontsCss(fonts: readonly CustomFont[] | undefined): string {
  if (!fonts?.length) return "";
  return fonts.map(fontFaceCss).filter(Boolean).join("");
}

function guessFormat(url: string): string | null {
  const u = url.split("?")[0].toLowerCase();
  if (u.endsWith(".woff2")) return "woff2";
  if (u.endsWith(".woff")) return "woff";
  if (u.endsWith(".ttf")) return "truetype";
  if (u.endsWith(".otf")) return "opentype";
  return null;
}

const ALLOWED_EXT = new Set(["woff2", "woff", "ttf", "otf"]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function uploadCustomFont(opts: {
  file: File;
  label: string;
  tenantId: string;
  weight?: string;
  style?: "normal" | "italic";
}): Promise<CustomFont | null> {
  const ext = opts.file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.has(ext)) {
    toast.error("Dozwolone formaty: .woff2, .woff, .ttf, .otf");
    return null;
  }
  if (opts.file.size > MAX_BYTES) {
    toast.error("Plik fontu jest większy niż 5 MB");
    return null;
  }
  const id = slugifyFontName(opts.label || opts.file.name.replace(/\.[^.]+$/, ""));
  const path = `${opts.tenantId}/fonts/${id}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("media")
    .upload(path, opts.file, {
      contentType: opts.file.type || `font/${ext === "ttf" ? "ttf" : ext}`,
      cacheControl: "31536000, immutable",
      upsert: false,
    });
  if (error) {
    toast.error(error.message || "Nie udało się wysłać fontu");
    return null;
  }
  const { data } = supabase.storage.from("media").getPublicUrl(path);
  return {
    id,
    label: opts.label || id,
    url: data.publicUrl,
    weight: opts.weight ?? "400",
    style: opts.style ?? "normal",
    display: "swap",
  };
}
