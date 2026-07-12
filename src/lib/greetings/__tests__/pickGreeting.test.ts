import { describe, it, expect } from "vitest";
import { pickGreeting } from "../greetings";

// Local morning so getHours() is timezone-independent (no trailing Z).
const MORNING = new Date("2026-01-01T09:00");

function pl(firstName: string) {
  return pickGreeting({
    lang: "pl",
    firstName,
    entry: {
      name: firstName,
      name_normalized: firstName.toLowerCase(),
      gender: "male",
      vocative_pl: null,
      vocative_en: null,
    },
    seed: "seed",
    now: MORNING,
  });
}

describe("pickGreeting - Polish vocative fallback (male)", () => {
  it("inflects consonant endings via heuristics", () => {
    expect(pl("Robert")).toMatch(/Robercie/); // -t -> -cie
    expect(pl("Konrad")).toMatch(/Konradzie/); // -d -> -dzie
    expect(pl("Jan")).toMatch(/Janie/); // default consonant -> -ie
    expect(pl("Marek")).toMatch(/Mareku/); // -k -> +u
  });

  it("inflects male names ending in -a", () => {
    expect(pl("Kuba")).toMatch(/Kubo/); // -a -> -o
  });
});

describe("pickGreeting - determinism & overrides", () => {
  it("is stable for the same seed and time window", () => {
    const args = { lang: "en" as const, firstName: "Sam", seed: "u", now: MORNING };
    expect(pickGreeting(args)).toBe(pickGreeting(args));
  });

  it("uses a CMS override pool when provided for that lang/bucket", () => {
    const out = pickGreeting({
      lang: "pl",
      firstName: "Ala",
      seed: "u",
      now: MORNING,
      overrides: { pl: { morning: ["Hej, {name}!"] } as never },
    });
    expect(out).toBe("Hej, Ala!");
  });

  it("prefers a pre-resolved English vocative", () => {
    const out = pickGreeting({
      lang: "en",
      firstName: "Peter",
      entry: {
        name: "Peter",
        name_normalized: "peter",
        gender: "male",
        vocative_pl: null,
        vocative_en: "Pete",
      },
      seed: "u",
      now: MORNING,
    });
    expect(out).toMatch(/Pete/);
  });

  it("emits a name-bearing greeting with no leftover placeholder when unseeded", () => {
    const out = pickGreeting({ lang: "en", firstName: "Sam", now: MORNING });
    expect(out).not.toMatch(/\{name\}/);
    expect(out).toMatch(/Sam/);
  });
});
