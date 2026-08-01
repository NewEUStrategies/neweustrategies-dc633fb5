import { describe, it, expect } from "vitest";
import { htmlTextLength, innerInlineHtml, mergeInlineIntoHtml } from "@/lib/blocks/merge";

describe("htmlTextLength", () => {
  it("counts text characters like DOM textContent (entities decoded, tags dropped)", () => {
    expect(htmlTextLength("<p>abc</p>")).toBe(3);
    expect(htmlTextLength("a<strong>b</strong>c")).toBe(3);
    expect(htmlTextLength("a&amp;b")).toBe(3);
    expect(htmlTextLength("")).toBe(0);
    expect(htmlTextLength("<p><br></p>")).toBe(0);
  });
});

describe("innerInlineHtml", () => {
  it("strips a single outer paragraph wrapper", () => {
    expect(innerInlineHtml("<p>abc <em>x</em></p>")).toBe("abc <em>x</em>");
  });

  it("joins multiple paragraphs with <br> instead of nesting <p>", () => {
    expect(innerInlineHtml("<p>a</p><p>b</p>")).toBe("a<br>b");
  });

  it("passes through inline-only content unchanged", () => {
    expect(innerInlineHtml("abc <strong>x</strong>")).toBe("abc <strong>x</strong>");
    expect(innerInlineHtml("")).toBe("");
  });
});

describe("mergeInlineIntoHtml", () => {
  it("appends inside the previous paragraph and reports the junction offset", () => {
    const merged = mergeInlineIntoHtml("<p>Hello </p>", "world");
    expect(merged.html).toBe("<p>Hello world</p>");
    expect(merged.caretOffset).toBe(6); // "Hello " przed punktem złączenia
  });

  it("keeps inline formatting from both sides", () => {
    const merged = mergeInlineIntoHtml("<p>a<strong>b</strong></p>", "<em>c</em>d");
    expect(merged.html).toBe("<p>a<strong>b</strong><em>c</em>d</p>");
    expect(merged.caretOffset).toBe(2);
  });

  it("handles an empty previous block (caret at 0)", () => {
    const merged = mergeInlineIntoHtml("", "tail");
    expect(merged.html).toBe("<p>tail</p>");
    expect(merged.caretOffset).toBe(0);
  });

  it("handles an empty incoming side (no content change)", () => {
    const merged = mergeInlineIntoHtml("<p>abc</p>", "");
    expect(merged.html).toBe("<p>abc</p>");
    expect(merged.caretOffset).toBe(3);
  });

  it("concatenates when the previous html has no paragraph wrapper (heading text)", () => {
    const merged = mergeInlineIntoHtml("Tytuł", "ogon");
    expect(merged.html).toBe("Tytułogon");
    expect(merged.caretOffset).toBe(5);
  });
});
