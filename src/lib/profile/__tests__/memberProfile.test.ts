import { describe, expect, it } from "vitest";
import { profileHref } from "@/lib/profile/profileHref";
import { parseMemberProfile } from "@/lib/profile/memberProfile";

describe("profileHref", () => {
  it("kieruje zwykłego użytkownika na /people", () => {
    expect(profileHref({ slug: "jan-kowalski-2" })).toBe("/people/jan-kowalski-2");
  });
  it("kieruje autora na /author", () => {
    expect(profileHref({ slug: "anna-nowak", isAuthor: true })).toBe("/author/anna-nowak");
  });
  it("koduje znaki specjalne", () => {
    expect(profileHref({ slug: "a b" })).toBe("/people/a%20b");
  });
});

describe("parseMemberProfile", () => {
  const row = {
    id: "u1",
    slug: "jan",
    display_name: "Jan",
    verified: false,
    is_self: false,
    is_author: false,
  };
  it("zwraca null dla braku danych", () => {
    expect(parseMemberProfile(null)).toBeNull();
  });
  it("uzupełnia brakujące pola wartością null", () => {
    expect(parseMemberProfile(row)?.job_title).toBeNull();
  });
  it("odrzuca niekompletny wiersz", () => {
    expect(parseMemberProfile({ slug: "x" })).toBeNull();
  });
});
