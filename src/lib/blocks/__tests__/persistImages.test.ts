import { describe, it, expect, vi } from "vitest";
import {
  collectDataUrlImages,
  replaceDataUrlImages,
  decodeDataUrlImage,
  persistDataUrlImages,
} from "@/lib/blocks/persistImages";
import type { Json } from "@/lib/blocks/types";

// 1x1 PNG
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const doc: Json = {
  pl: {
    version: 1,
    blocks: [
      { id: "b_1", type: "image", data: { url: PNG, alt: "wklejka" } },
      { id: "b_2", type: "html", data: { html: `<figure><img src="${PNG}"/></figure>` } },
      { id: "b_3", type: "image", data: { url: "https://cdn.example.com/a.jpg" } },
    ],
  },
  en: { version: 1, blocks: [] },
};

describe("collectDataUrlImages", () => {
  it("finds data URLs both as field values and embedded in HTML", () => {
    const urls = collectDataUrlImages(doc);
    expect(urls).toEqual([PNG]);
  });

  it("ignores http(s) URLs", () => {
    expect(collectDataUrlImages({ url: "https://x/y.png" } as Json)).toEqual([]);
  });
});

describe("replaceDataUrlImages", () => {
  it("returns the SAME reference when the map hits nothing (no phantom form change)", () => {
    const map = new Map([["data:image/png;base64,INNY-OBRAZ", "https://cdn/x.png"]]);
    expect(replaceDataUrlImages(doc, map)).toBe(doc);
  });

  it("replaces values and HTML-embedded occurrences", () => {
    const map = new Map([[PNG, "https://cdn/site/img.png"]]);
    const out = replaceDataUrlImages(doc, map) as {
      pl: { blocks: Array<{ data: Record<string, unknown> }> };
    };
    expect(out.pl.blocks[0].data.url).toBe("https://cdn/site/img.png");
    expect(String(out.pl.blocks[1].data.html)).toContain('src="https://cdn/site/img.png"');
    expect(String(out.pl.blocks[1].data.html)).not.toContain("data:image/");
    // Nietknięte pola pozostają
    expect(out.pl.blocks[2].data.url).toBe("https://cdn.example.com/a.jpg");
  });
});

describe("decodeDataUrlImage", () => {
  it("decodes mime, bytes and proposes a filename", () => {
    const decoded = decodeDataUrlImage(PNG, 0)!;
    expect(decoded.mime).toBe("image/png");
    expect(decoded.filename).toBe("wklejony-obraz-1.png");
    expect(decoded.bytes.length).toBeGreaterThan(20);
  });

  it("returns null for malformed input", () => {
    expect(decodeDataUrlImage("data:text/plain;base64,aGk=", 0)).toBeNull();
    expect(decodeDataUrlImage("data:image/png;base64,%%%", 0)).toBeNull();
  });
});

describe("persistDataUrlImages", () => {
  it("uploads each unique image once and rewrites the doc", async () => {
    const upload = vi.fn().mockResolvedValue("https://cdn/site/uploaded.png");
    const result = await persistDataUrlImages(doc, upload);
    expect(upload).toHaveBeenCalledTimes(1); // ten sam PNG w dwóch miejscach = 1 upload
    expect(result.uploaded).toBe(1);
    expect(result.changed).toBe(true);
    const out = result.doc as { pl: { blocks: Array<{ data: Record<string, unknown> }> } };
    expect(out.pl.blocks[0].data.url).toBe("https://cdn/site/uploaded.png");
    expect(String(out.pl.blocks[1].data.html)).toContain("https://cdn/site/uploaded.png");
  });

  it("uses the cache to skip re-uploads across saves", async () => {
    const cache = new Map([[PNG, "https://cdn/site/cached.png"]]);
    const upload = vi.fn();
    const result = await persistDataUrlImages(doc, upload, cache);
    expect(upload).not.toHaveBeenCalled();
    expect(result.changed).toBe(true);
    const out = result.doc as { pl: { blocks: Array<{ data: Record<string, unknown> }> } };
    expect(out.pl.blocks[0].data.url).toBe("https://cdn/site/cached.png");
  });

  it("keeps the data URL and counts a failure when upload throws", async () => {
    const upload = vi.fn().mockRejectedValue(new Error("network"));
    const result = await persistDataUrlImages(doc, upload);
    expect(result.failed).toBe(1);
    expect(result.changed).toBe(false);
    const out = result.doc as { pl: { blocks: Array<{ data: Record<string, unknown> }> } };
    expect(out.pl.blocks[0].data.url).toBe(PNG); // dokument nietknięty, zapis idzie dalej
  });

  it("is a no-op for documents without data URLs", async () => {
    const upload = vi.fn();
    const result = await persistDataUrlImages({ a: [1, "x", null] } as Json, upload);
    expect(upload).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
  });
});
