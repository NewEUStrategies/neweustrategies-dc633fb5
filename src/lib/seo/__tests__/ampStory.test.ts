import { describe, expect, it } from "vitest";
import {
  buildAmpStoryHtml,
  canBuildAmpStory,
  htmlEscape,
  resolvePosterPortrait,
  safeCssColor,
  type AmpStoryInput,
} from "@/lib/seo/ampStory";
import { StoryPageSchema } from "@/lib/web-stories/types";

function page(over: Partial<Parameters<typeof StoryPageSchema.parse>[0]> = {}) {
  return StoryPageSchema.parse({ id: "p1", ...over });
}

function input(
  over: Partial<AmpStoryInput["story"]> = {},
  top: Partial<Omit<AmpStoryInput, "story">> = {},
): AmpStoryInput {
  return {
    story: {
      slug: "moja-historia",
      title_pl: "Tytuł <PL>",
      title_en: "Title EN",
      description_pl: "Opis",
      description_en: "",
      cover_url: "https://cdn.example.org/cover.jpg",
      pages: [
        page({ id: "p1", media_url: "https://cdn.example.org/1.jpg", title_pl: "Strona 1" }),
        page({ id: "p2", background: "color", color: "#112233", caption_pl: "Podpis" }),
      ],
      published_at: "2026-07-01T10:00:00Z",
      updated_at: "2026-07-02T10:00:00Z",
      ...over,
    },
    lang: "pl",
    origin: "https://example.org",
    publisherName: "New European Strategies",
    publisherLogoUrl: "https://cdn.example.org/logo.png",
    ...top,
  };
}

describe("buildAmpStoryHtml", () => {
  it("emits a standalone amp-story with required publisher/poster attributes", () => {
    const html = buildAmpStoryHtml(input());
    expect(html).toContain("<html amp");
    expect(html).toContain('<script async src="https://cdn.ampproject.org/v0.js">');
    expect(html).toContain('custom-element="amp-story"');
    expect(html).toContain("<style amp-boilerplate>");
    expect(html).toContain('<amp-story standalone title="Tytuł &lt;PL&gt;"');
    expect(html).toContain('publisher="New European Strategies"');
    expect(html).toContain('publisher-logo-src="https://cdn.example.org/logo.png"');
    expect(html).toContain('poster-portrait-src="https://cdn.example.org/cover.jpg"');
    expect(html).toContain(
      '<link rel="canonical" href="https://example.org/web-stories/moja-historia">',
    );
  });

  it("renders image pages as fill layers and color pages via amp-custom classes", () => {
    const html = buildAmpStoryHtml(input());
    expect(html).toContain('<amp-img src="https://cdn.example.org/1.jpg"');
    expect(html).toContain(".bg-1{background-color:#112233;}");
    expect(html).toContain('class="bg bg-1"');
    expect(html).not.toContain("amp-video-0.1.js");
  });

  it("includes the amp-video runtime only when a video page exists", () => {
    const html = buildAmpStoryHtml(
      input({
        pages: [
          page({ id: "v1", background: "video", media_url: "https://cdn.example.org/v.mp4" }),
        ],
      }),
    );
    expect(html).toContain("amp-video-0.1.js");
    expect(html).toContain('<source src="https://cdn.example.org/v.mp4" type="video/mp4"/>');
  });

  it("carries Article JSON-LD with the canonical as mainEntityOfPage", () => {
    const html = buildAmpStoryHtml(input());
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('"mainEntityOfPage":"https://example.org/web-stories/moja-historia"');
  });
});

