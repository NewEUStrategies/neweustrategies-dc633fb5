import { describe, expect, it } from "vitest";
import {
  resolvePodcastChannelMeta,
  type PodcastChannelMetaSource,
  type PodcastShowMetaOverride,
} from "@/lib/seo/podcastChannelMeta";

const channel: PodcastChannelMetaSource = {
  itunes_author: "New European Strategies",
  itunes_owner_name: "NES Media",
  itunes_owner_email: "podcast@example.org",
  itunes_category: "News",
  itunes_subcategory: "Politics",
  itunes_explicit: false,
  itunes_type: "episodic",
  itunes_image_url: "https://cdn/channel.jpg",
  itunes_copyright: "© 2026 NES",
};

const emptyShow: PodcastShowMetaOverride = {
  itunes_author: null,
  itunes_owner_name: null,
  itunes_owner_email: null,
  itunes_category: null,
  itunes_subcategory: null,
  itunes_explicit: null,
  itunes_type: null,
  itunes_complete: false,
  cover_image_url: null,
};

const fallback = {
  author: "New European Strategies",
  imageUrl: "https://example.org/og-default.jpg",
  copyright: "© 2026 New European Strategies",
};

describe("resolvePodcastChannelMeta", () => {
  it("uses the network channel when no show overrides anything", () => {
    const meta = resolvePodcastChannelMeta({ channel, show: emptyShow, fallback });
    expect(meta).toMatchObject({
      author: "New European Strategies",
      ownerName: "NES Media",
      ownerEmail: "podcast@example.org",
      category: "News",
      subcategory: "Politics",
      explicit: false,
      showType: "episodic",
      imageUrl: "https://cdn/channel.jpg",
      complete: false,
    });
  });

  it("lets a show override the author, owner and artwork", () => {
    const meta = resolvePodcastChannelMeta({
      channel,
      show: {
        ...emptyShow,
        itunes_author: "Brussels Brief",
        itunes_owner_email: "brief@example.org",
        cover_image_url: "https://cdn/show.jpg",
        itunes_complete: true,
      },
      fallback,
    });
    expect(meta.author).toBe("Brussels Brief");
    expect(meta.ownerEmail).toBe("brief@example.org");
    expect(meta.imageUrl).toBe("https://cdn/show.jpg");
    expect(meta.complete).toBe(true);
  });

  it("never mixes a show category with the channel subcategory", () => {
    // "Politics" nie jest podkategoria "Government" - Apple odrzuca taka pare.
    const meta = resolvePodcastChannelMeta({
      channel,
      show: { ...emptyShow, itunes_category: "Government" },
      fallback,
    });
    expect(meta.category).toBe("Government");
    expect(meta.subcategory).toBeNull();
  });

  it("treats explicit=false on a show as an override, not as missing", () => {
    const meta = resolvePodcastChannelMeta({
      channel: { ...channel, itunes_explicit: true },
      show: { ...emptyShow, itunes_explicit: false },
      fallback,
    });
    expect(meta.explicit).toBe(false);
  });

  it("falls back to brand defaults when the tenant has no podcast settings", () => {
    const meta = resolvePodcastChannelMeta({ channel: null, fallback });
    expect(meta).toMatchObject({
      author: "New European Strategies",
      ownerName: "New European Strategies",
      ownerEmail: null,
      category: "News",
      subcategory: "Politics",
      explicit: false,
      showType: "episodic",
      imageUrl: "https://example.org/og-default.jpg",
      copyright: "© 2026 New European Strategies",
    });
  });

  it("ignores blank strings so they do not shadow the layer below", () => {
    const meta = resolvePodcastChannelMeta({
      channel: { ...channel, itunes_author: "   ", itunes_image_url: "" },
      fallback,
    });
    expect(meta.author).toBe("New European Strategies");
    expect(meta.imageUrl).toBe("https://example.org/og-default.jpg");
  });

  it("rejects an invalid show type instead of emitting it", () => {
    const meta = resolvePodcastChannelMeta({
      channel: { ...channel, itunes_type: "weekly" },
      fallback,
    });
    expect(meta.showType).toBe("episodic");
  });
});
