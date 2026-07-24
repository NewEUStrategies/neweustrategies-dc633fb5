import { describe, it, expect } from "vitest";
import {
  isUuid,
  mapMemberRow,
  shouldQueryMembers,
  MEMBER_SEARCH_MIN_CHARS,
  type MemberProfileRow,
} from "@/lib/admin/memberSearch";

const UUID = "c0a00000-0000-0000-0000-0000000000a1";

describe("isUuid", () => {
  it("accepts a canonical UUID (any case, trimmed)", () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid(`  ${UUID.toUpperCase()}  `)).toBe(true);
  });

  it("rejects partials, names and empty", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("Jan Kowalski")).toBe(false);
    expect(isUuid(UUID.slice(0, 20))).toBe(false);
    expect(isUuid(`${UUID}-extra`)).toBe(false);
  });
});

describe("shouldQueryMembers", () => {
  it("queries for a full UUID regardless of length rules", () => {
    expect(shouldQueryMembers(UUID)).toBe(true);
  });

  it("requires the minimum character threshold for name search", () => {
    expect(shouldQueryMembers("")).toBe(false);
    expect(shouldQueryMembers("a")).toBe(false);
    expect("ab".length).toBe(MEMBER_SEARCH_MIN_CHARS);
    expect(shouldQueryMembers("ab")).toBe(true);
    expect(shouldQueryMembers("  a ")).toBe(false);
  });
});

describe("mapMemberRow", () => {
  const base: MemberProfileRow = {
    id: UUID,
    display_name: "Jan Kowalski",
    avatar_url: "https://cdn/a.jpg",
    slug: "jan-kowalski",
    verified_at: "2026-01-01T00:00:00Z",
  };

  it("maps a full row and derives verified from verified_at", () => {
    expect(mapMemberRow(base)).toEqual({
      id: UUID,
      displayName: "Jan Kowalski",
      avatarUrl: "https://cdn/a.jpg",
      slug: "jan-kowalski",
      verified: true,
    });
  });

  it("treats null verified_at as not verified", () => {
    expect(mapMemberRow({ ...base, verified_at: null }).verified).toBe(false);
  });

  it("falls back name → slug → id when display_name is blank/null", () => {
    expect(mapMemberRow({ ...base, display_name: "   " }).displayName).toBe("jan-kowalski");
    expect(mapMemberRow({ ...base, display_name: null, slug: null }).displayName).toBe(UUID);
  });
});
