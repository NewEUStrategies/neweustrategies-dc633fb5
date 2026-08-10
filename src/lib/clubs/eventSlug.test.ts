import { describe, expect, it } from "vitest";
import { clubEventSlug, clubEventSlugBase, isValidClubEventSlug } from "./eventSlug";

describe("clubEventSlug", () => {
  it("transliterates Polish diacritics", () => {
    expect(clubEventSlugBase("Śniadanie prasowe: Bezpieczeństwo")).toBe(
      "sniadanie-prasowe-bezpieczenstwo",
    );
  });

  it("always produces a slug accepted by the database CHECK", () => {
    for (const title of ["", "???", "  ", "Chatham House — 2026", "Bonjour Diplomacy"]) {
      expect(isValidClubEventSlug(clubEventSlug(title, 1_700_000_000_000))).toBe(true);
    }
  });

  it("adds a suffix so two identical titles do not collide", () => {
    expect(clubEventSlug("Spotkanie", 1)).not.toBe(clubEventSlug("Spotkanie", 2));
  });
});
