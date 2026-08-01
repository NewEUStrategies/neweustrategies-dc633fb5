import { describe, it, expect } from "vitest";
import { filesToImageBlocks, isImageFile } from "@/lib/blocks/imagePaste";

const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

describe("isImageFile", () => {
  it("accepts image/* and rejects the rest", () => {
    expect(isImageFile(new File([PNG_BYTES], "a.png", { type: "image/png" }))).toBe(true);
    expect(isImageFile(new File(["x"], "a.txt", { type: "text/plain" }))).toBe(false);
  });
});

describe("filesToImageBlocks", () => {
  it("turns image files into image blocks with data URLs and alt from filename", async () => {
    const file = new File([PNG_BYTES], "zrzut ekranu.png", { type: "image/png" });
    const blocks = await filesToImageBlocks([file]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("image");
    expect(String(blocks[0].data.url)).toMatch(/^data:image\/png;base64,/);
    expect(blocks[0].data.alt).toBe("zrzut ekranu");
    expect(blocks[0].data.align).toBe("center");
  });

  it("skips non-image files silently", async () => {
    const txt = new File(["hello"], "notes.txt", { type: "text/plain" });
    const img = new File([PNG_BYTES], "img.png", { type: "image/png" });
    const blocks = await filesToImageBlocks([txt, img]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].data.alt).toBe("img");
  });

  it("returns an empty list for no usable files", async () => {
    expect(await filesToImageBlocks([])).toEqual([]);
  });
});
