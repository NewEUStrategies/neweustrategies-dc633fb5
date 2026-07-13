import { describe, it, expect } from "vitest";
import {
  formatDuration,
  parseDuration,
  podcastEpisodeLabel,
  parseChapters,
  parseQuotes,
  parseResources,
} from "../types";

describe("podcast/types", () => {
  it("formatDuration MM:SS", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(45)).toBe("0:45");
    expect(formatDuration(125)).toBe("2:05");
  });
  it("formatDuration H:MM:SS", () => {
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(36015)).toBe("10:00:15");
  });
  it("formatDuration handles invalid/negative", () => {
    expect(formatDuration(-10)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
  });

  it("parseDuration MM:SS / H:MM:SS / seconds", () => {
    expect(parseDuration("2:05")).toBe(125);
    expect(parseDuration("1:02:05")).toBe(3725);
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("")).toBe(0);
    expect(parseDuration("garbage")).toBe(0);
  });

  it("podcastEpisodeLabel locale", () => {
    expect(podcastEpisodeLabel({ season: 2, episode_number: 7 }, "pl")).toBe("Sezon 2 · Odc. 7");
    expect(podcastEpisodeLabel({ season: 2, episode_number: 7 }, "en")).toBe("S2 · E7");
    expect(podcastEpisodeLabel({ season: null, episode_number: 3 }, "pl")).toBe("Odc. 3");
    expect(podcastEpisodeLabel({ season: null, episode_number: null }, "pl")).toBeNull();
  });

  it("parseChapters sorts by start and drops malformed entries", () => {
    const chapters = parseChapters([
      { start: 90, title_pl: "Drugi", title_en: "Second" },
      { start: 0, title_pl: "Wstęp", title_en: "Intro" },
      { start: "zły", title_pl: "Odpada" },
      "śmieć",
    ]);
    expect(chapters.map((c) => c.start)).toEqual([0, 90]);
    expect(chapters[0].title_pl).toBe("Wstęp");
  });

  it("parseChapters tolerates non-array jsonb", () => {
    expect(parseChapters(null)).toEqual([]);
    expect(parseChapters({ start: 0 })).toEqual([]);
    expect(parseChapters(undefined)).toEqual([]);
  });

  it("parseQuotes keeps only quotes with text", () => {
    const quotes = parseQuotes([
      { text_pl: "Cytat", text_en: "", attribution: "Gen. X" },
      { text_pl: " ", text_en: "", attribution: "pusty" },
      { attribution: "bez tekstu" },
    ]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].attribution).toBe("Gen. X");
  });

  it("parseResources requires url and defaults kind", () => {
    const resources = parseResources([
      { label_pl: "Raport", url: "https://example.org/raport" },
      { label_pl: "Bez linku" },
      { label_pl: "Analiza", url: "https://example.org/a", kind: "related" },
    ]);
    expect(resources).toHaveLength(2);
    expect(resources[0].kind).toBe("source");
    expect(resources[1].kind).toBe("related");
  });
});
