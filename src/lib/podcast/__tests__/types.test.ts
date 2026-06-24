import { describe, it, expect } from "vitest";
import { formatDuration, parseDuration, podcastEpisodeLabel } from "../types";

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
});
