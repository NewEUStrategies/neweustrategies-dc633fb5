import { describe, it, expect } from "vitest";
import {
  escapeInlineText,
  inlineHtmlToText,
  looksLikeInlineHtml,
  safeCssColor,
  stripParagraphWrapper,
  toParagraphDoc,
} from "@/lib/blocks/inlineHtml";
import { resolveBlockAnchors } from "@/lib/blocks/anchors";
import { extractHeadingsFromBlockList } from "@/lib/toc/settings";
import type { Block } from "@/lib/blocks/types";

describe("inlineHtml helpers", () => {
  it("rozpoznaje inline HTML vs czysty tekst", () => {
    expect(looksLikeInlineHtml("<strong>A</strong>")).toBe(true);
    expect(looksLikeInlineHtml("Zwykły tytuł")).toBe(false);
  });

  it("escapuje tekst wstawiany do treści bloku (anty-wstrzyknięcie markupu)", () => {
    expect(escapeInlineText("<")).toBe("&lt;");
    expect(escapeInlineText("a & b > c")).toBe("a &amp; b &gt; c");
    expect(escapeInlineText('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror="alert(1)"&gt;',
    );
    expect(escapeInlineText("ą")).toBe("ą");
  });

  it("zdejmuje wrapper <p> i skleja wiele akapitów przez <br>", () => {
    expect(stripParagraphWrapper("<p>Tytuł <em>x</em></p>")).toBe("Tytuł <em>x</em>");
    expect(stripParagraphWrapper("<p>A</p><p>B</p>")).toBe("A<br>B");
    expect(stripParagraphWrapper("<p></p>")).toBe("");
    expect(toParagraphDoc("A")).toBe("<p>A</p>");
  });

  it("zamienia inline HTML na czysty tekst", () => {
    expect(inlineHtmlToText('<span style="color:#111">Kontynent</span> <b>x</b>')).toBe(
      "Kontynent x",
    );
  });

  it("przepuszcza tylko bezpieczne kolory", () => {
    expect(safeCssColor("#fff")).toBe("#fff");
    expect(safeCssColor("var(--primary)")).toBe("var(--primary)");
    expect(safeCssColor("url(javascript:alert(1))")).toBeUndefined();
    expect(safeCssColor("expression(1)")).toBeUndefined();
    expect(safeCssColor(42)).toBeUndefined();
  });
});

const heading = (text: string): Block => ({
  id: "h1",
  type: "heading",
  data: { level: 2, text },
});

describe("nagłówki z formatowaniem inline", () => {
  it("kotwica zależy od treści, nie od znaczników", () => {
    const plain = [heading("Kontynent doskonale zdiagnozowany")];
    const rich = [heading("<strong>Kontynent</strong> doskonale zdiagnozowany")];
    expect(resolveBlockAnchors(rich).get("h1")?.id).toBe(resolveBlockAnchors(plain).get("h1")?.id);
  });

  it("spis treści pokazuje czysty tekst nagłówka", () => {
    const items = extractHeadingsFromBlockList([
      heading('<em>Kontynent</em> <span style="color:#c0392b">zdiagnozowany</span>'),
    ]);
    expect(items[0]?.text).toBe("Kontynent zdiagnozowany");
  });
});
