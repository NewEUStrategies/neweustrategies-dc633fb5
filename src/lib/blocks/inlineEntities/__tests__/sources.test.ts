// Źródła encji inline: mapowanie wiersza CRM / profilu autora na kopię
// w materiale oraz wywołania RPC (tylko odczyt - żadnego zapisu do źródła).
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

import {
  authorRowLabel,
  companyEntityFromCrm,
  countryNameOptions,
  INLINE_ENTITY_SEARCH_LIMIT,
  lookupAuthors,
  lookupCrmCompanies,
  personEntityFromAuthor,
  resolveCountry,
  type AuthorRow,
  type CrmCompanyRow,
} from "../sources";

const NOW = "2026-09-24T10:00:00.000Z";

function crmRow(overrides: Partial<CrmCompanyRow> = {}): CrmCompanyRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "  Acme   Energy ",
    country: "Polska",
    branch: "Energetyka",
    specialization: "Magazyny energii",
    website: "acme.example.com",
    domain: "acme.example.com",
    logo_url: "https://cdn.example.com/acme.png",
    social_links: { linkedin: "https://linkedin.com/company/acme", x: "javascript:alert(1)" },
    ...overrides,
  };
}

function authorRow(overrides: Partial<AuthorRow> = {}): AuthorRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "anna-nowak",
    first_name: "Anna",
    last_name: "Nowak",
    display_name: "Anna Nowak",
    job_title: "Analityczka",
    company: "NES",
    website_url: "https://anna.example.com",
    linkedin_url: "https://linkedin.com/in/anna",
    x_url: null,
    facebook_url: null,
    instagram_url: "instagram.com/anna",
    avatar_url: "https://cdn.example.com/anna.jpg",
    specialization: null,
    ...overrides,
  };
}

describe("resolveCountry", () => {
  it("resolves Polish and English names and ISO codes", () => {
    expect(resolveCountry("Polska")).toEqual({ code: "PL", pl: "Polska", en: "Poland" });
    expect(resolveCountry("Germany")).toMatchObject({ code: "DE", pl: "Niemcy" });
    expect(resolveCountry("fr")).toMatchObject({ code: "FR", en: "France" });
  });

  it("keeps unknown text and ignores blanks", () => {
    expect(resolveCountry("Atlantyda")).toEqual({ code: "", pl: "Atlantyda", en: "Atlantyda" });
    expect(resolveCountry("  ")).toBeNull();
    expect(resolveCountry(null)).toBeNull();
    expect(resolveCountry(undefined)).toBeNull();
  });

  it("lists country names sorted for the UI language", () => {
    const pl = countryNameOptions("pl");
    expect(pl).toContain("Polska");
    expect([...pl].sort((a, b) => a.localeCompare(b, "pl"))).toEqual(pl);
    expect(countryNameOptions("en")).toContain("Poland");
  });
});

describe("companyEntityFromCrm", () => {
  it("maps every publishable CRM field into a material-owned copy", () => {
    const entity = companyEntityFromCrm(crmRow(), NOW);
    expect(entity).toMatchObject({
      kind: "company",
      name: "Acme Energy",
      country: { code: "PL", pl: "Polska", en: "Poland" },
      industry: { pl: "Energetyka", en: "Energetyka" },
      specialization: { pl: "Magazyny energii", en: "Magazyny energii" },
      website: "https://acme.example.com/",
      socials: { linkedin: "https://linkedin.com/company/acme" },
      image: {
        src: "https://cdn.example.com/acme.png",
        original: "https://cdn.example.com/acme.png",
      },
      source: { type: "crm", id: crmRow().id, syncedAt: NOW },
      updatedAt: NOW,
    });
    expect(entity.id.startsWith("ie_")).toBe(true);
  });

  it("keeps the id and a custom crop when refreshing", () => {
    const image = {
      src: "https://cdn.example.com/crop.webp",
      original: "https://cdn.example.com/o.png",
    };
    const entity = companyEntityFromCrm(crmRow(), NOW, { id: "ie_keep0001", image });
    expect(entity.id).toBe("ie_keep0001");
    expect(entity.image).toBe(image);
  });

  it("falls back to the domain, tolerates empty values and odd social payloads", () => {
    const entity = companyEntityFromCrm(
      crmRow({
        website: null,
        country: null,
        branch: null,
        specialization: null,
        logo_url: null,
        social_links: ["nope"],
      }),
      NOW,
      { id: "ie_keep0001", image: null },
    );
    expect(entity.website).toBe("https://acme.example.com/");
    expect(entity.country).toBeNull();
    expect(entity.industry).toEqual({ pl: "", en: "" });
    expect(entity.socials).toEqual({});
    expect(entity.image).toBeNull();
    expect(companyEntityFromCrm(crmRow({ social_links: null }), NOW).socials).toEqual({});
  });
});

