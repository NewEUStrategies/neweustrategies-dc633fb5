// Testy reguł ujawnienia komercyjnego. Każdy przypadek pilnuje konkretnego
// wymogu prawnego, nie kształtu kodu - dlatego nazwy mówią, CO by się stało
// przy regresji, a nie „zwraca obiekt".
import { describe, it, expect } from "vitest";
import {
  DISCLOSURE_ERROR_PREFIX,
  SPONSORED_KINDS,
  articleJsonLdType,
  disclosureGaps,
  isSponsoredKind,
  parseDisclosureError,
  resolveDisclosure,
} from "../sponsored";

const paid = {
  is_sponsored: true,
  sponsored_kind: "advertisement",
  sponsored_advertiser_name: "ACME Europe",
  sponsored_advertiser_url: "https://acme.example",
};

describe("resolveDisclosure", () => {
  it("materiał bez relacji komercyjnej nie renderuje niczego", () => {
    expect(resolveDisclosure({}).required).toBe(false);
    expect(resolveDisclosure({ is_sponsored: false }).required).toBe(false);
  });

  it("pełna deklaracja daje etykietę, reklamodawcę i jego adres", () => {
    const d = resolveDisclosure(paid);
    expect(d.required).toBe(true);
    expect(d.kind).toBe("advertisement");
    expect(d.advertiser).toBe("ACME Europe");
    expect(d.advertiserUrl).toBe("https://acme.example");
  });

  // FAIL-SAFE: brak nazwy NIE MOŻE wyłączyć etykiety. Materiał opłacony bez
  // żadnego oznaczenia to kryptoreklama (UZNK art. 16 ust. 1 pkt 4) - gorsze
  // naruszenie niż oznaczenie niepełne.
  it("flaga bez nazwy reklamodawcy WCIĄŻ wymaga etykiety", () => {
    const d = resolveDisclosure({ is_sponsored: true, sponsored_kind: "sponsored" });
    expect(d.required).toBe(true);
    expect(d.kind).toBe("sponsored");
    expect(d.advertiser).toBeNull();
  });

  it("nieznany rodzaj relacji nie przemyca się do renderu", () => {
    const d = resolveDisclosure({ is_sponsored: true, sponsored_kind: "kryptoreklama" });
    expect(d.kind).toBeNull();
    expect(d.required).toBe(false);
  });

  // Afiliacja jest ortogonalna: dyr. 2005/29/WE art. 7 ust. 2 obejmuje korzyść
  // także tam, gdzie nikt nie zapłacił za materiał.
  it("linki afiliacyjne ujawniają się bez sponsoringu", () => {
    const d = resolveDisclosure({ sponsored_affiliate: true });
    expect(d.required).toBe(true);
    expect(d.affiliate).toBe(true);
    expect(d.kind).toBeNull();
  });

  // DSA art. 26 ust. 1 lit. c: płatnika ujawniamy, gdy JEST INNY niż reklamodawca.
  it("płatnika pokazuje tylko wtedy, gdy różni się od reklamodawcy", () => {
    expect(resolveDisclosure({ ...paid, sponsored_payer_name: "ACME Europe" }).payer).toBeNull();
    expect(resolveDisclosure({ ...paid, sponsored_payer_name: "Agencja XYZ" }).payer).toBe(
      "Agencja XYZ",
    );
  });

  it("reklama polityczna niesie proces i podmiot kontrolujący sponsora", () => {
    const d = resolveDisclosure({
      ...paid,
      sponsored_political: true,
      sponsored_political_process: "rewizja REACH",
      sponsored_sponsor_controller: "Grupa ABC",
    });
    expect(d.political).toBe(true);
    expect(d.politicalProcess).toBe("rewizja REACH");
    expect(d.sponsorController).toBe("Grupa ABC");
  });

  it("flaga polityczna bez oznaczenia materiału jako komercyjnego nie renderuje bloku", () => {
    const d = resolveDisclosure({ sponsored_political: true });
    expect(d.political).toBe(false);
  });

  it("białe znaki nie udają wypełnionego pola", () => {
    const d = resolveDisclosure({ ...paid, sponsored_advertiser_name: "   " });
    expect(d.advertiser).toBeNull();
  });
});

