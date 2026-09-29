import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { popupGallerySizes, popupImageSource, warmPopupImages } from "../popupImages";

afterEach(() => vi.unstubAllGlobals());

describe("popup image warmup", () => {
  it("requests exactly the responsive candidates that the visible gallery will render", () => {
    const images: HTMLImageElement[] = [];
    vi.stubGlobal(
      "Image",
      class {
        constructor() {
          const image = document.createElement("img");
          images.push(image);
          return image;
        }
      },
    );
    const settings = defaultNewsletterSettings();
    settings.popup_layout = "showcase";
    settings.popup_showcase_images = Array.from({ length: 5 }, (_, i) => ({
      url: `https://neweuropeanstrategies.com/media/${i}.jpg`,
      caption_pl: "",
      caption_en: "",
    }));
    warmPopupImages(settings);
    expect(images).toHaveLength(4);
    for (const [index, image] of images.entries()) {
      const { gallery, panel } = settings.popup_design;
      const source = popupImageSource(
        settings.popup_showcase_images[index].url,
        popupGallerySizes(panel.maxWidthPx, panel.split, gallery.paddingPx, gallery.grid, 4, index),
      );
      expect(image.getAttribute("src")).toBe(source.src);
      expect(image.srcset).toBe(source.srcSet);
      expect(image.sizes).toBe(source.sizes);
      expect(image.fetchPriority).toBe("low");
    }
  });

  it("only warms the first slide of a single-image gallery and does not speculate to external hosts", () => {
    const create = vi.fn(function () {
      return document.createElement("img");
    });
    vi.stubGlobal("Image", create);
    const settings = defaultNewsletterSettings();
    settings.popup_layout = "showcase";
    settings.popup_design.gallery.grid = "single";
    settings.popup_showcase_images = ["/media/one.jpg", "/media/two.jpg"].map((url) => ({
      url,
      caption_pl: "",
      caption_en: "",
    }));
    warmPopupImages(settings);
    expect(create).toHaveBeenCalledTimes(1);
    create.mockClear();
    settings.popup_showcase_images[0].url = "https://cdn.example.test/one.jpg";
    warmPopupImages(settings);
    expect(create).not.toHaveBeenCalled();
  });
});
