import { describe, it, expect, beforeEach } from "vitest";
import {
  PLAYBACK_RATES,
  DEFAULT_PLAYBACK_RATE,
  clampPlaybackRate,
  readStoredPlaybackRate,
  writeStoredPlaybackRate,
  nextPlaybackRate,
  formatPlaybackRate,
} from "../playbackRate";

beforeEach(() => {
  window.localStorage.clear();
});

describe("clampPlaybackRate", () => {
  it("przepuszcza dozwolone wartości bez zmian", () => {
    for (const rate of PLAYBACK_RATES) expect(clampPlaybackRate(rate)).toBe(rate);
  });

  it("przyciąga obce wartości do najbliższej dozwolonej", () => {
    expect(clampPlaybackRate(1.3)).toBe(1.25);
    expect(clampPlaybackRate(3)).toBe(2);
    expect(clampPlaybackRate(0.1)).toBe(0.75);
  });

  it("NaN/Infinity wraca do domyślnej", () => {
    expect(clampPlaybackRate(Number.NaN)).toBe(DEFAULT_PLAYBACK_RATE);
    expect(clampPlaybackRate(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PLAYBACK_RATE);
  });
});

describe("trwałość localStorage", () => {
  it("round-trip zapis/odczyt", () => {
    writeStoredPlaybackRate(1.5);
    expect(readStoredPlaybackRate()).toBe(1.5);
  });

  it("uszkodzony zapis wraca do domyślnej", () => {
    window.localStorage.setItem("audio-rate", "abc");
    expect(readStoredPlaybackRate()).toBe(DEFAULT_PLAYBACK_RATE);
  });

  it("brak zapisu = domyślna", () => {
    expect(readStoredPlaybackRate()).toBe(DEFAULT_PLAYBACK_RATE);
  });
});

describe("nextPlaybackRate", () => {
  it("cykl przechodzi przez wszystkie wartości i zawija", () => {
    let rate: number = DEFAULT_PLAYBACK_RATE;
    const seen = new Set<number>();
    for (let i = 0; i < PLAYBACK_RATES.length; i++) {
      rate = nextPlaybackRate(rate);
      seen.add(rate);
    }
    expect(seen.size).toBe(PLAYBACK_RATES.length);
    expect(nextPlaybackRate(2)).toBe(0.75);
  });
});

describe("formatPlaybackRate", () => {
  it("formatuje bez ogonków zer ze znakiem mnożenia", () => {
    expect(formatPlaybackRate(1)).toBe("1×");
    expect(formatPlaybackRate(1.25)).toBe("1.25×");
    expect(formatPlaybackRate(0.75)).toBe("0.75×");
  });
});
