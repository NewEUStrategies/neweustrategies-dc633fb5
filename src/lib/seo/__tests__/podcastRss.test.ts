import { describe, expect, it } from "vitest";
import { buildPodcastRssXml, enclosureMimeType, type PodcastRssItem } from "@/lib/seo/podcastRss";

const baseItem: PodcastRssItem = {
  url: "https://example.org/podcast/odc-1",
  title: "Odcinek 1",
  description: "Opis",
  publishedAt: "2026-07-01T10:00:00Z",
  audioUrl: "https://cdn.example.org/audio/odc-1.mp3",
  durationSeconds: 125,
};

function build(items: PodcastRssItem[]): string {
  return buildPodcastRssXml({
    title: "Feed",
    description: "Desc",
    siteUrl: "https://example.org/podcasts",
    feedUrl: "https://example.org/podcast/rss.xml",
    language: "pl",
    items,
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
