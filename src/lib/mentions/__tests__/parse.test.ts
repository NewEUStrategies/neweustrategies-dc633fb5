import { describe, expect, it } from "vitest";
import {
  applyMentionSelection,
  findActiveMentionQuery,
  splitMentions,
  type MentionSegment,
} from "@/lib/mentions/parse";

// Konkatenacja tekstu wszystkich segmentów MUSI odtworzyć wejście 1:1 - wzmianki
// nie mogą gubić ani duplikować znaków.
function reassemble(segs: MentionSegment[]): string {
  return segs.map((s) => (s.kind === "text" ? s.text : s.raw)).join("");
}

describe("splitMentions", () => {
  it("returns nothing for empty / nullish input", () => {
    expect(splitMentions("")).toEqual([]);
    expect(splitMentions(null)).toEqual([]);
    expect(splitMentions(undefined)).toEqual([]);
  });

  it("linkifies a mention at the very start", () => {
    expect(splitMentions("@alice hi")).toEqual([
      { kind: "mention", slug: "alice", raw: "@alice" },
      { kind: "text", text: " hi" },
    ]);
  });

  it("keeps the boundary char before a mid-string mention as text", () => {
    const segs = splitMentions("hey @bob-01 there");
    expect(segs).toEqual([
      { kind: "text", text: "hey " },
      { kind: "mention", slug: "bob-01", raw: "@bob-01" },
      { kind: "text", text: " there" },
    ]);
  });

  it("does NOT treat an email address as a mention", () => {
    const segs = splitMentions("write to user@example.com please");
    expect(segs.every((s) => s.kind === "text")).toBe(true);
    expect(reassemble(segs)).toBe("write to user@example.com please");
  });

  it("lowercases the slug for the link but keeps typed case in raw", () => {
    const segs = splitMentions("ping @Alice");
    expect(segs).toContainEqual({ kind: "mention", slug: "alice", raw: "@Alice" });
  });

  it("handles multiple mentions and reassembles losslessly", () => {
    const input = "cc @jan and @anna-k, thanks";
    const segs = splitMentions(input);
    expect(
      segs.filter((s) => s.kind === "mention").map((s) => s.kind === "mention" && s.slug),
    ).toEqual(["jan", "anna-k"]);
    expect(reassemble(segs)).toBe(input);
  });

  it("mirrors the backend: a second @ with no separator is not a mention", () => {
    // '@alice@bob' - backend consumes the boundary, so only @alice resolves.
    const segs = splitMentions("@alice@bob");
    const mentions = segs.filter((s) => s.kind === "mention");
    expect(mentions).toHaveLength(1);
    expect(reassemble(segs)).toBe("@alice@bob");
  });

  it("ignores a lone @ and too-short handles", () => {
    // Slug wymaga min. 2 znaków (pierwszy alfanumeryczny + {1,63}); '@a' to za mało.
    expect(splitMentions("just @ and @a").every((s) => s.kind === "text")).toBe(true);
  });
});

describe("findActiveMentionQuery", () => {
  it("detects an empty query right after typing @", () => {
    const v = "hi @";
    expect(findActiveMentionQuery(v, v.length)).toEqual({ query: "", start: 3, end: 4 });
  });

  it("detects a partial handle under the caret", () => {
    const v = "hi @ali";
    expect(findActiveMentionQuery(v, v.length)).toEqual({ query: "ali", start: 3, end: 7 });
  });

  it("returns null when the char before @ is alphanumeric (email-like)", () => {
    const v = "mail me user@ex";
    expect(findActiveMentionQuery(v, v.length)).toBeNull();
  });

  it("returns null once a space ends the token", () => {
    const v = "hi @ali then ";
    expect(findActiveMentionQuery(v, v.length)).toBeNull();
  });

  it("uses only text up to the caret, not the whole value", () => {
    const v = "hi @ali rest";
    // caret sits right after "ali" (index 7), trailing " rest" is ignored.
    expect(findActiveMentionQuery(v, 7)).toEqual({ query: "ali", start: 3, end: 7 });
  });

  it("picks the last @ before the caret", () => {
    const v = "@x done @ye";
    expect(findActiveMentionQuery(v, v.length)).toEqual({ query: "ye", start: 8, end: 11 });
  });

  it("guards out-of-range carets", () => {
    expect(findActiveMentionQuery("hi", -1)).toBeNull();
    expect(findActiveMentionQuery("hi", 99)).toBeNull();
  });
});

describe("applyMentionSelection", () => {
  it("replaces the active token with @slug and a trailing space", () => {
    const v = "hi @al";
    const active = findActiveMentionQuery(v, v.length)!;
    expect(applyMentionSelection(v, active, "alice")).toEqual({ value: "hi @alice ", caret: 10 });
  });

  it("splices in the middle without disturbing following text", () => {
    const v = "cc @an, please";
    const active = findActiveMentionQuery(v, 6)!; // caret after "@an"
    const out = applyMentionSelection(v, active, "anna-k");
    expect(out.value).toBe("cc @anna-k , please");
    expect(out.caret).toBe("cc @anna-k ".length);
  });
});
