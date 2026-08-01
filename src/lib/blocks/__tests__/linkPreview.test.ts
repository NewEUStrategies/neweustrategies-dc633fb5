import { describe, expect, it } from "vitest";
import {
  clampPreviewSide,
  encodeQuery,
  isSafeHttpUrl,
  microlinkScreenshotUrl,
  normalizeImageSrc,
  normalizeLinkPreviewData,
  normalizeUrl,
  pickIntro,
  pickLabel,
  previewImageUrl,
} from "../linkPreview";

describe("linkPreview", () => {
  it("odrzuca niebezpieczne protokoły", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(normalizeUrl("javascript:alert(1)")).toBe("");
    expect(normalizeUrl("data:text/html,x")).toBe("");
    expect(normalizeUrl("example.com")).toBe("https://example.com");
    expect(normalizeUrl("https://a.pl/x")).toBe("https://a.pl/x");
  });

  it("normalizuje obrazek podglądu", () => {
    expect(normalizeImageSrc("/img/a.png")).toBe("/img/a.png");
    expect(normalizeImageSrc("cdn.pl/a.png")).toBe("https://cdn.pl/a.png");
    expect(normalizeImageSrc("javascript:1")).toBe("");
  });

  it("clampuje rozmiary podglądu", () => {
    expect(clampPreviewSide(10, 200)).toBe(120);
    expect(clampPreviewSide(9999, 200)).toBe(480);
    expect(clampPreviewSide("abc", 125)).toBe(125);
  });

  it("koduje query jak qss", () => {
    expect(encodeQuery({ url: "https://a.pl/?x=1", screenshot: true })).toBe(
      "url=https%3A%2F%2Fa.pl%2F%3Fx%3D1&screenshot=true",
    );
  });

  it("buduje URL zrzutu ekranu", () => {
    const url = microlinkScreenshotUrl({ url: "https://a.pl", width: 200, height: 125 });
    expect(url.startsWith("https://api.microlink.io/?")).toBe(true);
    expect(url).toContain("viewport.width=600");
    expect(url).toContain("viewport.height=375");
  });

  it("normalizuje dane bloku i pomija błędne linki", () => {
    const model = normalizeLinkPreviewData({
      introPl: "Zobacz",
      items: [
        { labelPl: "A", url: "a.pl" },
        { labelPl: "Zły", url: "javascript:1" },
        "nope",
      ],
      preview: false,
      layout: "list",
    });
    expect(model.items).toHaveLength(1);
    expect(model.items[0].url).toBe("https://a.pl");
    expect(model.preview).toBe(false);
    expect(model.layout).toBe("list");
    expect(model.width).toBe(200);
  });

  it("domyślnie włącza podgląd i układ inline", () => {
    const model = normalizeLinkPreviewData({});
    expect(model.preview).toBe(true);
    expect(model.layout).toBe("inline");
    expect(model.items).toEqual([]);
  });

  it("wybiera etykietę i intro wg języka z fallbackiem", () => {
    const model = normalizeLinkPreviewData({
      introPl: "Zobacz",
      items: [{ labelPl: "Strona", url: "https://a.pl" }],
    });
    expect(pickLabel(model.items[0], "en")).toBe("Strona");
    expect(pickIntro(model, "en")).toBe("Zobacz");
  });

  it("preferuje statyczny obrazek nad zrzutem ekranu", () => {
    const model = normalizeLinkPreviewData({
      items: [{ labelPl: "A", url: "https://a.pl", imageSrc: "/img/a.png" }],
    });
    expect(previewImageUrl(model.items[0], model)).toBe("/img/a.png");
  });
});
