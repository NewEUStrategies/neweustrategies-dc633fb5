import { describe, expect, it } from "vitest";
import { CHAT_PREVIEW_CHARS, truncatePreview } from "../preview";

describe("truncatePreview", () => {
  it("krótsza wiadomość zostaje w całości", () => {
    expect(truncatePreview("Cześć")).toBe("Cześć");
  });

  it("liczy 30 znaków RAZEM ze spacjami", () => {
    const text = "a".repeat(20) + " " + "b".repeat(20);
    const out = truncatePreview(text);
    expect(Array.from(out)).toHaveLength(CHAT_PREVIEW_CHARS + 1);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, -1)).toBe("a".repeat(20) + " " + "b".repeat(9));
  });

  it("dokładnie 30 znaków nie dostaje wielokropka", () => {
    const text = "x".repeat(CHAT_PREVIEW_CHARS);
    expect(truncatePreview(text)).toBe(text);
  });

  it("spłaszcza złamania linii i przycina brzegi", () => {
    expect(truncatePreview("  linia\n\n druga  ")).toBe("linia druga");
  });

  it("nie tnie emoji na pół", () => {
    const out = truncatePreview("😀".repeat(40), 3);
    expect(out).toBe("😀😀😀…");
  });

  it("własny limit działa", () => {
    expect(truncatePreview("abcdef", 3)).toBe("abc…");
  });
});