describe("disclosureGaps", () => {
  it("materiał niekomercyjny nie ma braków", () => {
    expect(disclosureGaps({})).toEqual([]);
  });

  it("pełna deklaracja przechodzi", () => {
    expect(disclosureGaps(paid)).toEqual([]);
  });

  // Reguła dwuczęściowa UOKiK: CO + KTO. Adres elektroniczny zlecającego jest
  // elementem ustawowym oznaczenia (uśude art. 9 ust. 1 pkt 1).
  it("zgłasza brak reklamodawcy i jego adresu", () => {
    expect(disclosureGaps({ is_sponsored: true, sponsored_kind: "sponsored" })).toEqual([
      "advertiser",
      "advertiserUrl",
    ]);
  });

  it("zgłasza brak rodzaju relacji", () => {
    expect(disclosureGaps({ ...paid, sponsored_kind: null })).toContain("kind");
  });

  it("reklama polityczna wymaga wskazania procesu (rozp. 2024/900 art. 11 ust. 1 lit. c)", () => {
    expect(disclosureGaps({ ...paid, sponsored_political: true })).toEqual(["politicalProcess"]);
    expect(
      disclosureGaps({ ...paid, sponsored_political: true, sponsored_political_process: "wybory" }),
    ).toEqual([]);
  });

  it("reklama polityczna bez flagi komercyjnej jest wewnętrznie sprzeczna", () => {
    expect(disclosureGaps({ sponsored_political: true })).toEqual(["kind"]);
  });
});

describe("articleJsonLdType", () => {
  // Podmiana @type tylko dla treści, na którą reklamodawca miał wpływ.
  // Sponsoring z zachowaną niezależnością JEST materiałem redakcyjnym.
  it("AdvertiserContentArticle wyłącznie dla reklamy", () => {
    expect(articleJsonLdType("advertisement")).toBe("AdvertiserContentArticle");
    for (const kind of ["sponsored", "partner", "barter", "self_promo"] as const) {
      expect(articleJsonLdType(kind)).toBeNull();
    }
    expect(articleJsonLdType(null)).toBeNull();
  });
});

describe("kontrakt błędu serwera", () => {
  it("odczytuje braki z komunikatu odrzuconej publikacji", () => {
    const err = new Error(`${DISCLOSURE_ERROR_PREFIX}advertiser,advertiserUrl`);
    expect(parseDisclosureError(err)).toEqual(["advertiser", "advertiserUrl"]);
  });

  it("inny błąd nie jest interpretowany jako brak w ujawnieniu", () => {
    expect(parseDisclosureError(new Error("EDIT_CONFLICT"))).toEqual([]);
    expect(parseDisclosureError(undefined)).toEqual([]);
  });

  it("nieznane nazwy braków są odrzucane", () => {
    const err = new Error(`${DISCLOSURE_ERROR_PREFIX}advertiser,zmyslone`);
    expect(parseDisclosureError(err)).toEqual(["advertiser"]);
  });
});

describe("allowlista rodzajów relacji", () => {
  // Lustro CHECK-a `posts_sponsored_kind_check`. Rozjazd tej listy z migracją
  // oznacza opcję w panelu, której baza nie przyjmie.
  it("pokrywa dokładnie warianty z CHECK-a w bazie", () => {
    expect([...SPONSORED_KINDS]).toEqual([
      "advertisement",
      "sponsored",
      "partner",
      "barter",
      "self_promo",
    ]);
  });

  it("isSponsoredKind zawęża typ tylko do allowlisty", () => {
    expect(isSponsoredKind("sponsored")).toBe(true);
    expect(isSponsoredKind("Sponsored")).toBe(false);
    expect(isSponsoredKind("")).toBe(false);
  });
});
