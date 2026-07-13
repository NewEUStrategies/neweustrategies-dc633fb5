import { describe, expect, it } from "vitest";
import { preferCanonicalBio } from "../canonicalBio";

describe("preferCanonicalBio", () => {
  it("prefers the canonical profiles bio when present", () => {
    expect(preferCanonicalBio("Profil", "Legacy")).toBe("Profil");
  });

  it("falls back to the legacy author_profiles bio when profiles bio is empty", () => {
    expect(preferCanonicalBio(null, "Legacy")).toBe("Legacy");
    expect(preferCanonicalBio("", "Legacy")).toBe("Legacy");
    expect(preferCanonicalBio("   ", "Legacy")).toBe("Legacy");
  });

  it("returns null when both sources are empty", () => {
    expect(preferCanonicalBio(null, null)).toBeNull();
    expect(preferCanonicalBio(undefined, "  ")).toBeNull();
  });

  it("does not trim the returned value, only the emptiness check", () => {
    expect(preferCanonicalBio(" Profil ", null)).toBe(" Profil ");
  });
});
