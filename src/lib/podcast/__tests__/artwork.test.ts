import { describe, expect, it } from "vitest";
import {
  PODCAST_FEED_ARTWORK_SIDE,
  podcastFeedArtworkUrl,
  servedFeedArtworkSize,
} from "@/lib/podcast/artwork";
import {
  APPLE_IMAGE_MAX_PX,
  APPLE_IMAGE_MIN_PX,
  checkPodcastArtworkDimensions,
} from "@/lib/podcast/artworkRules";

describe("podcastFeedArtworkUrl", () => {
  it("turns a storage object into a 1400x1400 cover crop in the original format", () => {
    const out = podcastFeedArtworkUrl(
      "https://db.example.supabase.co/storage/v1/object/public/media/podcast/okladka.jpg",
    );
    const url = new URL(out!);
    expect(url.pathname).toBe("/storage/v1/render/image/public/media/podcast/okladka.jpg");
    expect(url.searchParams.get("width")).toBe(String(PODCAST_FEED_ARTWORK_SIDE));
    expect(url.searchParams.get("height")).toBe(String(PODCAST_FEED_ARTWORK_SIDE));
    expect(url.searchParams.get("resize")).toBe("cover");
    // Bez `format=origin` transformacja oddałaby WebP, którego Apple nie czyta.
    expect(url.searchParams.get("format")).toBe("origin");
  });

  it("leaves external, already-rendered and SVG addresses untouched", () => {
    expect(podcastFeedArtworkUrl("https://cdn.example.org/cover.jpg")).toBe(
      "https://cdn.example.org/cover.jpg",
    );
    const rendered =
      "https://db.example.supabase.co/storage/v1/render/image/public/media/a.jpg?width=3000";
    expect(podcastFeedArtworkUrl(rendered)).toBe(rendered);
    const svg = "https://db.example.supabase.co/storage/v1/object/public/media/logo.svg";
    expect(podcastFeedArtworkUrl(svg)).toBe(svg);
  });

  it("returns null for missing artwork instead of a non-square fallback", () => {
    expect(podcastFeedArtworkUrl(null)).toBeNull();
    expect(podcastFeedArtworkUrl("   ")).toBeNull();
  });
});

describe("checkPodcastArtworkDimensions", () => {
  it.each([
    [3000, 3000, "ok"],
    [APPLE_IMAGE_MIN_PX, APPLE_IMAGE_MIN_PX, "ok"],
    [1024, 640, "notSquare"],
    [3000, 2999, "notSquare"],
    [APPLE_IMAGE_MIN_PX - 1, APPLE_IMAGE_MIN_PX - 1, "tooSmall"],
    [APPLE_IMAGE_MAX_PX + 1, APPLE_IMAGE_MAX_PX + 1, "tooLarge"],
  ])("%ix%i -> %s", (w, h, state) => {
    expect(checkPodcastArtworkDimensions(w, h).state).toBe(state);
  });
});

describe("servedFeedArtworkSize - okładka, którą feed NAPRAWDĘ poda", () => {
  const library = "https://db.example.supabase.co/storage/v1/object/public/media/podcast/baner.jpg";

  it("non-square library image with a long enough short side becomes a valid 1400 square", () => {
    // Karta gotowości blokowała go po wymiarach ORYGINAŁU, choć feed podaje kadr.
    expect(servedFeedArtworkSize(library, { width: 3000, height: 2000 })).toEqual({
      width: PODCAST_FEED_ARTWORK_SIDE,
      height: PODCAST_FEED_ARTWORK_SIDE,
    });
  });

  it("library image with a short side under 1400 stays too small (no upscaling)", () => {
    expect(servedFeedArtworkSize(library, { width: 1024, height: 640 })).toEqual({
      width: 640,
      height: 640,
    });
  });

  it("external artwork is judged as is, and no measurement means no verdict", () => {
    expect(
      servedFeedArtworkSize("https://cdn.example.org/c.jpg", { width: 1600, height: 900 }),
    ).toEqual({
      width: 1600,
      height: 900,
    });
    expect(servedFeedArtworkSize(library, null)).toBeNull();
  });
});
