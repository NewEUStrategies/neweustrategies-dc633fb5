import { describe, it, expect } from "vitest";
import { resolveMediaCategory, isRenderableImage, resolvePreviewKind } from "../mediaKind";

describe("resolveMediaCategory", () => {
  it("classifies by MIME first", () => {
    expect(resolveMediaCategory("video/mp4", "clip.mp4")).toBe("video");
    expect(resolveMediaCategory("audio/mpeg", "song.mp3")).toBe("audio");
    expect(resolveMediaCategory("image/png", "pic.png")).toBe("image");
  });

  it("recognises PDFs by MIME or extension", () => {
    expect(resolveMediaCategory("application/pdf", "doc")).toBe("pdf");
    expect(resolveMediaCategory(null, "doc.pdf")).toBe("pdf");
  });

  it("classifies office documents and spreadsheets by extension", () => {
    expect(resolveMediaCategory(null, "report.docx")).toBe("document");
    expect(resolveMediaCategory(null, "budget.xlsx")).toBe("document");
    expect(resolveMediaCategory(null, "data.csv")).toBe("document");
  });

  it("classifies ebooks", () => {
    expect(resolveMediaCategory(null, "book.epub")).toBe("ebook");
  });

  it("falls back to other for unknown types", () => {
    expect(resolveMediaCategory(null, "mystery.xyz")).toBe("other");
    expect(resolveMediaCategory(null, "noext")).toBe("other");
  });
});

describe("isRenderableImage", () => {
  it("is true for real bitmaps and vectors", () => {
    expect(isRenderableImage("image/png", "a.png")).toBe(true);
    expect(isRenderableImage("image/svg+xml", "a.svg")).toBe(true);
  });

  it("is false for animated GIFs (shown as an icon)", () => {
    expect(isRenderableImage("image/gif", "a.gif")).toBe(false);
  });

  it("is false when there is no image MIME", () => {
    expect(isRenderableImage(null, "a.png")).toBe(false);
  });
});

describe("resolvePreviewKind", () => {
  it("returns the viewer for each family", () => {
    expect(resolvePreviewKind("image/png", "a.png")).toBe("image");
    expect(resolvePreviewKind("video/mp4", "a.mp4")).toBe("video");
    expect(resolvePreviewKind("audio/mpeg", "a.mp3")).toBe("audio");
    expect(resolvePreviewKind("application/pdf", "a.pdf")).toBe("pdf");
    expect(resolvePreviewKind("text/plain", "a.txt")).toBe("text");
    expect(resolvePreviewKind(null, "a.docx")).toBe("office");
  });

  it("falls back to extension when MIME is missing", () => {
    expect(resolvePreviewKind(null, "a.webp")).toBe("image");
    expect(resolvePreviewKind(null, "a.json")).toBe("text");
  });

  it("returns other for unknown or empty inputs", () => {
    expect(resolvePreviewKind(null, "a.bin")).toBe("other");
    expect(resolvePreviewKind(null, undefined)).toBe("other");
    expect(resolvePreviewKind("", "")).toBe("other");
  });
});
