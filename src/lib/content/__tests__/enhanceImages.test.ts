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
