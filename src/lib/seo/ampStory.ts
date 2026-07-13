// Pure AMP Web Story document builder (/web-stories/$slug/amp).
//
// Publiczny viewer stories jest własnym Reactowym slideshow - poprawny UX, ale
// bez formatu AMP nie kwalifikuje się do prezentacji Web Stories w Google
// (Discover/karuzela), co jest głównym powodem istnienia tego formatu. Ten
// builder emituje RÓWNOLEGŁY, samowystarczalny dokument <amp-story> z tych
// samych danych (pages JSON); kanoniczna strona linkuje go przez
// <link rel="amphtml">, a dokument AMP wskazuje kanoniczną.
//
// Framework-free i unit-testowalny; trasa jedynie składa wejście + nagłówki.
import type { StoryPage, WebStory } from "@/lib/web-stories/types";
import { pageCaption, pageTitle, storyDescription, storyTitle } from "@/lib/web-stories/types";
import { safeJsonLd } from "@/lib/seo/jsonld";

export interface AmpStoryInput {
  story: Pick<
    WebStory,
    "slug" | "title_pl" | "title_en" | "description_pl" | "description_en" | "cover_url" | "pages"
  > & {
    published_at: string | null;
    updated_at: string | null;
  };
  lang: "pl" | "en";
  /** Absolute origin, np. https://example.org (bez trailing slash). */
  origin: string;
  publisherName: string;
  /** Logo wydawcy (SEO settings); pusty string -> fallback na poster. */
  publisherLogoUrl?: string | null;
}

