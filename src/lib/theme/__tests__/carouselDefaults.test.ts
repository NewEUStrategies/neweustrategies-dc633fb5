import { describe, it, expect } from "vitest";
import {
  resolveCarouselSettings,
  normalizeCarouselDefaults,
  CAROUSEL_DEFAULTS,
} from "@/lib/theme/carouselDefaults";

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

// Normalizacja ustawień globalnych POLE PO POLU (P2.5). Do 05.10.2026 jedno
// złe pole - także zarezerwowane `transition`, którego renderer nie czyta -
// wywracało walidację całego obiektu: poprawne wartości redakcji przepadały,
// a zod budował obiekt błędu w `queryFn` każdego slidera.
describe("normalizeCarouselDefaults", () => {
  it("poprawny zapis przechodzi bez zmian", () => {
    const stored = {
      autoplay: false,
      intervalMs: 7000,
      transition: "fade",
      loop: false,
      pauseOnHover: false,
      speedMs: 900,
    };
    expect(normalizeCarouselDefaults(stored)).toEqual(stored);
  });

  it("złe pole zarezerwowane NIE kasuje poprawnych ustawień redakcji (zapis z fixture)", () => {
    // Kształt 1:1 z `e2e/fixtures/first-visit.json` (`site_settings.carousel_defaults`),
    // z autoplay i interwałem zmienionymi, żeby było widać, że przeżywają.
    const out = normalizeCarouselDefaults({
      loop: true,
      speedMs: 600,
      autoplay: false,
      intervalMs: 9000,
      transition: "Treść przykładowa",
      pauseOnHover: true,
    });
    expect(out).toEqual({
      loop: true,
      speedMs: 600,
      autoplay: false,
      intervalMs: 9000,
      transition: CAROUSEL_DEFAULTS.transition,
      pauseOnHover: true,
    });
  });

  it("każde pole poza kontraktem dostaje WŁASNĄ wartość domyślną", () => {
    expect(
      normalizeCarouselDefaults({
        autoplay: "tak",
        intervalMs: 999,
        loop: null,
        pauseOnHover: 1,
        speedMs: 600.5,
      }),
    ).toEqual(CAROUSEL_DEFAULTS);
    expect(normalizeCarouselDefaults({ intervalMs: 30_001, speedMs: 99 })).toEqual(
      CAROUSEL_DEFAULTS,
    );
    expect(normalizeCarouselDefaults({ intervalMs: 30_000, speedMs: 100 })).toMatchObject({
      intervalMs: 30_000,
      speedMs: 100,
    });
  });

  it("brak zapisu, nie-obiekt i tablica dają ustawienia domyślne", () => {
    for (const raw of [undefined, null, "slide", 4500, [1, 2]]) {
      expect(normalizeCarouselDefaults(raw)).toEqual(CAROUSEL_DEFAULTS);
    }
  });
});
