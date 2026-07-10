import { describe, expect, it } from "vitest";
import { enhanceContentImages } from "../enhanceImages";

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
});