export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Page background colour is interpolated raw into `<style amp-custom>`. `<style>`
// is a raw-text element, so a stored value like `red}</style><script>…` would
// break out and run script. htmlEscape does NOT help inside <style> (entities
// are not decoded there). Allow only characters that can appear in a real CSS
// colour token (hex / rgb()/hsl() / named / var()) and cap the length; anything
// else (`}`, `;`, `<`, `>`, quotes) collapses to a harmless fallback.
export function safeCssColor(value: string | null | undefined): string {
  const s = (value ?? "").trim();
  if (!s) return "transparent";
  return /^[#a-zA-Z0-9(),.%\s-]{1,64}$/.test(s) ? s : "transparent";
}

/** Poster pionowy jest w AMP wymagany: okładka, a w razie braku pierwsze medium. */
export function resolvePosterPortrait(input: AmpStoryInput): string {
  const cover = input.story.cover_url?.trim();
  if (cover) return cover;
  const firstMedia = input.story.pages.find(
    (p) => p.background !== "color" && p.media_url.trim() !== "",
  );
  return firstMedia?.media_url.trim() ?? "";
}

/**
 * Czy da się zbudować WAŻNY dokument AMP: potrzebny poster (okładka lub
 * jakiekolwiek medium) i co najmniej jedna strona.
 */
export function canBuildAmpStory(input: AmpStoryInput): boolean {
  return input.story.pages.length > 0 && resolvePosterPortrait(input) !== "";
}

const AMP_BOILERPLATE =
  "<style amp-boilerplate>body{-webkit-animation:-amp-start 8s steps(1,end) 0s 1 normal both;-moz-animation:-amp-start 8s steps(1,end) 0s 1 normal both;-ms-animation:-amp-start 8s steps(1,end) 0s 1 normal both;animation:-amp-start 8s steps(1,end) 0s 1 normal both}@-webkit-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-moz-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-ms-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-o-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}</style><noscript><style amp-boilerplate>body{-webkit-animation:none;-moz-animation:none;-ms-animation:none;animation:none}</style></noscript>";

function pageLayers(p: StoryPage, idx: number, lang: "pl" | "en"): string {
  const media = p.media_url.trim();
  const fill =
    p.background === "video" && media
      ? [
          `      <amp-story-grid-layer template="fill">`,
          `        <amp-video autoplay loop width="720" height="1280" layout="responsive"${
            p.poster_url.trim() ? ` poster="${htmlEscape(p.poster_url.trim())}"` : ""
          }>`,
          `          <source src="${htmlEscape(media)}" type="video/mp4"/>`,
          `        </amp-video>`,
          `      </amp-story-grid-layer>`,
        ].join("\n")
      : p.background !== "color" && media
        ? [
            `      <amp-story-grid-layer template="fill">`,
            `        <amp-img src="${htmlEscape(media)}" width="720" height="1280" layout="responsive" alt=""></amp-img>`,
            `      </amp-story-grid-layer>`,
          ].join("\n")
        : // Tło kolorem realizuje klasa per-strona w <style amp-custom>.
          `      <amp-story-grid-layer template="fill"><div class="bg bg-${idx}"></div></amp-story-grid-layer>`;

  const title = pageTitle(p, lang);
  const caption = pageCaption(p, lang);
  const textLines: string[] = [];
  if (title || caption) {
    textLines.push(
      `      <amp-story-grid-layer template="vertical" class="pos-${p.text_position} align-${p.text_align}">`,
    );
    if (title) {
      textLines.push(
        `        ${idx === 0 ? "<h1" : "<h2"} class="story-title">${htmlEscape(title)}${idx === 0 ? "</h1>" : "</h2>"}`,
      );
    }
    if (caption) textLines.push(`        <p class="story-caption">${htmlEscape(caption)}</p>`);
    textLines.push(`      </amp-story-grid-layer>`);
  }

  return [fill, ...textLines].join("\n");
}

export function buildAmpStoryHtml(input: AmpStoryInput): string {
  const { story, lang, origin } = input;
  const title = storyTitle(story, lang) || story.slug;
  const description = storyDescription(story, lang);
  const canonical = `${origin}/web-stories/${story.slug}`;
  const poster = resolvePosterPortrait(input);
  const publisherLogo = input.publisherLogoUrl?.trim() || poster;
  const hasVideo = story.pages.some((p) => p.background === "video" && p.media_url.trim() !== "");

  const colorRules = story.pages
    .map((p, idx) =>
      p.background === "color" ? `.bg-${idx}{background-color:${safeCssColor(p.color)};}` : "",
    )
    .filter(Boolean)
    .join("");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    mainEntityOfPage: canonical,
    headline: title,
    ...(description ? { description } : {}),
    ...(poster ? { image: [poster] } : {}),
    ...(story.published_at ? { datePublished: story.published_at } : {}),
    ...(story.updated_at ? { dateModified: story.updated_at } : {}),
    publisher: {
      "@type": "Organization",
      name: input.publisherName,
      ...(publisherLogo ? { logo: { "@type": "ImageObject", url: publisherLogo } } : {}),
    },
  };

  const pages = story.pages
    .map((p, idx) =>
      [
        `    <amp-story-page id="${htmlEscape(p.id || `p-${idx}`)}" auto-advance-after="${Math.max(2, Math.min(30, p.duration_seconds || 6))}s">`,
        pageLayers(p, idx, lang),
        `    </amp-story-page>`,
      ].join("\n"),
    )
    .join("\n");

  return [
    "<!doctype html>",
    `<html amp lang="${lang}">`,
    "<head>",
    `<meta charset="utf-8">`,
    `<script async src="https://cdn.ampproject.org/v0.js"></script>`,
    `<script async custom-element="amp-story" src="https://cdn.ampproject.org/v0/amp-story-1.0.js"></script>`,
    ...(hasVideo
      ? [
          `<script async custom-element="amp-video" src="https://cdn.ampproject.org/v0/amp-video-0.1.js"></script>`,
        ]
      : []),
    `<title>${htmlEscape(title)}</title>`,
    `<link rel="canonical" href="${htmlEscape(canonical)}">`,
    `<meta name="viewport" content="width=device-width,minimum-scale=1,initial-scale=1">`,
    ...(description ? [`<meta name="description" content="${htmlEscape(description)}">`] : []),
    AMP_BOILERPLATE,
    `<style amp-custom>.story-title{font:700 1.5rem/1.25 system-ui,sans-serif;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.6);margin:0}.story-caption{font:400 1rem/1.4 system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6);margin:.5em 0 0}.pos-top{justify-content:flex-start;padding:2rem}.pos-center{justify-content:center;padding:2rem}.pos-bottom{justify-content:flex-end;padding:2rem}.align-left{text-align:left}.align-center{text-align:center}.align-right{text-align:right}.bg{width:100%;height:100%}${colorRules}</style>`,
    `<script type="application/ld+json">${safeJsonLd(jsonLd)}</script>`,
    "</head>",
    "<body>",
    `  <amp-story standalone title="${htmlEscape(title)}" publisher="${htmlEscape(input.publisherName)}" publisher-logo-src="${htmlEscape(publisherLogo)}" poster-portrait-src="${htmlEscape(poster)}">`,
    pages,
    "  </amp-story>",
    "</body>",
    "</html>",
  ].join("\n");
}
