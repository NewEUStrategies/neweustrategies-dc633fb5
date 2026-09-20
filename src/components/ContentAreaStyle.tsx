// Wstrzykuje styl typografii Content Area (z `post_layout_settings`) jako
// klasy `.post-content` na publicznym widoku. Komponent montowany raz w
// `__root.tsx`, podobnie jak <DesignTokensStyle/>.
import { useMemo } from "react";
import { usePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import { defaultPostLayoutSettings, type PostLayoutSettings } from "@/lib/postLayouts";
import { hardenStyleCss } from "@/lib/sanitizePure";

/** Jedna instancja defaultów - `defaultPostLayoutSettings()` tworzy nowy obiekt. */
const DEFAULT_SETTINGS: PostLayoutSettings = defaultPostLayoutSettings();

function num(px: number | null | undefined, fallback: string) {
  return typeof px === "number" && px > 0 ? `${px}px` : fallback;
}

/**
 * Budowa CSS wydzielona z ciała komponentu: `useMemo` przelicza ją tylko przy
 * zmianie wiersza ustawień, a nie przy każdym renderze korzenia aplikacji.
 */
function contentAreaCss(s: PostLayoutSettings): string {
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
.post-content img, .blocks-content img, .single-post-content img { max-width: 100%; height: auto; max-height: 50vh; }
/* Zewnętrzne shortcode awatarów (np. WP Author Profile) nie powinny rozpychać
   layoutu - ograniczamy je do standardowego rozmiaru avatara. */
.blocks-content .awpa-avatar, .post-content .awpa-avatar, .single-post-content .awpa-avatar { max-width: 80px !important; max-height: 80px !important; }
/* Tylko akapity - odstępy list i cytatów pochodzą z tokenów motywu
   (--sp-list / --sp-blockquote), żeby nie było dwóch źródeł prawdy. */
.post-content p, .blocks-content p, .single-post-content p { margin-bottom: ${s.paragraph_spacing_rem || 1.5}rem; }
/* Sync builder canvas: Enter in Gutenberg tworzy nowy blok akapitu - odstęp
   między kolejnymi akapitami w edytorze musi być IDENTYCZNY z odstępem na
   froncie (var: paragraph_spacing_rem z /admin/content-area). */
[data-builder-renderer] { --cms-paragraph-spacing: ${s.paragraph_spacing_rem || 1.5}rem; }
[data-builder-renderer] > [data-block-type="paragraph"] + [data-block-type="paragraph"],
[data-builder-renderer] > [data-block-type="paragraph"] + [data-block-type="list"],
[data-builder-renderer] > [data-block-type="paragraph"] + [data-block-type="html"] {
  margin-top: var(--cms-paragraph-spacing);
}
.post-content ul:not(.cms-content-list), .blocks-content ul:not(.cms-content-list), .single-post-content ul:not(.cms-content-list),
[data-builder-renderer] > [data-block-type="list"] ul:not(.cms-content-list) { list-style: ${s.list_style || "disc"}; padding-left: 1.5rem; }
.post-content ol:not(.cms-content-list), .blocks-content ol:not(.cms-content-list), .single-post-content ol:not(.cms-content-list),
[data-builder-renderer] > [data-block-type="list"] ol:not(.cms-content-list) { padding-left: 1.5rem; }
.cms-content-list,
.cms-rich-content :is(ul, ol):not([data-footnotes-list]):not(.task-list):not(.contains-task-list) { list-style: none; padding: 0; }

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

  return css;
}

/**
 * Bez wiersza w bazie emitujemy blok z DOMYŚLNYMI ustawieniami (wzorzec
 * `ThemeFontSizesStyle`) zamiast `null`. Dawne `return null` znaczyło "SSR bez
 * typografii treści, klient z typografią": odstępy akapitów, kolor i
 * podkreślenie linków oraz limit wysokości obrazków dochodziły dopiero po
 * hydratacji i przesuwały całą treść wpisu (audyt CWV, F29a).
 */
export function ContentAreaStyle() {
  const { data } = usePostLayoutSettings();
  // Utwardzanie CSS zależy WYŁĄCZNIE od wiersza ustawień, a komponent wisi przy
  // korzeniu aplikacji - bez memo przeliczał się przy każdym renderze drzewa.
  const css = useMemo(() => hardenStyleCss(contentAreaCss(data ?? DEFAULT_SETTINGS)), [data]);
  return <style data-content-area dangerouslySetInnerHTML={{ __html: css }} />;
}
