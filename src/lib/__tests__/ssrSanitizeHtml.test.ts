/**
 * The DOM-free sanitizer that backs sanitizeHtml/sanitizeMarkdownHtml during
 * SSR (workerd has no DOM, so DOMPurify cannot run there - see
 * lib/ssrSanitizeHtml.ts). Vitest runs with happy-dom, so the browser
 * DOMPurify path is covered by lib/sanitize.test.ts; these tests target the
 * server engine directly.
 */
import { describe, it, expect } from "vitest";

import { ssrSanitizeHtml } from "../ssrSanitizeHtml";

describe("ssrSanitizeHtml", () => {
  it("keeps standard content markup", () => {
    const input =
      '<h2 id="t">Tytuł</h2><p class="lead">Ala ma <strong>kota</strong> &amp; psa.</p>' +
      "<ul><li>jeden</li><li>dwa</li></ul><pre><code>x &lt; y</code></pre>";
    const out = ssrSanitizeHtml(input);
    expect(out).toContain('<h2 id="t">Tytuł</h2>');
    expect(out).toContain('<p class="lead">Ala ma <strong>kota</strong> &amp; psa.</p>');
    expect(out).toContain("<li>jeden</li>");
    expect(out).toContain("<pre><code>x &lt; y</code></pre>");
  });

  it("drops script/style/iframe/object/embed with their content", () => {
    const out = ssrSanitizeHtml(
      '<p>ok</p><script>alert(1)</script><style>.x{}</style><iframe src="https://x"></iframe>' +
        '<object data="x"></object><embed src="x">',
    );
    expect(out).toBe("<p>ok</p>");
  });

  it("unwraps unknown and forbidden-but-benign tags but keeps children", () => {
    expect(ssrSanitizeHtml("<form><p>tekst</p></form>")).toBe("<p>tekst</p>");
    expect(ssrSanitizeHtml("<custom-tag>abc</custom-tag>")).toBe("abc");
  });

  it("strips event handlers and exotic attributes", () => {
    const out = ssrSanitizeHtml(
      '<a href="/x" onclick="alert(1)" data-track="a" xlink:href="j">x</a>',
    );
    expect(out).toBe('<a href="/x" data-track="a">x</a>');
    expect(ssrSanitizeHtml('<img src="/a.png" onerror="alert(1)">')).toBe('<img src="/a.png">');
  });

  it("blocks javascript: and other unsafe URLs, including entity-obfuscated ones", () => {
    expect(ssrSanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(ssrSanitizeHtml('<a href="java&#115;cript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(ssrSanitizeHtml('<a href="\tjavascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(ssrSanitizeHtml('<img src="data:text/html;base64,xx">')).toBe("<img>");
    expect(ssrSanitizeHtml('<img src="data:image/png;base64,xx">')).toBe(
      '<img src="data:image/png;base64,xx">',
    );
    expect(ssrSanitizeHtml('<a href="https://x.example/y">x</a>')).toBe(
      '<a href="https://x.example/y">x</a>',
    );
  });

  it("drops svg/math foreign content entirely", () => {
    expect(ssrSanitizeHtml("<svg><script>alert(1)</script></svg><p>ok</p>")).toBe("<p>ok</p>");
    expect(ssrSanitizeHtml("<math><mi>x</mi></math><p>ok</p>")).toBe("<p>ok</p>");
  });

  it("re-escapes text so markup cannot smuggle through attribute-decoded values", () => {
    const out = ssrSanitizeHtml('<p title="&lt;img src=x onerror=alert(1)&gt;">x</p>');
    expect(out).toBe('<p title="&lt;img src=x onerror=alert(1)&gt;">x</p>');
    expect(out).not.toContain("<img");
  });

  it("strips style attributes unless allowed, and hardens allowed ones", () => {
    expect(ssrSanitizeHtml('<p style="color:red">x</p>')).toBe("<p>x</p>");
    expect(ssrSanitizeHtml('<p style="color:red">x</p>', { allowStyleAttr: true })).toBe(
      '<p style="color:red">x</p>',
    );
    expect(
      ssrSanitizeHtml('<p style="background:url(https://evil/px)">x</p>', {
        allowStyleAttr: true,
      }),
    ).toBe("<p>x</p>");
  });

  it("restricts target values and keeps boolean attributes", () => {
    expect(ssrSanitizeHtml('<a href="/x" target="_blank">x</a>')).toBe(
      '<a href="/x" target="_blank">x</a>',
    );
    expect(ssrSanitizeHtml('<a href="/x" target="frame">x</a>')).toBe('<a href="/x">x</a>');
    expect(ssrSanitizeHtml("<details open><summary>s</summary>b</details>")).toBe(
      "<details open><summary>s</summary>b</details>",
    );
  });

  it("drops comments and doctype noise", () => {
    expect(ssrSanitizeHtml("<!doctype html><!-- c --><p>ok</p>")).toBe("<p>ok</p>");
  });

  it("returns empty string for empty input", () => {
    expect(ssrSanitizeHtml("")).toBe("");
  });
});
