import { describe, expect, it } from "vitest";
import {
  countryFlagEmoji,
  createBlankInlineEntity,
  inlineEntityDisplayName,
  inlineEntityInitials,
  isInlineEntityId,
  newInlineEntityId,
  normalizeExternalUrl,
  normalizeInlineEntity,
  normalizeInlineEntityRegistry,
  pickLocalized,
  urlHostLabel,
  INLINE_ENTITY_LIMITS,
} from "../model";
import { company, person } from "./fixtures";

describe("normalizeInlineEntity", () => {
  it("keeps a valid company and person untouched", () => {
    expect(normalizeInlineEntity(company())).toEqual(company());
    expect(normalizeInlineEntity(person())).toEqual(person());
  });

  it("rejects unknown kinds, bad ids and nameless records", () => {
    expect(normalizeInlineEntity({ ...company(), kind: "place" })).toBeNull();
    expect(normalizeInlineEntity({ ...company(), id: "x" })).toBeNull();
    expect(normalizeInlineEntity({ ...company(), id: 'ie_"><script>' })).toBeNull();
    expect(normalizeInlineEntity({ ...company(), name: "   " })).toBeNull();
    expect(normalizeInlineEntity({ ...person(), firstName: "", lastName: "" })).toBeNull();
    expect(normalizeInlineEntity(null)).toBeNull();
    expect(normalizeInlineEntity("ie_acme0001")).toBeNull();
  });

  it("drops unsafe urls and data: images, keeps http(s)", () => {
    const out = normalizeInlineEntity({
      ...company(),
      website: "javascript:alert(1)",
      socials: { linkedin: "javascript:alert(1)", x: "x.com/acme", unknown: "https://a.b" },
      image: { src: "data:image/png;base64,AAAA" },
    });
    expect(out?.website).toBe("");
    expect(out?.socials).toEqual({ x: "https://x.com/acme" });
    expect(out?.image).toBeNull();
  });

  it("clamps crop geometry and zoom", () => {
    const out = normalizeInlineEntity({
      ...person(),
      image: {
        src: "https://cdn.example.com/p.jpg",
        original: "https://cdn.example.com/p-orig.jpg",
        area: { x: -5, y: 10, width: 150, height: 50 },
        zoom: 40,
      },
    });
    expect(out?.image).toEqual({
      src: "https://cdn.example.com/p.jpg",
      original: "https://cdn.example.com/p-orig.jpg",
      area: { x: 0, y: 10, width: 100, height: 50 },
      zoom: 6,
    });
  });

  it("ignores a degenerate crop area", () => {
    const out = normalizeInlineEntity({
      ...person(),
      image: { src: "https://cdn.example.com/p.jpg", area: { x: 0, y: 0, width: 0, height: 1 } },
    });
    expect(out?.image).toEqual({ src: "https://cdn.example.com/p.jpg" });
  });

  it("accepts a plain string for localized fields and trims whitespace", () => {
    const out = normalizeInlineEntity({ ...company(), industry: "  Obronność \n " });
    expect(out?.kind === "company" && out.industry).toEqual({ pl: "Obronność", en: "Obronność" });
  });

  it("normalizes country and falls back between languages", () => {
    const out = normalizeInlineEntity({ ...company(), country: { code: "de", pl: "Niemcy" } });
    expect(out?.kind === "company" && out.country).toEqual({
      code: "DE",
      pl: "Niemcy",
      en: "Niemcy",
    });
    const bad = normalizeInlineEntity({ ...company(), country: { code: "XYZ", en: "Atlantis" } });
    expect(bad?.kind === "company" && bad.country).toEqual({
      code: "",
      pl: "Atlantis",
      en: "Atlantis",
    });
    const none = normalizeInlineEntity({ ...company(), country: { code: "PL" } });
    expect(none?.kind === "company" && none.country).toBeNull();
  });

  it("normalizes sources", () => {
    expect(
      normalizeInlineEntity({ ...person(), source: { type: "author", id: "u1" } })?.source,
    ).toEqual({
      type: "author",
      id: "u1",
      slug: null,
      syncedAt: "",
    });
    expect(normalizeInlineEntity({ ...person(), source: { type: "crm" } })?.source).toEqual({
      type: "manual",
    });
    expect(normalizeInlineEntity({ ...person(), source: "crm" })?.source).toEqual({
      type: "manual",
    });
  });

  it("caps text length", () => {
    const out = normalizeInlineEntity({ ...company(), name: "A".repeat(500) });
    expect(out?.kind === "company" && out.name.length).toBe(INLINE_ENTITY_LIMITS.name);
  });
});

