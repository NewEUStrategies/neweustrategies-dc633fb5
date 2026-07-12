import { describe, it, expect } from "vitest";
import {
  buildTrackedClickUrl,
  isSafeHttpUrl,
  isValidTrackingToken,
  rewriteTrackingLinks,
  trackingPixelImg,
  trackingPixelUrl,
} from "./tracking";

const ORIGIN = "https://news.example.com";
const CID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "a1b2c3d4e5f60718"; // 16 hex chars

describe("isValidTrackingToken", () => {
  it("accepts 16-128 hex chars", () => {
    expect(isValidTrackingToken(TOKEN)).toBe(true);
    expect(isValidTrackingToken("f".repeat(128))).toBe(true);
  });
  it("rejects too short / non-hex / empty", () => {
    expect(isValidTrackingToken("abc")).toBe(false);
    expect(isValidTrackingToken("g".repeat(20))).toBe(false);
    expect(isValidTrackingToken(null)).toBe(false);
    expect(isValidTrackingToken("f".repeat(129))).toBe(false);
  });
});

describe("isSafeHttpUrl (open-redirect guard)", () => {
  it("accepts absolute http/https", () => {
    expect(isSafeHttpUrl("https://example.com/x?a=1")).toBe(true);
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
  });
  it("rejects dangerous / relative / protocol-relative targets", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,x")).toBe(false);
    expect(isSafeHttpUrl("mailto:a@b.com")).toBe(false);
    expect(isSafeHttpUrl("//evil.com")).toBe(false);
    expect(isSafeHttpUrl("/relative/path")).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
  });
});

describe("buildTrackedClickUrl", () => {
  it("routes through nl-click with the target percent-encoded", () => {
    const url = buildTrackedClickUrl(ORIGIN, CID, TOKEN, "https://dest.com/a?x=1&y=2");
    const parsed = new URL(url);
    expect(parsed.origin).toBe(ORIGIN);
    expect(parsed.pathname).toBe("/api/public/nl-click");
    expect(parsed.searchParams.get("c")).toBe(CID);
    expect(parsed.searchParams.get("s")).toBe(TOKEN);
    // Full round-trip of the (encoded) target, incl. its own query separators.
    expect(parsed.searchParams.get("u")).toBe("https://dest.com/a?x=1&y=2");
  });
});

describe("trackingPixelUrl / trackingPixelImg", () => {
  it("builds the open pixel URL", () => {
    const parsed = new URL(trackingPixelUrl(ORIGIN, CID, TOKEN));
    expect(parsed.pathname).toBe("/api/public/nl-open");
    expect(parsed.searchParams.get("c")).toBe(CID);
    expect(parsed.searchParams.get("s")).toBe(TOKEN);
  });
  it("emits a 1x1 hidden img with an HTML-safe src", () => {
    const img = trackingPixelImg(ORIGIN, CID, TOKEN);
    expect(img).toContain('width="1"');
    expect(img).toContain('height="1"');
    expect(img).toContain("display:none");
    expect(img).toContain("&amp;"); // & separators escaped for the attribute
    expect(img).not.toMatch(/&(?!amp;)/); // no bare & in the markup
  });
});

describe("rewriteTrackingLinks", () => {
  it("rewrites absolute http/https hrefs through nl-click", () => {
    const html = '<p><a href="https://dest.com/read">Read</a></p>';
    const out = rewriteTrackingLinks(html, ORIGIN, CID, TOKEN);
    expect(out).toContain("/api/public/nl-click");
    expect(out).toContain(encodeURIComponent("https://dest.com/read"));
    expect(out).toContain("Read</a>"); // link text untouched
  });

  it("decodes &amp; in the source href before re-encoding (valid round-trip)", () => {
    const html = '<a href="https://dest.com/p?a=1&amp;b=2">x</a>';
    const out = rewriteTrackingLinks(html, ORIGIN, CID, TOKEN);
    // Extract the tracked href and read back the `u` param.
    const m = out.match(/href="([^"]+)"/);
    expect(m).toBeTruthy();
    const href = (m![1] as string).replace(/&amp;/g, "&");
    expect(new URL(href).searchParams.get("u")).toBe("https://dest.com/p?a=1&b=2");
  });

  it("preserves single-quoted hrefs and leaves non-http links alone", () => {
    const html =
      '<a href=\'https://x.com\'>q</a><a href="mailto:a@b.com">m</a><a href="#top">t</a>';
    const out = rewriteTrackingLinks(html, ORIGIN, CID, TOKEN);
    expect(out).toContain("/api/public/nl-click"); // https rewritten
    expect(out).toContain('href="mailto:a@b.com"'); // untouched
    expect(out).toContain('href="#top"'); // untouched
  });
});
