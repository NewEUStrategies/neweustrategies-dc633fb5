// Wstrzykuje styl typografii Content Area (z `post_layout_settings`) jako
// klasy `.post-content` na publicznym widoku. Komponent montowany raz w
// `__root.tsx`, podobnie jak <DesignTokensStyle/>.
import { usePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import { hardenStyleCss } from "@/lib/sanitize";

function num(px: number | null | undefined, fallback: string) {
  return typeof px === "number" && px > 0 ? `${px}px` : fallback;
}

export function ContentAreaStyle() {
  const { data: s } = usePostLayoutSettings();
  if (!s) return null;

  const linkColorLight = s.hyperlink_color || "var(--brand)";
  const linkColorDark = s.hyperlink_color_dark || linkColorLight;
  const underlineLight = s.underline_color || "currentColor";
  const underlineDark = s.underline_color_dark || underlineLight;
  const underlined = s.hyperlink_underline !== false;
  const styleMap: Record<string, string> = { normal: "400", bold: "700", italic: "400" };
  const linkWeight = styleMap[s.hyperlink_style] ?? "400";
  const linkItalic = s.hyperlink_style === "italic" ? "italic" : "normal";

  // Cel: `.single-post-content` (klasa faktycznie renderowana przez
  // ContentRenderer w treści wpisów) oraz `.post-content` (zapasowy alias
  // używany m.in. w podglądach edytora). Bez tego zmiany z /admin/content-area
  // nie miały efektu na produkcyjnym widoku wpisu.
  const css = `
.post-content, .single-post-content {
  --pc-link: ${linkColorLight};
  --pc-underline: ${underlineLight};
}
.dark .post-content, .dark .single-post-content {
  --pc-link: ${linkColorDark};
  --pc-underline: ${underlineDark};
}
.post-content .alignwide,
.post-content figure.wide,
.post-content img.wide,
.single-post-content .alignwide,
.single-post-content figure.wide,
.single-post-content figure.is-wide,
.single-post-content img.wide { max-width: ${num(s.wide_align_max_width, "1600px")}; margin-left: auto; margin-right: auto; }
.post-content p, .post-content ul, .post-content ol, .post-content blockquote,
.single-post-content p, .single-post-content ul, .single-post-content ol, .single-post-content blockquote { margin-bottom: ${s.paragraph_spacing_rem || 1.5}rem; }
.post-content ul, .single-post-content ul { list-style: ${s.list_style || "disc"}; padding-left: 1.5rem; }
.post-content a, .single-post-content a {
  color: var(--pc-link);
  font-weight: ${linkWeight};
  font-style: ${linkItalic};
  text-decoration: ${underlined ? "underline" : "none"};
  text-decoration-color: var(--pc-underline);
  text-underline-offset: 3px;
}
.post-content a:hover, .single-post-content a:hover { opacity: .8; }
${
  s.image_caption_left_border
    ? `
.post-content figcaption, .single-post-content figcaption {
  border-left: 3px solid var(--pc-link);
  padding-left: .75rem;
}`
    : ""
}
${
  s.center_header
    ? `
.post-header { text-align: center; }`
    : ""
}
${
  s.center_entry_meta
    ? `
.post-meta { justify-content: center; }`
    : ""
}
`.replace(/\s+\n/g, "\n");

  return <style data-content-area dangerouslySetInnerHTML={{ __html: hardenStyleCss(css) }} />;
}
