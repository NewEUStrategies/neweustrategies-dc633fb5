// Wstrzykuje styl typografii Content Area (z `post_layout_settings`) jako
// klasy `.post-content` na publicznym widoku. Komponent montowany raz w
// `__root.tsx`, podobnie jak <DesignTokensStyle/>.
import { usePostLayoutSettings } from "@/hooks/usePostLayoutSettings";

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

  const css = `
.post-content {
  --pc-link: ${linkColorLight};
  --pc-underline: ${underlineLight};
}
.dark .post-content {
  --pc-link: ${linkColorDark};
  --pc-underline: ${underlineDark};
}
.post-content { max-width: ${num(s.no_sidebar_max_width, "840px")}; }
.post-content.has-sidebar { max-width: ${num(s.has_sidebar_max_width, "760px")}; }
.post-content .alignwide,
.post-content figure.wide,
.post-content img.wide { max-width: ${num(s.wide_align_max_width, "1600px")}; }
.post-content p,
.post-content ul,
.post-content ol,
.post-content blockquote { margin-bottom: ${s.paragraph_spacing_rem || 1.5}rem; }
.post-content ul { list-style: ${s.list_style || "disc"}; padding-left: 1.5rem; }
.post-content a {
  color: var(--pc-link);
  font-weight: ${linkWeight};
  font-style: ${linkItalic};
  text-decoration: ${underlined ? "underline" : "none"};
  text-decoration-color: var(--pc-underline);
  text-underline-offset: 3px;
}
.post-content a:hover { opacity: .8; }
${s.image_caption_left_border ? `
.post-content figcaption {
  border-left: 3px solid var(--pc-link);
  padding-left: .75rem;
}` : ""}
${s.center_header ? `
.post-header { text-align: center; }` : ""}
${s.center_entry_meta ? `
.post-meta { justify-content: center; }` : ""}
`.replace(/\s+\n/g, "\n");

  // eslint-disable-next-line react/no-danger
  return <style data-content-area dangerouslySetInnerHTML={{ __html: css }} />;
}
