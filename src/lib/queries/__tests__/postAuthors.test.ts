// Zim­ny render wpisu pobiera profile wszystkich autorów jednym selectem .in()
// (zamiast osobnej rundy na autora głównego i drugiej na współautorów). Cała
// logika kolejności i scalania żyje w czystych funkcjach orderAuthorIds /
// buildPostAuthors - te testy pilnują kanonicznej kolejności, deduplikacji,
// braku zależności od zapytań oraz poprawnego kształtu profilu głównego.
import { describe, expect, it } from "vitest";
import { buildPostAuthors, orderAuthorIds, type FullAuthorRow } from "@/lib/queries/public";

function row(id: string, over: Partial<FullAuthorRow> = {}): FullAuthorRow {
  return {
    id,
    slug: `slug-${id}`,
    display_name: `Name ${id}`,
    first_name: `First ${id}`,
    last_name: `Last ${id}`,
    avatar_url: `https://cdn/${id}.png`,
    bio_pl: `bio-pl-${id}`,
    bio_en: `bio-en-${id}`,
    ...over,
  };
}

describe("orderAuthorIds", () => {
  it("puts the main author first, then co-authors in order", () => {
    expect(orderAuthorIds("a", ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("deduplicates the main author appearing again among co-authors", () => {
    expect(orderAuthorIds("a", ["a", "b", "a"])).toEqual(["a", "b"]);
  });

  it("deduplicates repeated co-authors while preserving first-seen order", () => {
    expect(orderAuthorIds("a", ["b", "b", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("handles a null main author (co-authors only)", () => {
    expect(orderAuthorIds(null, ["b", "c"])).toEqual(["b", "c"]);
  });

  it("drops empty ids so a bad row never produces a phantom author", () => {
    expect(orderAuthorIds("a", ["", "b"])).toEqual(["a", "b"]);
  });

  it("returns an empty list when there is no author at all", () => {
    expect(orderAuthorIds(null, [])).toEqual([]);
  });
});

describe("buildPostAuthors", () => {
  it("builds the full main-author profile from a single row set", () => {
    const { author } = buildPostAuthors({
      orderedAuthorIds: ["a"],
      profileRows: [row("a")],
      mainAuthorId: "a",
      overlay: null,
    });
    expect(author).toEqual({
      id: "a",
      slug: "slug-a",
      display_name: "Name a",
      first_name: "First a",
      last_name: "Last a",
      avatar_url: "https://cdn/a.png",
      bio_pl: "bio-pl-a",
      bio_en: "bio-en-a",
      author_profile: null,
    });
  });

  it("emits ordered lightweight refs for every author (main + co-authors)", () => {
    const { authors } = buildPostAuthors({
      orderedAuthorIds: ["a", "b", "c"],
      profileRows: [row("c"), row("a"), row("b")],
      mainAuthorId: "a",
      overlay: null,
    });
    // Kolejność wynika z orderedAuthorIds, nie z kolejności wierszy z bazy.
    expect(authors.map((r) => r.id)).toEqual(["a", "b", "c"]);
    // Referencje są lekkie - bez avatar/bio.
    expect(authors[0]).toEqual({
      id: "a",
      slug: "slug-a",
      display_name: "Name a",
      first_name: "First a",
      last_name: "Last a",
    });
    expect(authors[0]).not.toHaveProperty("avatar_url");
  });

  it("skips ordered ids that have no matching profile row (RLS-hidden author)", () => {
    const { authors, author } = buildPostAuthors({
      orderedAuthorIds: ["a", "missing", "b"],
      profileRows: [row("a"), row("b")],
      mainAuthorId: "a",
      overlay: null,
    });
    expect(authors.map((r) => r.id)).toEqual(["a", "b"]);
    expect(author?.id).toBe("a");
  });

  it("returns a null main author when its row is missing but keeps other refs", () => {
    const { author, authors } = buildPostAuthors({
      orderedAuthorIds: ["a", "b"],
      profileRows: [row("b")],
      mainAuthorId: "a",
      overlay: null,
    });
    expect(author).toBeNull();
    expect(authors.map((r) => r.id)).toEqual(["b"]);
  });

  it("attaches the author_profiles overlay and normalizes custom_socials", () => {
    const { author } = buildPostAuthors({
      orderedAuthorIds: ["a"],
      profileRows: [row("a")],
      mainAuthorId: "a",
      overlay: {
        avatar_url: "https://cdn/overlay.png",
        job_title: "CEO",
        company: "NES",
        bio_pl: "ov-pl",
        bio_en: "ov-en",
        contact_email: "a@nes.eu",
        website_url: "https://nes.eu",
        x_url: null,
        linkedin_url: null,
        facebook_url: null,
        instagram_url: null,
        spotify_url: null,
        custom_socials: [{ label: "Mastodon", url: "https://m.social/@a" }],
      },
    });
    expect(author?.author_profile?.job_title).toBe("CEO");
    expect(author?.author_profile?.custom_socials).toEqual([
      { label: "Mastodon", url: "https://m.social/@a" },
    ]);
  });

  it("coerces a non-array custom_socials to an empty list (defensive)", () => {
    const { author } = buildPostAuthors({
      orderedAuthorIds: ["a"],
      profileRows: [row("a")],
      mainAuthorId: "a",
      overlay: {
        avatar_url: null,
        job_title: null,
        company: null,
        bio_pl: null,
        bio_en: null,
        contact_email: null,
        website_url: null,
        x_url: null,
        linkedin_url: null,
        facebook_url: null,
        instagram_url: null,
        spotify_url: null,
        custom_socials: "not-an-array",
      },
    });
    expect(author?.author_profile?.custom_socials).toEqual([]);
  });

  it("handles co-authors-only posts (no main author profile)", () => {
    const { author, authors } = buildPostAuthors({
      orderedAuthorIds: ["b", "c"],
      profileRows: [row("b"), row("c")],
      mainAuthorId: null,
      overlay: null,
    });
    expect(author).toBeNull();
    expect(authors.map((r) => r.id)).toEqual(["b", "c"]);
  });
});
