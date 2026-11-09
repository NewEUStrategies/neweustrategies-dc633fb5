// Tożsamość wydawcy (`lib/seo/organizationIdentity.ts`): fakty fundacji NES
// wyłącznie na hoście kanonicznym marki.
import { describe, expect, it } from "vitest";
import { NES_ORGANIZATION_IDENTITY, organizationIdentityFor } from "@/lib/seo/organizationIdentity";
import { NES_PROFILE_URLS } from "@/lib/social/nesProfiles";

describe("organizationIdentityFor", () => {
  it("host kanoniczny marki (apex i www) dostaje tożsamość fundacji", () => {
    expect(organizationIdentityFor("https://neweuropeanstrategies.com")).toBe(
      NES_ORGANIZATION_IDENTITY,
    );
    expect(organizationIdentityFor("https://www.neweuropeanstrategies.com/en")).toBe(
      NES_ORGANIZATION_IDENTITY,
    );
  });

  it("domena innego tenanta, podgląd i brak originu - bez cudzego NIP-u i adresu", () => {
    for (const origin of [
      "https://tenant2.example",
      "https://id-preview--abc.lovable.app",
      "http://localhost:3000",
      "",
      null,
      undefined,
      "nie-adres",
    ]) {
      expect(organizationIdentityFor(origin), String(origin)).toBeNull();
    }
  });
});

describe("NES_ORGANIZATION_IDENTITY", () => {
  it("dane rejestrowe zgodne z odpisem KRS 0001195512 (2026-11-08)", () => {
    expect(NES_ORGANIZATION_IDENTITY.taxId).toMatch(/^\d{10}$/);
    expect(NES_ORGANIZATION_IDENTITY.registryIds).toEqual([
      { propertyID: "KRS", value: "0001195512" },
      { propertyID: "REGON", value: "542769005" },
    ]);
    expect(NES_ORGANIZATION_IDENTITY.address.addressCountry).toBe("PL");
  });

  it("profile to dokładnie potwierdzone profile NES - jedno źródło adresów", () => {
    expect(NES_ORGANIZATION_IDENTITY.profiles).toEqual(
      Object.values(NES_PROFILE_URLS).filter(Boolean),
    );
    for (const url of NES_ORGANIZATION_IDENTITY.profiles) expect(url).toMatch(/^https:\/\//);
  });

  it("zdanie ujednoznaczniające mówi, czym marka jest i czym nie jest - w obu językach", () => {
    expect(NES_ORGANIZATION_IDENTITY.disambiguation.pl).toMatch(/think tank/);
    expect(NES_ORGANIZATION_IDENTITY.disambiguation.pl).toMatch(/nie jest instytucją Unii/);
    expect(NES_ORGANIZATION_IDENTITY.disambiguation.en).toMatch(/think tank/);
    expect(NES_ORGANIZATION_IDENTITY.disambiguation.en).toMatch(/not an institution/);
  });
});
