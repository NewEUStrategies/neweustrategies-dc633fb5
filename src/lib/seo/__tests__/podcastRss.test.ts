import { describe, expect, it } from "vitest";
import {
  buildPodcastRssXml,
  enclosureMimeType,
  type PodcastRssChannelInput,
  type PodcastRssItem,
} from "@/lib/seo/podcastRss";
import { podcastFeedReadiness, summarizeEpisodes } from "@/lib/seo/podcastFeedReadiness";
import { normalizeAppleCategory } from "@/lib/seo/applePodcastCategories";

const baseItem: PodcastRssItem = {
  url: "https://example.org/podcast/odc-1",
  title: "Odcinek 1",
  description: "Opis",
  publishedAt: "2026-07-01T10:00:00Z",
  audioUrl: "https://cdn.example.org/audio/odc-1.mp3",
  durationSeconds: 125,
};

function build(items: PodcastRssItem[], channel: Partial<PodcastRssChannelInput> = {}): string {
  return buildPodcastRssXml({
    title: "Feed",
    description: "Desc",
    siteUrl: "https://example.org/podcasts",
    feedUrl: "https://example.org/podcast/rss.xml",
    language: "pl",
    items,
    ...channel,
  });
}

describe("podcast RSS enclosure", () => {
  it("emits the real byte length and stored MIME when the media library knows them", () => {
    const xml = build([{ ...baseItem, audioBytes: 12_345_678, audioMime: "audio/mpeg" }]);
    expect(xml).toContain(
      '<enclosure url="https://cdn.example.org/audio/odc-1.mp3" length="12345678" type="audio/mpeg"/>',
    );
  });

  it("falls back to length=0 and extension-derived MIME for external URLs", () => {
    const xml = build([{ ...baseItem, audioUrl: "https://ext.example.com/e.m4a" }]);
    expect(xml).toContain(
      '<enclosure url="https://ext.example.com/e.m4a" length="0" type="audio/mp4"/>',
    );
  });

  it("ignores non-positive byte counts", () => {
    const xml = build([{ ...baseItem, audioBytes: 0 }]);
    expect(xml).toContain('length="0"');
  });

  it("keeps itunes:duration in H:MM:SS/MM:SS form", () => {
    const xml = build([baseItem]);
    expect(xml).toContain("<itunes:duration>02:05</itunes:duration>");
  });
});

describe("enclosureMimeType", () => {
  it("maps common podcast extensions", () => {
    expect(enclosureMimeType("https://x/a.mp3")).toBe("audio/mpeg");
    expect(enclosureMimeType("https://x/a.m4a?v=1")).toBe("audio/mp4");
    expect(enclosureMimeType("https://x/a.wav#t")).toBe("audio/wav");
    expect(enclosureMimeType("https://x/a.ogg")).toBe("audio/ogg");
    expect(enclosureMimeType("https://x/bez-rozszerzenia")).toBe("audio/mpeg");
  });
});

// ── Wymagania Apple Podcasts Connect ────────────────────────────────────────
// Kanal bez tych tagow nie zostanie przyjety - a wersja sprzed 2026-07-25
// emitowala z nich tylko <title>/<description>/<language>.
describe("Apple Podcasts Connect channel requirements", () => {
  it("always emits itunes:category, even with no configuration", () => {
    const xml = build([baseItem]);
    expect(xml).toContain('<itunes:category text="News">');
    expect(xml).toContain('<itunes:category text="Politics"/>');
  });

  it("always emits itunes:explicit and itunes:type", () => {
    const xml = build([baseItem]);
    expect(xml).toContain("<itunes:explicit>no</itunes:explicit>");
    expect(xml).toContain("<itunes:type>episodic</itunes:type>");
  });

  it("marks an explicit channel as such", () => {
    const xml = build([baseItem], { explicit: true });
    expect(xml).toContain("<itunes:explicit>yes</itunes:explicit>");
  });

  it("degrades an unknown category to the default instead of emitting it verbatim", () => {
    const xml = build([baseItem], { category: "Geopolityka", subcategory: "UE" });
    expect(xml).not.toContain("Geopolityka");
    expect(xml).toContain('<itunes:category text="News">');
  });

  it("drops a subcategory that does not belong to its category", () => {
    const xml = build([baseItem], { category: "Government", subcategory: "Politics" });
    expect(xml).toContain('<itunes:category text="Government"/>');
    expect(xml).not.toContain('text="Politics"');
  });

  it("falls back to an episode cover when no channel artwork is configured", () => {
    // <itunes:image> jest wymagany - feed nie moze wyjsc bez niego.
    const xml = build([{ ...baseItem, imageUrl: "https://cdn.example.org/cover.jpg" }]);
    expect(xml).toContain('<itunes:image href="https://cdn.example.org/cover.jpg"/>');
  });

  it("emits itunes:owner with the verification e-mail", () => {
    const xml = build([baseItem], {
      ownerName: "New European Strategies",
      ownerEmail: "podcast@example.org",
    });
    expect(xml).toContain("<itunes:owner>");
    expect(xml).toContain("<itunes:name>New European Strategies</itunes:name>");
    expect(xml).toContain("<itunes:email>podcast@example.org</itunes:email>");
    expect(xml).toContain("<managingEditor>podcast@example.org (New European Strategies)");
  });

  it("uses the author as the owner name when only the author is set", () => {
    const xml = build([baseItem], { author: "NES", ownerEmail: "a@b.c" });
    expect(xml).toContain("<itunes:author>NES</itunes:author>");
    expect(xml).toContain("<itunes:name>NES</itunes:name>");
  });

  it("emits itunes:complete only for a finished show", () => {
    expect(build([baseItem])).not.toContain("<itunes:complete>");
    expect(build([baseItem], { complete: true })).toContain(
      "<itunes:complete>yes</itunes:complete>",
    );
  });

  it("escapes channel metadata into valid XML", () => {
    const xml = build([baseItem], { author: 'Ampersand & "quotes" <tag>' });
    expect(xml).toContain("<itunes:author>Ampersand &amp; ");
    expect(xml).not.toContain("<itunes:author>Ampersand & ");
  });
});

