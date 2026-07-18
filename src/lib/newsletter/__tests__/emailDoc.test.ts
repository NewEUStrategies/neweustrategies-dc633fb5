import { describe, it, expect } from "vitest";
import {
  parseEmailDoc,
  createEmailBlock,
  createDefaultEmailDoc,
  emailDocHasContent,
  EMAIL_BLOCK_TYPES,
  DEFAULT_EMAIL_DOC_STYLE,
  type EmailPostListBlock,
  type EmailSpacerBlock,
} from "../emailDoc";

describe("createEmailBlock", () => {
  it("creates every palette type with a stable id", () => {
    for (const type of EMAIL_BLOCK_TYPES) {
      const b = createEmailBlock(type);
      expect(b.type).toBe(type);
      expect(b.id).toBeTruthy();
    }
  });

  it("post-list defaults to latest/3/list", () => {
    const b = createEmailBlock("post-list") as EmailPostListBlock;
    expect(b.mode).toBe("latest");
    expect(b.count).toBe(3);
    expect(b.layout).toBe("list");
    expect(b.showExcerpt).toBe(true);
  });
});

describe("createDefaultEmailDoc", () => {
  it("produces a renderable starter doc", () => {
    const doc = createDefaultEmailDoc();
    expect(doc.version).toBe(1);
    expect(doc.blocks.length).toBeGreaterThan(0);
    expect(emailDocHasContent(doc)).toBe(true);
  });
});

describe("parseEmailDoc", () => {
  it("rejects non-doc input", () => {
    expect(parseEmailDoc(null)).toBeNull();
    expect(parseEmailDoc({ version: 2, blocks: [] })).toBeNull();
    expect(parseEmailDoc({ version: 1 })).toBeNull();
    expect(parseEmailDoc("nope")).toBeNull();
  });

  it("keeps valid blocks and drops malformed ones", () => {
    const doc = parseEmailDoc({
      version: 1,
      blocks: [
        { id: "a", type: "heading", text: { pl: "Tytuł", en: "Title" }, level: 1, align: "center" },
        { id: "b", type: "not-a-real-type" },
        { type: "spacer", size: 12 },
        null,
        42,
      ],
    });
    expect(doc).not.toBeNull();
    expect(doc!.blocks.map((b) => b.type)).toEqual(["heading", "spacer"]);
  });

  it("clamps spacer size and defaults missing fields", () => {
    const doc = parseEmailDoc({
      version: 1,
      blocks: [{ type: "spacer", size: 9999 }],
    });
    const spacer = doc!.blocks[0] as EmailSpacerBlock;
    expect(spacer.size).toBe(96);
  });

  it("coerces post-list numeric/enum fields defensively", () => {
    const doc = parseEmailDoc({
      version: 1,
      blocks: [
        {
          type: "post-list",
          heading: { pl: "", en: "" },
          mode: "weird",
          count: 999,
          layout: "cards",
          postIds: ["p1", 2, "p2", null],
          showExcerpt: "yes",
        },
      ],
    });
    const b = doc!.blocks[0] as EmailPostListBlock;
    expect(b.mode).toBe("latest"); // unknown -> latest
    expect(b.count).toBe(10); // clamped
    expect(b.layout).toBe("cards");
    expect(b.postIds).toEqual(["p1", "p2"]); // non-strings dropped
    expect(typeof b.showExcerpt).toBe("boolean");
  });

  it("validates hex style and falls back to defaults", () => {
    const doc = parseEmailDoc({
      version: 1,
      blocks: [],
      style: { accent: "#abc", fg: "not-a-color", muted: "#123456", bg: 999 },
    });
    expect(doc!.style.accent).toBe("#abc");
    expect(doc!.style.fg).toBe(DEFAULT_EMAIL_DOC_STYLE.fg);
    expect(doc!.style.muted).toBe("#123456");
    expect(doc!.style.bg).toBe(DEFAULT_EMAIL_DOC_STYLE.bg);
  });

  it("emailDocHasContent is false for empty/null docs", () => {
    expect(emailDocHasContent(null)).toBe(false);
    expect(emailDocHasContent(parseEmailDoc({ version: 1, blocks: [] }))).toBe(false);
  });
});
