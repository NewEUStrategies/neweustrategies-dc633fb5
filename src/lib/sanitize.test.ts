// @vitest-environment node
//
// Node environment on purpose: with no DOM, sanitizeHtml/sanitizeMarkdownHtml
// take their SSR branch (the engine that actually guards server-rendered
// output in the Cloudflare Worker - see lib/ssrSanitizeHtml.ts). Under
// happy-dom these tests would instead exercise DOMPurify against a partial
// DOM emulation it does not fully support (e.g. <style> handling diverges
// from real browsers). The browser DOMPurify path is covered by Playwright
// against a real Chromium.
import { describe, it, expect } from "vitest";
import {
  sanitizeHtml,
  sanitizeHtmlId,
  sanitizeCssClass,
  scopeCustomCss,
  safeUrl,
  safeImageUrl,
  hardenStyleCss,
} from "./sanitize";

describe("sanitize", () => {
  it("strips script/style/iframe", () => {
    const html = sanitizeHtml("<p>ok</p><script>alert(1)</script><style>x</style>");
    expect(html).toContain("<p>ok</p>");
    expect(html).not.toContain("script");
    expect(html).not.toContain("<style");
  });

  it("removes inline event handlers", () => {
    const html = sanitizeHtml('<a href="#" onclick="alert(1)">x</a>');
    expect(html).not.toContain("onclick");
  });

  it("validates html id", () => {
    expect(sanitizeHtmlId("good-id_1")).toBe("good-id_1");
    expect(sanitizeHtmlId("1bad")).toBeUndefined();
    expect(sanitizeHtmlId("<x>")).toBeUndefined();
  });

  it("validates css class", () => {
    expect(sanitizeCssClass("a b-c d_e")).toBe("a b-c d_e");
    expect(sanitizeCssClass("a;b{}")).toBeUndefined();
  });

  it("rejects dangerous CSS", () => {
    expect(scopeCustomCss("</style><script>", "x")).toBe("");
    expect(scopeCustomCss("@import url('x')", "x")).toBe("");
    expect(scopeCustomCss("a { background: expression(1) }", "x")).toBe("");
  });

  it("scopes safe CSS", () => {
    const out = scopeCustomCss(".btn { color: red }", "w1");
    expect(out).toContain('[data-w-id="w1"] .btn');
    expect(out).toContain("color: red");
  });

  it("scopes selectors inside @media and keeps the block balanced", () => {
    const out = scopeCustomCss("@media (max-width: 600px) { .btn { color: red } }", "w1");
    expect(out).toContain("@media (max-width: 600px)");
    expect(out).toContain('[data-w-id="w1"] .btn');
    // The @media wrapper must not leave the inner selector unscoped, and braces
    // must stay balanced (the old split-on-"}" logic dropped the closing brace).
    expect(out).not.toMatch(/@media[^{]*\{\s*\.btn/);
    expect((out.match(/\{/g) ?? []).length).toBe((out.match(/\}/g) ?? []).length);
  });

  it("does not prefix @keyframes stops", () => {
    const out = scopeCustomCss("@keyframes spin { from { opacity: 0 } to { opacity: 1 } }", "w1");
    expect(out).toContain("@keyframes spin");
    expect(out).not.toContain('[data-w-id="w1"] from');
    expect(out).not.toContain('[data-w-id="w1"] to');
  });

  it("safeUrl allows http/mailto/anchor; blocks js:", () => {
    expect(safeUrl("https://x.com")).toBe("https://x.com");
    expect(safeUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeUrl("#sec")).toBe("#sec");
    expect(safeUrl("javascript:alert(1)")).toBe("#");
  });

  it("safeImageUrl allows http/data:image", () => {
    expect(safeImageUrl("https://x/y.png")).toBe("https://x/y.png");
    expect(safeImageUrl("data:image/png;base64,xxx")).toBe("data:image/png;base64,xxx");
    expect(safeImageUrl("data:text/html,x")).toBe("");
    expect(safeImageUrl("javascript:1")).toBe("");
  });

  it("hardenStyleCss neutralizes a </style> breakout from a stored value", () => {
    const out = hardenStyleCss(":root{--c: red}</style><script>alert(1)</script>{");
    expect(out).not.toContain("</style");
    expect(out).not.toContain("</script");
    // Legitimate CSS is preserved.
    expect(out).toContain("--c: red");
  });

  it("hardenStyleCss handles case and spacing variants", () => {
    expect(hardenStyleCss("a{}</STYLE >")).not.toMatch(/<\s*\/\s*style/i);
    expect(hardenStyleCss("a{}< / script>")).not.toMatch(/<\s*\/\s*script/i);
    expect(hardenStyleCss("a{}<!--x-->")).not.toContain("<!--");
  });

  it("hardenStyleCss leaves valid CSS (> combinators, @media, ranges) untouched", () => {
    const input =
      ".a > .b{color:red}@media (min-width:700px){.a{color:blue}}@container (width < 400px){.x{}}";
    expect(hardenStyleCss(input)).toBe(input);
  });
});
