import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { buildImageSrcSet } from "@/lib/cropSizes";
import { mediaRenderUrl } from "@/lib/media/publicUrl";
import { resolvePopupDesign, type PopupGalleryGrid } from "./popupDesign";

export const POPUP_COVER_SIZES = "(max-width: 544px) calc(100vw - 32px), 512px";
export const POPUP_SIDE_SIZES = "(max-width: 767px) calc(100vw - 32px), 448px";

/** Match the configured panel split and the actual tile width, including mobile padding. */
export function popupGallerySizes(
  maxWidth: number,
  split: "half" | "gallery-wide" | "form-wide",
  padding: number,
  grid: PopupGalleryGrid,
  count: number,
  index: number,
): string {
  const fraction = split === "gallery-wide" ? 0.57 : split === "form-wide" ? 0.43 : 0.5;
  const tile =
    grid === "single" ||
    index === 3 ||
    (grid === "reference" && (count <= 1 || (count === 3 && index === 2)))
      ? 1
      : grid === "mosaic"
        ? index === 0
          ? 2 / 3
          : 1 / 3
        : index === 0
          ? 1.55 / 2.55
          : 1 / 2.55;
  const mobile = `calc(${100 * tile}vw - ${(32 + padding * 2) * tile}px)`;
  const desktop = `calc(${100 * fraction * tile}vw - ${(32 * fraction + padding * 2) * tile}px)`;
  const capped = Math.max(1, Math.round((maxWidth * fraction - padding * 2) * tile));
  return `(max-width: 767px) ${mobile}, (max-width: ${maxWidth + 32}px) ${desktop}, ${capped}px`;
}

/** The image and its warmup must select the same URL/variant to reuse one request. */
export function popupImageSource(url: string, sizes: string) {
  const src = mediaRenderUrl(url.trim());
  // Preserve vectors and animated uploads; external CDNs retain their own URL contract.
  const preserveOriginal = /\.(?:svg|gif|apng)(?:[?#]|$)/i.test(src);
  const srcSet = preserveOriginal ? "" : buildImageSrcSet(src);
  return { src, srcSet: srcSet || undefined, sizes: srcSet ? sizes : undefined };
}

/** Warm only visible, first-party media. External images are fetched when the popup opens. */
export function warmPopupImages(settings: NewsletterSettings): void {
  if (typeof window === "undefined" || typeof Image === "undefined") return;
  const images: Array<{ url: string; sizes: string }> = [];
  if (settings.popup_layout === "showcase") {
    const { gallery, panel } = resolvePopupDesign(settings.popup_design);
    const tiles = (settings.popup_showcase_images ?? [])
      .filter((item) => item?.url?.trim())
      .slice(0, 4);
    if (gallery.order.includes("grid")) {
      for (const [index, tile] of tiles.entries()) {
        if (gallery.grid === "single" && index > 0) break;
        images.push({
          url: tile.url,
          sizes: popupGallerySizes(
            panel.maxWidthPx,
            panel.split,
            gallery.paddingPx,
            gallery.grid,
            tiles.length,
            index,
          ),
        });
      }
    }
    if (
      settings.popup_showcase_show_brand &&
      gallery.showLogo &&
      gallery.order.includes("brand") &&
      gallery.logoUrl
    ) {
      images.push({ url: gallery.logoUrl, sizes: "200px" });
    }
  } else if (!settings.popup_doc) {
    const url =
      settings.popup_layout === "split" ? settings.popup_side_image_url : settings.popup_cover_url;
    if (url)
      images.push({
        url,
        sizes: settings.popup_layout === "split" ? POPUP_SIDE_SIZES : POPUP_COVER_SIZES,
      });
  }
  for (const item of images) {
    const source = popupImageSource(item.url, item.sizes);
    if (!source.src.startsWith("/media/")) continue;
    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = "low";
    if (source.sizes) image.sizes = source.sizes;
    if (source.srcSet) image.srcset = source.srcSet;
    image.src = source.src;
  }
}
