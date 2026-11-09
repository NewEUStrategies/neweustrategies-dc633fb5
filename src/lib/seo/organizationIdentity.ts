// TOŻSAMOŚĆ WYDAWCY dla warstwy encji (JSON-LD `Organization` strony głównej
// i llms.txt) - fakty rejestrowe, po których wyszukiwarka i asystent AI
// odróżniają markę od pojęć o podobnej nazwie.
//
// PO CO (2026-11-08, wynik Google dla zapytania „new european strategies").
// Pod wynikiem serwisu „Przegląd od AI" streszczał „Nową Europejską Strategię
// Bezpieczeństwa" Komisji Europejskiej - zapytanie o markę zostało zrozumiane
// jako pytanie o strategię UE. Encja wydawcy w JSON-LD miała wyłącznie nazwę,
// skrót, opis i logo: bez `sameAs` (pole w panelu było puste), bez adresu,
// bez identyfikatorów rejestrowych - czyli bez niczego, co pozwala połączyć
// nazwę „New European Strategies" z konkretnym podmiotem. Google opisuje te
// właściwości jako sygnały ujednoznaczniające organizację
// (https://developers.google.com/search/docs/appearance/structured-data/organization),
// a schema.org ma do tego wprost `disambiguatingDescription`.
//
// ŹRÓDŁA (sprawdzone 2026-11-08):
//   * KRS 0001195512 - odpis aktualny z API Ministerstwa Sprawiedliwości
//     (https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0001195512?rejestr=S):
//     forma prawna FUNDACJA, nazwa „NEW EUROPEAN STRATEGIES", NIP 7011278375,
//     adres ul. Tytusa Chałubińskiego 8, 00-613 Warszawa, e-mail
//     office@neweuropeanstrategies.com, strona https://neweuropeanstrategies.com/;
//   * stopka serwisu i strona /o-nas - REGON 542769005, telefon
//     (+48) 784 880 318, obszary rad programowych (`knowsAbout`);
//   * profile społecznościowe - `lib/social/nesProfiles.ts` (potwierdzone).
// Celowo BEZ `foundingDate`: fundacja jest w KRS od 2025-09-19, a marka
// działała wcześniej (konferencja „Gra Mocarstw 2021", publikacje z 2023) -
// data rejestracji podana jako data założenia myliłaby co do historii marki.
//
// TENANT-SAFE. Fakty dotyczą wyłącznie fundacji NES, więc dostaje je tylko host
// kanoniczny marki (`isCanonicalSiteHost`). Domena innego tenanta, alias
// hostingu i podgląd edytora nie publikują cudzego NIP-u ani adresu.
import { isCanonicalSiteHost } from "@/lib/http/host";
import { NES_CONTACT_EMAIL, NES_PROFILE_URLS } from "@/lib/social/nesProfiles";

type IdentityLang = "pl" | "en";

export interface OrganizationPostalAddress {
  streetAddress: string;
  postalCode: string;
  addressLocality: string;
  /** Kod kraju ISO 3166-1 alpha-2. */
  addressCountry: string;
}

export interface OrganizationRegistryId {
  /** Nazwa rejestru (`PropertyValue.propertyID`), np. „KRS". */
  propertyID: string;
  value: string;
}

export interface OrganizationIdentity {
  /** Dodatkowe nazwy podmiotu (forma prawna + nazwa, wariant angielski). */
  alternateNames: readonly string[];
  email: string;
  telephone: string;
  address: OrganizationPostalAddress;
  /** NIP - `Organization.taxID` (kraj zgodny z `address.addressCountry`). */
  taxId: string;
  /** Identyfikatory rejestrowe - `Organization.identifier` (PropertyValue). */
  registryIds: readonly OrganizationRegistryId[];
  /** Obszary eksperckie - `Organization.knowsAbout`. */
  knowsAbout: Readonly<Record<IdentityLang, readonly string[]>>;
  /** Jedno zdanie odróżniające podmiot od pojęć o podobnej nazwie. */
  disambiguation: Readonly<Record<IdentityLang, string>>;
  /** Oficjalne profile - `Organization.sameAs`, gdy panel SEO nie podaje własnych. */
  profiles: readonly string[];
}

export const NES_ORGANIZATION_IDENTITY: OrganizationIdentity = {
  alternateNames: ["Fundacja New European Strategies", "New European Strategies Foundation"],
  email: NES_CONTACT_EMAIL,
  telephone: "+48 784 880 318",
  address: {
    streetAddress: "ul. Tytusa Chałubińskiego 8",
    postalCode: "00-613",
    addressLocality: "Warszawa",
    addressCountry: "PL",
  },
  taxId: "7011278375",
  registryIds: [
    { propertyID: "KRS", value: "0001195512" },
    { propertyID: "REGON", value: "542769005" },
  ],
  knowsAbout: {
    pl: [
      "Bezpieczeństwo europejskie",
      "Rywalizacja mocarstw",
      "Geopolityka i wojskowość",
      "Finanse i gospodarka",
      "Dyplomacja i stosunki międzynarodowe",
      "Transport i energetyka",
      "Technologia i cyberbezpieczeństwo",
    ],
    en: [
      "European security",
      "Great-power rivalry",
      "Geopolitics and military affairs",
      "Finance and economy",
      "Diplomacy and international relations",
      "Transport and energy",
      "Technology and cybersecurity",
    ],
  },
  disambiguation: {
    pl: "Polska fundacja i niezależny think tank z siedzibą w Warszawie (KRS 0001195512), wydawca analiz, raportów, wywiadów i policy papers o bezpieczeństwie Europy i geopolityce, organizator konferencji i spotkań w formule Chatham House. Organizacja pozarządowa - nie jest instytucją Unii Europejskiej ani dokumentem strategicznym UE.",
    en: "Polish foundation and independent think tank based in Warsaw (KRS 0001195512) that publishes analyses, reports, interviews and policy papers on European security and geopolitics and runs conferences and Chatham House-rule meetings. A non-governmental organisation - not an institution of the European Union nor an EU strategy document.",
  },
  profiles: Object.values(NES_PROFILE_URLS).filter(Boolean),
};

/** Host z originu albo pełnego adresu (`null`, gdy nie da się go odczytać). */
function hostOf(originOrUrl: string | null | undefined): string | null {
  if (!originOrUrl) return null;
  try {
    return new URL(originOrUrl).host;
  } catch {
    return null;
  }
}

/**
 * Tożsamość wydawcy dla originu żądania - wyłącznie na hoście kanonicznym
 * marki, inaczej `null` (patrz „TENANT-SAFE" w nagłówku).
 */
export function organizationIdentityFor(
  originOrUrl: string | null | undefined,
): OrganizationIdentity | null {
  return isCanonicalSiteHost(hostOf(originOrUrl)) ? NES_ORGANIZATION_IDENTITY : null;
}
