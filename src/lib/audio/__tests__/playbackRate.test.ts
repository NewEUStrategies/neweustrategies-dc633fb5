import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  PLAYBACK_RATES,
  DEFAULT_PLAYBACK_RATE,
  clampPlaybackRate,
  readStoredPlaybackRate,
  writeStoredPlaybackRate,
  nextPlaybackRate,
  formatPlaybackRate,
} from "../playbackRate";
import { memoryStorage, withStorage } from "@/test/postExperience/fixtures";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  // Podmiana magazynu przez `withStorage` - pod happy-dom `localStorage` jest
  // Proxy i szpieg na prototypie nie dociera do kodu (patrz fixtures).
  it("zablokowany magazyn (tryb prywatny, SecurityError) przy ODCZYCIE daje domyślną", () => {
    const hostile = memoryStorage();
    hostile.setItem("audio-rate", "1.5");
    const getItem = vi.fn(() => {
      throw new DOMException("access denied", "SecurityError");
    });
    Object.defineProperty(hostile, "getItem", { value: getItem });
    withStorage(hostile, () => {
      expect(readStoredPlaybackRate()).toBe(DEFAULT_PLAYBACK_RATE);
    });
    expect(getItem).toHaveBeenCalledWith("audio-rate");
  });

  it("pełny magazyn przy ZAPISIE nie wywraca playera i nie zostawia zapisu", () => {
    const blocked = memoryStorage({ blockWrites: true });
    withStorage(blocked, () => {
      expect(() => writeStoredPlaybackRate(1.75)).not.toThrow();
      expect(readStoredPlaybackRate()).toBe(DEFAULT_PLAYBACK_RATE);
    });
    expect(blocked.length).toBe(0);
  });

  it("zapis PRZYCINA tempo do dozwolonej wartości, zanim trafi do magazynu", () => {
    writeStoredPlaybackRate(1.3);
    expect(window.localStorage.getItem("audio-rate")).toBe("1.25");
    expect(readStoredPlaybackRate()).toBe(1.25);
  });

  it("na serwerze (bez `window`) odczyt daje domyślną, a zapis jest bezczynny", () => {
    window.localStorage.setItem("audio-rate", "1.5");
    vi.stubGlobal("window", undefined);
    const ssrRead = readStoredPlaybackRate();
    writeStoredPlaybackRate(2);
    vi.unstubAllGlobals();
    expect(ssrRead).toBe(DEFAULT_PLAYBACK_RATE);
    expect(window.localStorage.getItem("audio-rate")).toBe("1.5");
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