describe("personEntityFromAuthor", () => {
  it("maps the author profile without touching it", () => {
    const entity = personEntityFromAuthor(authorRow(), NOW);
    expect(entity).toMatchObject({
      kind: "person",
      firstName: "Anna",
      lastName: "Nowak",
      position: { pl: "Analityczka", en: "Analityczka" },
      company: "NES",
      website: "https://anna.example.com/",
      socials: {
        linkedin: "https://linkedin.com/in/anna",
        instagram: "https://instagram.com/anna",
      },
      image: { src: "https://cdn.example.com/anna.jpg" },
      source: { type: "author", id: authorRow().id, slug: "anna-nowak", syncedAt: NOW },
    });
  });

  it("splits the display name when first/last names are missing", () => {
    const entity = personEntityFromAuthor(
      authorRow({ first_name: null, last_name: " ", display_name: "Jan Maria Rokita", slug: null }),
      NOW,
    );
    expect(entity.firstName).toBe("Jan Maria");
    expect(entity.lastName).toBe("Rokita");
    expect(entity.source).toMatchObject({ slug: null });
    const single = personEntityFromAuthor(
      authorRow({ first_name: null, last_name: null, display_name: "Madonna" }),
      NOW,
    );
    expect(single).toMatchObject({ firstName: "Madonna", lastName: "" });
    const none = personEntityFromAuthor(
      authorRow({ first_name: null, last_name: null, display_name: null, avatar_url: null }),
      NOW,
      { id: "ie_keep0001" },
    );
    expect(none).toMatchObject({ firstName: "", lastName: "", image: null, id: "ie_keep0001" });
  });

  it("labels search rows", () => {
    expect(authorRowLabel(authorRow({ display_name: "  " }))).toBe("Anna Nowak");
    expect(authorRowLabel(authorRow())).toBe("Anna Nowak");
  });
});

describe("lookups (read-only RPC)", () => {
  const abortSignal = vi.fn();
  beforeEach(() => {
    rpc.mockReset();
    abortSignal.mockReset();
  });

  function resolved(data: unknown, error: unknown = null) {
    const result = Promise.resolve({ data, error });
    abortSignal.mockReturnValue(result);
    return Object.assign(result, { abortSignal });
  }

  it("searches CRM companies by query and fetches one by id", async () => {
    rpc.mockReturnValue(resolved([crmRow()]));
    expect(await lookupCrmCompanies({ q: "acme" })).toEqual([crmRow()]);
    expect(rpc).toHaveBeenCalledWith("crm_company_inline_lookup", {
      p_query: "acme",
      p_id: undefined,
      p_limit: INLINE_ENTITY_SEARCH_LIMIT,
    });
    const controller = new AbortController();
    await lookupCrmCompanies({ id: crmRow().id }, controller.signal);
    expect(rpc).toHaveBeenLastCalledWith("crm_company_inline_lookup", {
      p_query: "",
      p_id: crmRow().id,
      p_limit: INLINE_ENTITY_SEARCH_LIMIT,
    });
    expect(abortSignal).toHaveBeenCalledWith(controller.signal);
  });

  it("searches authors and surfaces errors", async () => {
    rpc.mockReturnValue(resolved(null));
    expect(await lookupAuthors({ q: "an" })).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("editor_inline_author_lookup", {
      p_query: "an",
      p_id: undefined,
      p_limit: INLINE_ENTITY_SEARCH_LIMIT,
    });
    rpc.mockReturnValue(resolved(null, new Error("denied")));
    await expect(lookupAuthors({ id: "x" }, new AbortController().signal)).rejects.toThrow(
      "denied",
    );
    rpc.mockReturnValue(resolved(null, new Error("denied")));
    await expect(lookupCrmCompanies({ q: "x" })).rejects.toThrow("denied");
    rpc.mockReturnValue(resolved(null));
    expect(await lookupCrmCompanies({})).toEqual([]);
  });
});
