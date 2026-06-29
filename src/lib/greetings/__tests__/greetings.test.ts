import { describe, it, expect } from "vitest";
import { pickGreeting, timeBucket, normalize } from "../greetings";

describe("greetings", () => {
  it("buckets time of day", () => {
    expect(timeBucket(new Date("2026-01-01T03:00"))).toBe("night");
    expect(timeBucket(new Date("2026-01-01T09:00"))).toBe("morning");
    expect(timeBucket(new Date("2026-01-01T19:00"))).toBe("evening");
  });

  it("uses vocative_pl when present", () => {
    const out = pickGreeting({
      lang: "pl",
      firstName: "Piotr",
      entry: { name: "Piotr", name_normalized: "piotr", gender: "male", vocative_pl: "Piotrze", vocative_en: "Peter" },
      seed: "u",
      now: new Date("2026-01-01T09:00"),
    });
    expect(out).toMatch(/Piotrze/);
  });

  it("falls back to heuristic vocative for female names ending in a", () => {
    const out = pickGreeting({
      lang: "pl",
      firstName: "Marta",
      entry: { name: "Marta", name_normalized: "marta", gender: "female", vocative_pl: null, vocative_en: null },
      seed: "u",
      now: new Date("2026-01-01T09:00"),
    });
    expect(out).toMatch(/Marto/);
  });

  it("normalizes diacritics", () => {
    expect(normalize("Łukasz")).toBe("lukasz");
    expect(normalize("Agnieszka")).toBe("agnieszka");
  });

  it("gracefully strips placeholder when no name given", () => {
    const out = pickGreeting({ lang: "en", firstName: null, seed: 1, now: new Date("2026-01-01T09:00") });
    expect(out).not.toMatch(/\{name\}/);
    expect(out.length).toBeGreaterThan(0);
  });
});
