// Emituje globalne style content-area do <head> na podstawie post_layout_settings.
// Wpisuje CSS variables / nadpisuje wartości tylko w kontekście pojedynczego wpisu.
import { useEffect } from "react";
import { usePostLayoutSettings } from "@/hooks/usePostLayoutSettings";

const STYLE_ID = "nes-post-content-style";

export function PostContentStyle() {
  const { data: s } = usePostLayoutSettings();

  useEffect(() => {
    if (!s) return;
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }

    const lightLink = s.hyperlink_color ? `color: ${s.hyperlink_color};` : "";
    const darkLink = s.hyperlink_color_dark ? `color: ${s.hyperlink_color_dark};` : "";
    const lightUl = s.underline_color ? `text-decoration-color: ${s.underline_color};` : "";
    const darkUl = s.underline_color_dark ? `text-decoration-color: ${s.underline_color_dark};` : "";

    const fontStyle =
      s.hyperlink_style === "bold" ? "font-weight:600;" :
      s.hyperlink_style === "italic" ? "font-style:italic;" :
      s.hyperlink_style === "bold-italic" ? "font-weight:600;font-style:italic;" : "";

    const underline = s.hyperlink_underline ? "text-decoration: underline;" : "text-decoration: none;";

    const listStyleVal =
      s.list_style === "circle" ? "circle" :
      s.list_style === "square" ? "square" :
      s.list_style === "disc" ? "disc" :
      s.list_style === "none" ? "none" : "disc";

    el.textContent = `
      .single-post-content p { margin-bottom: ${s.paragraph_spacing_rem}rem; }
      .single-post-content a { ${fontStyle} ${underline} ${lightLink} ${lightUl} }
      .dark .single-post-content a { ${darkLink} ${darkUl} }
      .single-post-content ul { list-style: ${listStyleVal}; padding-left: 1.5rem; }
      .single-post-content ol { padding-left: 1.5rem; }
      .single-post-content figure img { max-width: 100%; height: auto; }
      .single-post-content figure.is-wide { max-width: ${s.wide_align_max_width}px; margin-left: auto; margin-right: auto; }
      ${s.image_caption_left_border ? ".single-post-content figcaption { border-left: 3px solid hsl(var(--border)); padding-left: 0.75rem; }" : ""}
    `;
  }, [s]);

  return null;
}