describe("Apple Podcasts Connect item requirements", () => {
  it("emits itunes:episodeType and itunes:explicit on every item", () => {
    const xml = build([baseItem]);
    expect(xml).toContain("<itunes:episodeType>full</itunes:episodeType>");
    // Odcinek bez wlasnej wartosci dziedziczy explicit kanalu.
    expect(xml.match(/<itunes:explicit>no<\/itunes:explicit>/g)?.length).toBe(2);
  });

  it("honours a per-episode explicit override and episode type", () => {
    const xml = build([{ ...baseItem, explicit: true, episodeType: "trailer" }], {
      explicit: false,
    });
    expect(xml).toContain("<itunes:episodeType>trailer</itunes:episodeType>");
    expect(xml).toContain("<itunes:explicit>yes</itunes:explicit>");
  });

  it("emits itunes:title alongside the RSS title", () => {
    const xml = build([baseItem]);
    expect(xml).toContain("<itunes:title>Odcinek 1</itunes:title>");
  });
});

describe("podcastFeedReadiness", () => {
  const full = {
    title: "Feed",
    description: "Desc",
    language: "pl",
    imageUrl: "https://cdn/cover.jpg",
    author: "NES",
    ownerName: "NES",
    ownerEmail: "podcast@example.org",
    copyright: "© 2026 NES",
    episodes: { total: 3, withoutByteLength: 0, withoutDuration: 0 },
  };

  it("reports a fully configured feed as ready", () => {
    expect(podcastFeedReadiness(full)).toEqual({ ready: true, blocking: [], warnings: [] });
  });

  it("blocks on a missing owner e-mail (ownership cannot be verified)", () => {
    const r = podcastFeedReadiness({ ...full, ownerEmail: "" });
    expect(r.ready).toBe(false);
    expect(r.blocking).toContain("ownerEmail");
  });

  it("blocks on missing artwork and on an empty feed", () => {
    const r = podcastFeedReadiness({
      ...full,
      imageUrl: null,
      episodes: { total: 0, withoutByteLength: 0, withoutDuration: 0 },
    });
    expect(r.blocking).toContain("image");
    expect(r.blocking).toContain("episodes");
  });

  it("warns (but does not block) on enclosure length=0 and missing duration", () => {
    const r = podcastFeedReadiness({
      ...full,
      episodes: { total: 2, withoutByteLength: 1, withoutDuration: 2 },
    });
    expect(r.ready).toBe(true);
    expect(r.warnings).toEqual(expect.arrayContaining(["enclosureLength", "duration"]));
  });
});

describe("summarizeEpisodes", () => {
  it("counts episodes lacking a real byte length or duration", () => {
    expect(
      summarizeEpisodes([
        { audioBytes: 1000, durationSeconds: 60 },
        { audioBytes: null, durationSeconds: 0 },
        { audioBytes: 0, durationSeconds: 30 },
      ]),
    ).toEqual({ total: 3, withoutByteLength: 2, withoutDuration: 1 });
  });
});

describe("normalizeAppleCategory", () => {
  it("keeps a valid pair", () => {
    expect(normalizeAppleCategory("Science", "Social Sciences")).toEqual({
      category: "Science",
      subcategory: "Social Sciences",
    });
  });

  it("falls back for an unknown category", () => {
    expect(normalizeAppleCategory("Polityka", "UE")).toEqual({
      category: "News",
      subcategory: "Politics",
    });
  });

  it("drops a foreign subcategory but keeps the category", () => {
    expect(normalizeAppleCategory("Technology", "Politics")).toEqual({
      category: "Technology",
      subcategory: null,
    });
  });
});