describe("canBuildAmpStory / resolvePosterPortrait", () => {
  it("requires at least one page and some poster source", () => {
    expect(canBuildAmpStory(input())).toBe(true);
    expect(canBuildAmpStory(input({ pages: [] }))).toBe(false);
    expect(
      canBuildAmpStory(
        input({ cover_url: null, pages: [page({ background: "color", media_url: "" })] }),
      ),
    ).toBe(false);
  });

  it("falls back to the first media page when the cover is missing", () => {
    const i = input({
      cover_url: null,
      pages: [
        page({ background: "color" }),
        page({ id: "p9", media_url: "https://cdn.example.org/9.jpg" }),
      ],
    });
    expect(resolvePosterPortrait(i)).toBe("https://cdn.example.org/9.jpg");
  });

  it("uses a video page's poster_url (NOT the video URL) as the portrait poster", () => {
    const i = input({
      cover_url: null,
      pages: [
        page({
          id: "v1",
          background: "video",
          media_url: "https://cdn.example.org/clip.mp4",
          poster_url: "https://cdn.example.org/clip-poster.jpg",
        }),
      ],
    });
    // Poster MUSI byc obrazem - nigdy URL-em pliku wideo.
    expect(resolvePosterPortrait(i)).toBe("https://cdn.example.org/clip-poster.jpg");
  });

  it("skips a video page without a poster and uses a later image page", () => {
    const i = input({
      cover_url: null,
      pages: [
        page({ id: "v1", background: "video", media_url: "https://cdn.example.org/clip.mp4" }),
        page({ id: "p2", media_url: "https://cdn.example.org/2.jpg" }),
      ],
    });
    expect(resolvePosterPortrait(i)).toBe("https://cdn.example.org/2.jpg");
  });

  it("cannot build a story whose only page is a video without a poster", () => {
    const i = input({
      cover_url: null,
      pages: [
        page({ id: "v1", background: "video", media_url: "https://cdn.example.org/clip.mp4" }),
      ],
    });
    expect(resolvePosterPortrait(i)).toBe("");
    expect(canBuildAmpStory(i)).toBe(false);
  });
});

