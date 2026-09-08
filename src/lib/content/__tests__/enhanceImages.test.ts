import { describe, expect, it } from "vitest";
import { enhanceContentImages, imageDimsFromUrl } from "../enhanceImages";

const SUPA = "https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/covers/a.jpg";

describe("enhanceContentImages", () => {
  it("adds lazy loading and async decoding to bare imgs", () => {
    const out = enhanceContentImages('<p>x</p><img src="/a.jpg" alt="">');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
  });

  it("preserves existing loading/decoding attributes", () => {
    const html = '<img src="/a.jpg" loading="eager" decoding="sync">';
    const out = enhanceContentImages(html);
    expect(out).toContain('loading="eager"');
    expect(out).not.toContain('loading="lazy"');
    expect(out).toContain('decoding="sync"');
    expect(out.match(/decoding=/g)).toHaveLength(1);
  });

  it("adds srcset + sizes for Supabase storage URLs", () => {
    const out = enhanceContentImages(`<img src="${SUPA}" alt="">`);
    expect(out).toContain("srcset=");
    expect(out).toContain("sizes=");
    expect(out).toContain("/storage/v1/render/image/public/");
    expect(out).toContain("320w");
    expect(out).toContain("1280w");
  });

  it("escapes ampersands in generated srcset for the attribute context", () => {
    const out = enhanceContentImages(`<img src="${SUPA}">`);
    const srcset = /srcset="([^"]*)"/.exec(out)?.[1] ?? "";
    expect(srcset).toContain("&amp;");
    expect(srcset).not.toMatch(/&(?!amp;)quality/);
  });

  it("unescapes an HTML-escaped src before building transform URLs", () => {
    const escaped = SUPA.replace("covers/a.jpg", "covers/a.jpg?v=1&amp;x=2");
    const out = enhanceContentImages(`<img src="${escaped}">`);
    expect(out).toContain("srcset=");
  });

  it("leaves external images without srcset", () => {
    const out = enhanceContentImages('<img src="https://example.com/pic.png">');
    expect(out).not.toContain("srcset=");
    expect(out).toContain('loading="lazy"');
  });

  it("does not duplicate srcset when one exists", () => {
    const html = `<img src="${SUPA}" srcset="${SUPA} 1x">`;
    const out = enhanceContentImages(html);
    expect(out.match(/srcset=/g)).toHaveLength(1);
  });

  it("handles self-closing tags", () => {
    const out = enhanceContentImages(`<figure><img src="${SUPA}" alt=""/></figure>`);
    expect(out).toMatch(/sizes="[^"]+"\/><\/figure>/);
    expect(out).toContain('loading="lazy"');
  });

  it("is a no-op for html without images", () => {
    const html = "<p>Sam tekst, zero obrazów.</p>";
    expect(enhanceContentImages(html)).toBe(html);
  });

  it("is idempotent", () => {
    const once = enhanceContentImages(`<img src="${SUPA}" alt="x">`);
    expect(enhanceContentImages(once)).toBe(once);
  });

  // --- CLS: intrinsic width/height from the WordPress -WxH filename suffix ---

  it("adds width/height from a WordPress sized-variant filename", () => {
    const out = enhanceContentImages(
      '<img src="https://wp.example.com/2024/07/photo-1024x768.jpg">',
    );
    expect(out).toContain('width="1024"');
    expect(out).toContain('height="768"');
  });

  it("derives dimensions even with a query string after the extension", () => {
    const out = enhanceContentImages('<img src="https://wp.example.com/a-800x600.webp?ver=2">');
    expect(out).toContain('width="800"');
    expect(out).toContain('height="600"');
  });

  it("does NOT invent dimensions when the size is unknown", () => {
    const out = enhanceContentImages('<img src="https://example.com/pic.png">');
    expect(out).not.toContain("width=");
    expect(out).not.toContain("height=");
  });

  it("leaves author-set width/height untouched (no override, no duplication)", () => {
    const html = '<img src="https://wp.example.com/photo-1024x768.jpg" width="640" height="480">';
    const out = enhanceContentImages(html);
    expect(out).toContain('width="640"');
    expect(out).toContain('height="480"');
    expect(out.match(/width=/g)).toHaveLength(1);
    expect(out.match(/height=/g)).toHaveLength(1);
    expect(out).not.toContain('width="1024"');
  });

  it("stays idempotent once width/height are added", () => {
    const once = enhanceContentImages('<img src="https://wp.example.com/photo-1024x768.jpg">');
    expect(enhanceContentImages(once)).toBe(once);
  });

  it("eagerFirstImage: pierwszy obraz eager+high, kolejne pozostaja lazy", () => {
    const html = '<p>x</p><img src="/a.jpg"><img src="/b.jpg">';
    const out = enhanceContentImages(html, { eagerFirstImage: true });
    const tags = out.match(/<img[^>]*>/g) ?? [];
    expect(tags[0]).toContain('loading="eager"');
    expect(tags[0]).toContain('fetchpriority="high"');
    expect(tags[1]).toContain('loading="lazy"');
    expect(tags[1]).not.toContain("fetchpriority");
  });

  it("eagerFirstImage nie nadpisuje jawnego loading autora", () => {
    const html = '<img loading="lazy" src="/a.jpg"><img src="/b.jpg">';
    const out = enhanceContentImages(html, { eagerFirstImage: true });
    const tags = out.match(/<img[^>]*>/g) ?? [];
    // Autor ustawil lazy - szanujemy; flaga dotyczy PIERWSZEGO <img> w tresci,
    // wiec drugi (bez jawnego loading) zostaje przy domyslnym lazy.
    expect(tags[0]).not.toContain("eager");
    expect(tags[1]).toContain('loading="lazy"');
  });

  it("domyslnie (bez opcji) wszystkie obrazy dostaja lazy - bez regresji", () => {
    const out = enhanceContentImages('<img src="/a.jpg">');
    expect(out).toContain('loading="lazy"');
    expect(out).not.toContain("eager");
  });
});

