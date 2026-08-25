// Testy warstwy szkicow sponsorow: konwersje wiersz <-> formularz <-> RPC oraz
// walidacja. Sprawdzamy REGULY, ktore baza wymusza po swojej stronie - zeby
// odmowa RPC nie byla pierwszym miejscem, gdzie organizator dowiaduje sie o
// bledzie.
import { describe, expect, it } from "vitest";
import {
  emptyMaterialDraft,
  emptySponsorDraft,
  emptyTierDraft,
  materialDraftToInput,
  sponsorDraftToInput,
  tierDraftFromRow,
  tierDraftToInput,
  validateMaterialDraft,
  validateSponsorDraft,
  validateTierDraft,
} from "@/lib/events/sponsorDraft";

const EVENT = "11111111-1111-1111-1111-111111111111";
const COMPANY = "22222222-2222-2222-2222-222222222222";
const SPONSOR = "33333333-3333-3333-3333-333333333333";

describe("szkic poziomu sponsorskiego", () => {
  it("pusty szkic nie przechodzi walidacji bez klucza i nazw", () => {
    const errors = validateTierDraft(emptyTierDraft(10, 1));
    expect(errors.length).toBeGreaterThan(0);
  });

  it("przyjmuje poprawny poziom i zamienia pusty limit na brak limitu", () => {
    const draft = {
      ...emptyTierDraft(10, 1),
      key: "gold",
      namePl: "Złoty",
      nameEn: "Gold",
      maxCompanies: "",
    };
    expect(validateTierDraft(draft)).toEqual([]);
    expect(tierDraftToInput(draft, EVENT).maxCompanies).toBeNull();
  });

  it("odrzuca klucz z wielkimi literami i zly kolor akcentu", () => {
    const draft = {
      ...emptyTierDraft(10, 1),
      key: "Gold Tier",
      namePl: "Złoty",
      nameEn: "Gold",
      accentColor: "gold",
    };
    const fields = validateTierDraft(draft).map((error) => error.field);
    expect(fields).toContain("key");
    expect(fields).toContain("accentColor");
  });

  it("czyta wiersz z bazy i zachowuje niezmienny klucz w danych RPC", () => {
    const draft = tierDraftFromRow({
      id: "tier-1",
      key: "silver",
      name_pl: "Srebrny",
      name_en: "Silver",
      rank: 2,
      sort_order: 20,
      max_companies: 4,
      is_active: true,
    });
    expect(draft.key).toBe("silver");
    const input = tierDraftToInput(draft, EVENT);
    expect(input.id).toBe("tier-1");
    expect(input.maxCompanies).toBe(4);
  });
});

describe("szkic przypiecia firmy", () => {
  it("wymaga firmy z CRM przy nowym przypieciu", () => {
    const fields = validateSponsorDraft(emptySponsorDraft(10)).map((error) => error.field);
    expect(fields).toContain("companyId");
  });

  it("opublikowany sponsor musi miec poziom", () => {
    const draft = { ...emptySponsorDraft(10), companyId: COMPANY, isPublished: true, tierId: "" };
    const fields = validateSponsorDraft(draft).map((error) => error.field);
    expect(fields).toContain("tierId");
  });

  it("przekazuje wybrana firme i role do danych RPC", () => {
    const draft = {
      ...emptySponsorDraft(10),
      companyId: COMPANY,
      snapshotName: "Acme sp. z o.o.",
      role: "media_partner" as const,
    };

    expect(validateSponsorDraft(draft)).toEqual([]);
    const input = sponsorDraftToInput(draft, EVENT);
    expect(input.companyId).toBe(COMPANY);
    expect(input.role).toBe("media_partner");
  });
});

describe("szkic materialu", () => {
  it("wymaga tytulow i adresu", () => {
    const fields = validateMaterialDraft(emptyMaterialDraft(10)).map((error) => error.field);
    expect(fields).toContain("url");
  });

  it("odrzuca adres http i przyjmuje https oraz sciezke wewnetrzna", () => {
    const base = { ...emptyMaterialDraft(10), titlePl: "Logo", titleEn: "Logo" };
    expect(
      validateMaterialDraft({ ...base, url: "http://example.com/a.pdf" }).map((e) => e.field),
    ).toContain("url");
    expect(validateMaterialDraft({ ...base, url: "https://example.com/a.pdf" })).toEqual([]);
    expect(validateMaterialDraft({ ...base, url: "/media/a.pdf" })).toEqual([]);
  });

  it("wiaze material z przypieciem sponsora", () => {
    const draft = {
      ...emptyMaterialDraft(10),
      titlePl: "Logo",
      titleEn: "Logo",
      url: "https://example.com/a.pdf",
    };
    expect(materialDraftToInput(draft, SPONSOR).sponsorId).toBe(SPONSOR);
  });
});