describe("htmlEscape", () => {
  it("escapes AMP-breaking characters", () => {
    expect(htmlEscape(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("safeCssColor", () => {
  it("passes real CSS colour tokens through", () => {
    const colors = [
      "#fff",
      "#ffffff",
      "rgb(0,0,0)",
      "rgba(0,0,0,.5)",
      "hsl(210,50%,40%)",
      "red",
      "var(--brand)",
    ];
    for (const c of colors) {
      expect(safeCssColor(c)).toBe(c);
    }
  });

  it("collapses a </style> breakout payload to a harmless fallback", () => {
    expect(safeCssColor(`red}</style><script>fetch('//evil')</script>`)).toBe("transparent");
    expect(safeCssColor("blue;} body{display:none")).toBe("transparent");
    expect(safeCssColor("")).toBe("transparent");
  });

  it("keeps the built AMP <style amp-custom> unbreakable for a hostile colour", () => {
    const html = buildAmpStoryHtml(
      input({
        pages: [
          page({ id: "p1", background: "color", color: `#000}</style><script>alert(1)</script>` }),
        ],
      }),
    );
    expect(html).not.toContain("</style><script>");
    expect(html).not.toContain("alert(1)");
  });
});

// ── Wejścia NIEPEŁNE ────────────────────────────────────────────────────────
// Dokument AMP jest RÓWNOLEGŁYM wydaniem historii, czytanym wyłącznie przez
// Google (Discover / karuzela Web Stories). Nie ma tu człowieka, który zobaczy
// pusty atrybut - albo tag wychodzi poprawny, albo strona wypada z karuzeli.
// Kontrakt <head> na żywym SSR sprawdza e2e/seo.spec.ts; tu testujemy
// wyłącznie czysty builder.
describe("safeCssColor - brak wartości", () => {
  it.each<[string, string | null | undefined]>([
    ["undefined", undefined],
    ["null", null],
    ["pusty string", ""],
    ["same białe znaki", "   "],
    ["tabulator i nowa linia", "\t\n"],
  ])("kolor %s zwraca 'transparent'", (_opis, wartosc) => {
    // Gałąź `value ?? ""` (ampStory.ts:47) - kolumna `color` jest w JSON-ie
    // opcjonalna, a `background-color:` bez wartości psuje <style amp-custom>
    // i unieważnia CAŁY dokument AMP, nie tylko jedną stronę.
    expect(safeCssColor(wartosc)).toBe("transparent");
  });
});

describe("resolvePosterPortrait - strony bez użytecznego medium", () => {
  it("strona typu image bez media_url nie daje postera", () => {
    // Gałąź `if (media)` (ampStory.ts:69) - pusty media_url przy background
    // "image" (strona założona w edytorze i nieuzupełniona).
    const i = input({ cover_url: null, pages: [page({ background: "image", media_url: "" })] });
    expect(resolvePosterPortrait(i)).toBe("");
    expect(canBuildAmpStory(i)).toBe(false);
  });

  it("pomija stronę image bez medium i bierze poster z kolejnej strony", () => {
    const i = input({
      cover_url: null,
      pages: [
        page({ id: "p1", background: "image", media_url: "" }),
        page({ id: "p2", background: "image", media_url: "https://cdn.example.org/2.jpg" }),
      ],
    });
    expect(resolvePosterPortrait(i)).toBe("https://cdn.example.org/2.jpg");
  });

  it.each<[string, string | null]>([
    ["null", null],
    ["pusty string", ""],
    ["same białe znaki", "   "],
  ])("okładka %s spada na pierwsze medium ze stron", (_opis, cover) => {
    const i = input({
      cover_url: cover,
      pages: [page({ id: "p1", media_url: "https://cdn.example.org/1.jpg" })],
    });
    expect(resolvePosterPortrait(i)).toBe("https://cdn.example.org/1.jpg");
  });
});

describe("buildAmpStoryHtml - pola opcjonalne historii", () => {
  it("bez tytułu w obu językach używa sluga", () => {
    // Gałąź `storyTitle(...) || story.slug` (ampStory.ts:128). <amp-story> bez
    // atrybutu title jest niewalidowalny, więc slug jest ostatnią deską.
    const html = buildAmpStoryHtml(input({ title_pl: "", title_en: "" }));
    expect(html).toContain("<title>moja-historia</title>");
    expect(html).toContain('<amp-story standalone title="moja-historia"');
  });

  it("bez opisu pomija <meta name=description> i pole description w JSON-LD", () => {
    // Gałęzie `description ? ... : ...` (ampStory.ts:147 i 183).
    const html = buildAmpStoryHtml(input({ description_pl: "", description_en: "" }));
    expect(html).not.toContain('<meta name="description"');
    expect(html).not.toContain('"description"');
    // Reszta dokumentu stoi - brak opisu nie dyskwalifikuje historii.
    expect(html).toContain('"@type":"Article"');
  });

  it.each<[string, Partial<AmpStoryInput["story"]>, string]>([
    ["bez daty publikacji", { published_at: null }, '"datePublished"'],
    ["bez daty modyfikacji", { updated_at: null }, '"dateModified"'],
  ])("%s -> JSON-LD nie zawiera pola %s", (_opis, over, pole) => {
    // Gałęzie ampStory.ts:149 i 150. Puste datePublished psuje walidację
    // Article w Search Console dla całego dokumentu.
    const html = buildAmpStoryHtml(input(over));
    expect(html).not.toContain(pole);
  });

  it.each<[string, string | null | undefined]>([
    ["undefined", undefined],
    ["null", null],
    ["pusty string", ""],
    ["same białe znaki", "  "],
  ])("logo wydawcy %s spada na poster historii", (_opis, logo) => {
    // Gałąź `publisherLogoUrl?.trim() || poster` (ampStory.ts:132).
    // publisher-logo-src jest w AMP WYMAGANY.
    const html = buildAmpStoryHtml(input({}, { publisherLogoUrl: logo }));
    expect(html).toContain('publisher-logo-src="https://cdn.example.org/cover.jpg"');
    expect(html).toContain('"url":"https://cdn.example.org/cover.jpg"');
  });

  it("historia bez jakiegokolwiek obrazu nie emituje pustego image/logo w JSON-LD", () => {
    // Gałęzie ampStory.ts:148 (image) i 154 (logo wydawcy). Taka historia nie
    // przechodzi `canBuildAmpStory`, więc trasa jej NIE wyda - ale builder musi
    // zostać przy poprawnym JSON-LD, a nie wypuścić "image":[""].
    const i = input(
      { cover_url: null, pages: [page({ background: "color", color: "#101010" })] },
      { publisherLogoUrl: null },
    );
    expect(canBuildAmpStory(i)).toBe(false);
    const html = buildAmpStoryHtml(i);
    expect(html).not.toContain('"image"');
    expect(html).not.toContain('"logo"');
    expect(html).toContain('poster-portrait-src=""');
    expect(html).toContain('"name":"New European Strategies"');
  });
});

describe("buildAmpStoryHtml - strony historii", () => {
  it("tylko pierwsza strona dostaje <h1>, kolejne <h2>", () => {
    // Gałęzie `idx === 0 ? "<h1" : "<h2"` (ampStory.ts:116). Dwa <h1> w jednym
    // dokumencie to błąd struktury nagłówków, który Google raportuje osobno.
    const html = buildAmpStoryHtml(
      input({
        pages: [
          page({ id: "p1", media_url: "https://cdn.example.org/1.jpg", title_pl: "Pierwsza" }),
          page({ id: "p2", media_url: "https://cdn.example.org/2.jpg", title_pl: "Druga" }),
          page({ id: "p3", media_url: "https://cdn.example.org/3.jpg", title_pl: "Trzecia" }),
        ],
      }),
    );
    expect(html).toContain('<h1 class="story-title">Pierwsza</h1>');
    expect(html).toContain('<h2 class="story-title">Druga</h2>');
    expect(html).toContain('<h2 class="story-title">Trzecia</h2>');
    expect(html.match(/<h1 /g)).toHaveLength(1);
  });

  it("strona wideo z posterem emituje atrybut poster na <amp-video>", () => {
    // Gałąź `p.poster_url.trim() ? poster=... : ""` (ampStory.ts:92). Bez
    // postera przeglądarka pokazuje czarną klatkę do startu bufora.
    const html = buildAmpStoryHtml(
      input({
        pages: [
          page({
            id: "v1",
            background: "video",
            media_url: "https://cdn.example.org/v.mp4",
            poster_url: "https://cdn.example.org/v.jpg",
          }),
        ],
      }),
    );
    expect(html).toContain('poster="https://cdn.example.org/v.jpg"');
    expect(html).toContain('<source src="https://cdn.example.org/v.mp4" type="video/mp4"/>');
  });

  it("strona wideo bez media_url degraduje do warstwy tła kolorem", () => {
    const html = buildAmpStoryHtml(
      input({
        pages: [page({ id: "v1", background: "video", media_url: "", color: "#222222" })],
      }),
    );
    expect(html).not.toContain("<amp-video");
    expect(html).not.toContain("amp-video-0.1.js");
    expect(html).toContain('class="bg bg-0"');
  });

  it("strona bez id i bez czasu trwania dostaje wartości zastępcze", () => {
    // Gałęzie `p.id || \`p-${idx}\`` i `p.duration_seconds || 6`
    // (ampStory.ts:161). duration_seconds = 0 nie przejdzie już przez
    // StoryPageSchema (min 2), ale wiersze zapisane PRZED wprowadzeniem tego
    // ograniczenia siedzą w kolumnie JSON. <amp-story-page> bez poprawnego
    // auto-advance-after zatrzymuje historię na pierwszym slajdzie.
    const html = buildAmpStoryHtml(
      input({
        pages: [
          {
            ...page(),
            id: "",
            media_url: "https://cdn.example.org/1.jpg",
            duration_seconds: 0,
          },
        ],
      }),
    );
    expect(html).toContain('<amp-story-page id="p-0" auto-advance-after="6s">');
  });

  it("czas trwania jest przycinany do zakresu 2-30 s akceptowanego przez AMP", () => {
    const html = buildAmpStoryHtml(
      input({
        pages: [
          {
            ...page(),
            id: "krotka",
            media_url: "https://cdn.example.org/1.jpg",
            duration_seconds: 1,
          },
          {
            ...page(),
            id: "dluga",
            media_url: "https://cdn.example.org/2.jpg",
            duration_seconds: 900,
          },
        ],
      }),
    );
    expect(html).toContain('id="krotka" auto-advance-after="2s"');
    expect(html).toContain('id="dluga" auto-advance-after="30s"');
  });

  it("historia bez stron daje dokument z pustym <amp-story>", () => {
    const i = input({ pages: [] });
    expect(canBuildAmpStory(i)).toBe(false);
    const html = buildAmpStoryHtml(i);
    expect(html).not.toContain("<amp-story-page");
    expect(html).toContain("</amp-story>");
  });
});

describe("buildAmpStoryHtml - wersja EN bez tłumaczenia", () => {
  it("spada na treść PL zamiast emitować puste tytuły i podpisy", () => {
    const html = buildAmpStoryHtml(input({ title_en: "", description_en: "" }, { lang: "en" }));
    expect(html).toContain('<html amp lang="en">');
    expect(html).toContain("<title>Tytuł &lt;PL&gt;</title>");
    expect(html).toContain('<meta name="description" content="Opis">');
    // Podpis strony też spada na PL - <amp-story-grid-layer> bez tekstu byłby
    // pustą warstwą nad obrazem.
    expect(html).toContain('<h1 class="story-title">Strona 1</h1>');
    expect(html).toContain('<p class="story-caption">Podpis</p>');
  });
});
