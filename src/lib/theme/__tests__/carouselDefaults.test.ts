import { describe, it, expect } from "vitest";
import { resolveCarouselSettings, CAROUSEL_DEFAULTS } from "@/lib/theme/carouselDefaults";

describe("resolveCarouselSettings", () => {
  it("returns defaults when override is missing", () => {
    expect(resolveCarouselSettings(CAROUSEL_DEFAULTS, undefined)).toEqual(CAROUSEL_DEFAULTS);
  });

  it("override fields win, empty/undefined fall back", () => {
    const r = resolveCarouselSettings(CAROUSEL_DEFAULTS, {
      intervalMs: 9000,
      autoplay: undefined,
    });
    expect(r.intervalMs).toBe(9000);
    expect(r.autoplay).toBe(CAROUSEL_DEFAULTS.autoplay);
    expect(r.transition).toBe(CAROUSEL_DEFAULTS.transition);
  });
});
