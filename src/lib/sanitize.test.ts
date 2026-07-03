import { describe, it, expect } from "vitest";
import {
  sanitizeHtml,
  sanitizeHtmlId,
  sanitizeCssClass,
  scopeCustomCss,
  safeUrl,
  safeImageUrl,
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
});