describe("normalizeInlineEntityRegistry", () => {
  it("re-keys by entity id and skips broken rows", () => {
    const out = normalizeInlineEntityRegistry({ wrong: company(), b: { id: "ie_bad" } });
    expect(Object.keys(out)).toEqual(["ie_acme0001"]);
    expect(normalizeInlineEntityRegistry([company()])).toEqual({});
    expect(normalizeInlineEntityRegistry(undefined)).toEqual({});
  });

  it("enforces the per-document cap", () => {
    const many = Object.fromEntries(
      Array.from({ length: INLINE_ENTITY_LIMITS.perDocument + 5 }, (_, i) => {
        const id = `ie_many${String(i).padStart(4, "0")}`;
        return [id, company({ id })];
      }),
    );
    expect(Object.keys(normalizeInlineEntityRegistry(many))).toHaveLength(
      INLINE_ENTITY_LIMITS.perDocument,
    );
  });
});

describe("presentation helpers", () => {
  it("builds display names and initials", () => {
    expect(inlineEntityDisplayName(person())).toBe("Maya Chen");
    expect(inlineEntityDisplayName(person({ lastName: "" }))).toBe("Maya");
    expect(inlineEntityInitials(person())).toBe("MC");
    expect(inlineEntityInitials(company())).toBe("AE");
    expect(inlineEntityInitials(company({ name: "Orlen" }))).toBe("OR");
    expect(inlineEntityInitials(person({ firstName: "", lastName: "" }))).toBe("?");
  });

  it("picks the requested language with fallback", () => {
    expect(pickLocalized({ pl: "Energetyka", en: "Energy" }, "en")).toBe("Energy");
    expect(pickLocalized({ pl: "Energetyka", en: "" }, "en")).toBe("Energetyka");
    expect(pickLocalized({ pl: "", en: "" }, "pl")).toBe("");
  });

  it("turns ISO codes into flags", () => {
    expect(countryFlagEmoji("PL")).toBe("🇵🇱");
    expect(countryFlagEmoji("pl")).toBe("");
    expect(countryFlagEmoji("")).toBe("");
  });

  it("formats host labels and urls", () => {
    expect(urlHostLabel("https://www.acme.example.com/about")).toBe("acme.example.com");
    expect(urlHostLabel("not a url")).toBe("not a url");
    expect(normalizeExternalUrl("acme.pl")).toBe("https://acme.pl/");
    expect(normalizeExternalUrl("localhost")).toBe("");
    expect(normalizeExternalUrl("ftp://acme.pl")).toBe("");
    expect(normalizeExternalUrl(42)).toBe("");
  });

  it("generates valid ids", () => {
    const id = newInlineEntityId();
    expect(isInlineEntityId(id)).toBe(true);
    expect(id).not.toBe(newInlineEntityId());
  });
});

describe("createBlankInlineEntity", () => {
  it("prefills a company name", () => {
    const entity = createBlankInlineEntity("company", {
      id: "ie_blank001",
      name: " Orlen ",
      now: "t",
    });
    expect(entity).toMatchObject({
      id: "ie_blank001",
      kind: "company",
      name: "Orlen",
      updatedAt: "t",
    });
  });

  it("splits a person name on the last word", () => {
    expect(createBlankInlineEntity("person", { name: "Jan Maria Rokita" })).toMatchObject({
      firstName: "Jan Maria",
      lastName: "Rokita",
    });
    expect(createBlankInlineEntity("person", { name: "Madonna" })).toMatchObject({
      firstName: "Madonna",
      lastName: "",
    });
    const blank = createBlankInlineEntity("person");
    expect(blank).toMatchObject({ firstName: "", lastName: "", source: { type: "manual" } });
    expect(isInlineEntityId(blank.id)).toBe(true);
  });
});