describe("imageDimsFromUrl", () => {
  it("reads the intrinsic size from a WordPress -WxH suffix", () => {
    expect(imageDimsFromUrl("https://wp.example.com/x/photo-1024x768.jpg")).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it("accepts png/webp/avif/gif and a trailing query or hash", () => {
    expect(imageDimsFromUrl("/a-300x200.png")).toEqual({ width: 300, height: 200 });
    expect(imageDimsFromUrl("/a-300x200.avif#x")).toEqual({ width: 300, height: 200 });
    expect(imageDimsFromUrl("/a-300x200.webp?v=1")).toEqual({ width: 300, height: 200 });
  });

  it("ignores retina @2x names and non-image suffixes", () => {
    expect(imageDimsFromUrl("https://ex.com/logo@2x.png")).toBeNull();
    expect(imageDimsFromUrl("https://ex.com/report-2x3.pdf")).toBeNull();
    expect(imageDimsFromUrl("https://ex.com/plain.jpg")).toBeNull();
  });

  it("rejects out-of-bounds / sub-10px dimensions (tracking pixels, junk)", () => {
    expect(imageDimsFromUrl("/px-1x1.gif")).toBeNull();
    expect(imageDimsFromUrl("/huge-30000x20000.jpg")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GAŁĘZIE ATRYBUTU `src` I ODMOWY DOKŁADANIA - część C.
//
// Testy wyżej używają WYŁĄCZNIE `src="..."` w cudzysłowie i tagów bez `sizes`
// oraz bez wymiarów. Poniżej domykamy alternatywy tej samej wyrażenia
// regularnego (apostrof, brak `src`) i trzy odmowy dokładania atrybutów.
// ---------------------------------------------------------------------------
describe("enhanceContentImages - warianty zapisu src i odmowy dokładania", () => {
  it("obraz BEZ atrybutu src dostaje tylko loading/decoding", () => {
    // Gałąź `: ""` w `srcMatch ? ... : ""`. Sanitizer przepuszcza `<img>` bez
    // `src` (np. po wycięciu adresu `data:`), a `isSupabaseStorageUrl("")`
    // i `imageDimsFromUrl("")` muszą wtedy w ogóle nie być pytane.
    const out = enhanceContentImages('<img alt="obraz bez adresu">');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
    expect(out).not.toContain("srcset=");
    expect(out).not.toContain("sizes=");
    expect(out).not.toContain("width=");
    expect(out).not.toContain("height=");
  });

  it("src zapisany w APOSTROFACH jest czytany tak samo jak w cudzysłowie", () => {
    // Alternatywa `srcMatch[3]` - druga grupa wyrażenia SRC_RE. Markdown i
    // importer WordPressa produkują oba warianty cytowania.
    const out = enhanceContentImages(`<img src='${SUPA}'>`);
    expect(out).toContain("srcset=");
    expect(out).toContain("sizes=");
    expect(out).toContain("/storage/v1/render/image/public/");
  });

  it("wymiary z nazwy pliku działają też przy src w apostrofach", () => {
    const out = enhanceContentImages("<img src='https://wp.example.com/photo-1024x768.jpg'>");
    expect(out).toContain('width="1024"');
    expect(out).toContain('height="768"');
  });

  it("tag z `sizes`, ale BEZ `srcset`, nie dostaje drugiego `sizes`", () => {
    // Gałąź `!/\ssizes\s*=/` fałszywa. Dwa atrybuty `sizes` w jednym tagu to
    // niepoprawny HTML - przeglądarka bierze pierwszy, więc autorski układ
    // zostałby po cichu zignorowany.
    const out = enhanceContentImages(`<img src="${SUPA}" sizes="100vw">`);
    expect(out.match(/sizes=/g)).toHaveLength(1);
    expect(out).toContain('sizes="100vw"');
    expect(out).toContain("srcset=");
  });

  it("SAM `height` autora blokuje dołożenie `width` - obu nie ruszamy", () => {
    // Drugi człon `!/\sheight\s*=/`. Kontrakt z komentarza produkcyjnego brzmi
    // "jeśli jest KTÓRYKOLWIEK wymiar, nie ruszamy obu" - dołożenie samego
    // `width` do autorskiego `height` zmieniłoby proporcje obrazu.
    const out = enhanceContentImages(
      '<img src="https://wp.example.com/photo-1024x768.jpg" height="480">',
    );
    expect(out).toContain('height="480"');
    expect(out).not.toContain('width="1024"');
    expect(out.match(/width=/g)).toBeNull();
  });

  it("SAM `width` autora również blokuje dołożenie `height`", () => {
    const out = enhanceContentImages(
      '<img src="https://wp.example.com/photo-1024x768.jpg" width="640">',
    );
    expect(out).toContain('width="640"');
    expect(out.match(/height=/g)).toBeNull();
  });

  it("pusty napis wraca pusty - bez wejścia w podmianę tagów", () => {
    // Człon `!sanitizedHtml`. Trasa woła tę funkcję również dla wpisów bez
    // treści HTML (silnik bloków/buildera), więc to ścieżka codzienna.
    expect(enhanceContentImages("")).toBe("");
    expect(enhanceContentImages("", { eagerFirstImage: true })).toBe("");
  });
});
