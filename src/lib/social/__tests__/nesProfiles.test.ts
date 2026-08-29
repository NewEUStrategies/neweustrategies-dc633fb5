// Adresy profili fundacji: JEDEN INWARIANT I JEDEN PARYTET.
//
// PO CO TEN PLIK ISTNIEJE
//
// Zgloszenie redakcji brzmialo: „odnosniki spolecznosciowe w stopce prowadza
// do stron glownych serwisow zamiast do profili fundacji". Przyczyna nie byla
// literowka, tylko BRAK MIEJSCA, ktore by o tych adresach decydowalo. Trzy
// powierzchnie niosly trzy rozne odpowiedzi na to samo pytanie:
//   * stopka maili systemowych - `x.com/NEStrategies`,
//   * strona /kontakt (seed 20260726221149) - `x.com/NewEUStrategies`,
//   * stopka witryny (seed 20260727075644) - `https://twitter.com/`.
// Zaden test nie mogl tego zobaczyc, bo nie bylo czego z czym porownac.
//
// CO TEN PLIK MIERZY
//   1. INWARIANT: adres profilu ma za hostem CHOC JEDEN segment sciezki.
//      To jest cala usterka sprowadzona do predykatu - `https://twitter.com/`
//      i `https://x.com/NewEUStrategies` sa oba poprawnymi URL-ami i oba
//      przechodza przez `safeUrl`, ale tylko drugi prowadzi tam, gdzie ikona
//      obiecuje.
//   2. PARYTET KODU Z MIGRACJA: migracja 20260829220000 wpisuje te same
//      adresy do `site_settings`. SQL nie umie zaimportowac modulu TS, wiec
//      jedyna mozliwa bramka miedzy nimi to przeczytanie pliku migracji -
//      i ona tu stoi. Bez niej „jedno zrodlo prawdy" jest deklaracja,
//      a nie faktem.
//
// CZEGO TEN PLIK NIE SPRAWDZA
//   * nie sprawdza, czy profil ISTNIEJE - to fakt o swiecie, nie o kodzie;
//   * nie sprawdza starych seedow (/kontakt, stopka sprzed naprawy) - migracje
//     sa niezmienne i historia ma prawo byc niespojna, o stanie bazy decyduje
//     migracja NAJNOWSZA;
//   * nie sprawdza renderu widgetu - `showEmpty` i chowanie kafelka bez linku
//     maja wlasne testy w `builder/organisms/widget-view/__tests__`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  NES_CONTACT_EMAIL,
  NES_PROFILE_URLS,
  NES_SOCIAL_PLATFORMS,
  isSocialProfileUrl,
  type NesSocialPlatform,
} from "../nesProfiles";
import { NES_SOCIAL_LINKS } from "@/lib/email-templates/social";

const FOOTER_MIGRATION = "supabase/migrations/20260829220000_footer_social_profile_urls.sql";

/** Strony glowne serwisow - dokladnie to, co stalo w seedzie stopki. */
const SERVICE_HOMEPAGES = [
  "https://twitter.com/",
  "https://x.com/",
  "https://youtube.com/",
  "https://instagram.com/",
  "https://linkedin.com/",
  "https://facebook.com/",
  "https://spotify.com/",
];

describe("isSocialProfileUrl - strona glowna serwisu to NIE jest profil", () => {
  it("odrzuca goly adres serwisu, z ukosnikiem i bez", () => {
    for (const homepage of SERVICE_HOMEPAGES) {
      expect(isSocialProfileUrl(homepage)).toBe(false);
      expect(isSocialProfileUrl(homepage.replace(/\/$/, ""))).toBe(false);
    }
  });

  it("przyjmuje adres z uchwytem profilu", () => {
    expect(isSocialProfileUrl("https://x.com/NewEUStrategies")).toBe(true);
    expect(isSocialProfileUrl("https://www.linkedin.com/company/new-european-strategies")).toBe(
      true,
    );
    expect(isSocialProfileUrl("https://www.youtube.com/@kanal")).toBe(true);
  });

  it("odrzuca pustke, zaslepke `#` i adres bez schematu", () => {
    // `"#"` jest dla widgetu adresem PRAWDZIWYM (`active = !!href`), wiec
    // rysuje sie jako zywa ikona otwierajaca te sama strone - to ten sam
    // gatunek usterki, co strona glowna serwisu.
    for (const bad of ["", "   ", "#", "/kontakt", "x.com/NES", "mailto:a@b.pl", "https://"]) {
      expect(isSocialProfileUrl(bad)).toBe(false);
    }
  });

  it("ignoruje same parametry i kotwice - one nie robia z hosta profilu", () => {
    expect(isSocialProfileUrl("https://x.com/?ref=nes")).toBe(false);
    expect(isSocialProfileUrl("https://x.com/#top")).toBe(false);
  });
});

describe("NES_PROFILE_URLS - kazdy niepusty adres jest adresem PROFILU", () => {
  it("pokrywa dokladnie platformy widgetu `social-icons`", () => {
    expect(Object.keys(NES_PROFILE_URLS).sort()).toEqual([...NES_SOCIAL_PLATFORMS].sort());
  });

  it("nie niesie ani jednej strony glownej serwisu", () => {
    for (const platform of NES_SOCIAL_PLATFORMS) {
      const href = NES_PROFILE_URLS[platform];
      // Pusty napis jest DOPUSZCZALNA odpowiedzia - znaczy „nie znamy profilu"
      // i widget nie narysuje wtedy kafelka. Niedopuszczalny jest adres, ktory
      // udaje profil.
      if (href === "") continue;
      expect(isSocialProfileUrl(href), `${platform}: ${href}`).toBe(true);
    }
  });

  it("adres kontaktowy stoi w domenie serwisu", () => {
    expect(NES_CONTACT_EMAIL.endsWith("@neweuropeanstrategies.com")).toBe(true);
  });
});

describe("stopka maili systemowych czyta te same adresy", () => {
  it("kazdy odnosnik maila to profil, nie strona glowna", () => {
    for (const link of NES_SOCIAL_LINKS) {
      expect(isSocialProfileUrl(link.href), `${link.key}: ${link.href}`).toBe(true);
    }
  });

  it("adresy maila SA adresami z modulu kanonicznego, a nie ich kopia", () => {
    const byKey = new Map(NES_SOCIAL_LINKS.map((link) => [link.key, link.href]));
    for (const key of ["linkedin", "facebook", "x"] as NesSocialPlatform[]) {
      expect(byKey.get(key)).toBe(NES_PROFILE_URLS[key]);
    }
  });
});

describe("PARYTET: migracja stopki wpisuje dokladnie te adresy", () => {
  const sql = readFileSync(FOOTER_MIGRATION, "utf8");

  it("kazdy znany profil pojawia sie w migracji doslownie", () => {
    for (const platform of NES_SOCIAL_PLATFORMS) {
      const href = NES_PROFILE_URLS[platform];
      if (href === "") continue;
      expect(sql.includes(`'${href}'`), `${platform}: ${href} brak w ${FOOTER_MIGRATION}`).toBe(
        true,
      );
    }
  });

  it("migracja nie podstawia zadnej strony glownej serwisu", () => {
    // Nazwy serwisow wolno w tym pliku wymieniac w KOMENTARZU (opisuje usterke),
    // wiec mierzymy wylacznie linie wykonywane.
    const executable = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    for (const homepage of SERVICE_HOMEPAGES) {
      expect(executable.includes(`'${homepage}'`), `podstawia ${homepage}`).toBe(false);
    }
  });

  it("kasuje historyczny klucz `twitter`, bo panel nie umie go usunac", () => {
    // Widget czyta `twitter` jako alias, gdy kanoniczne `x` jest puste, a panel
    // zapisuje wylacznie `x`. Zostawiony alias wracalby do renderu przy kazdym
    // wyczyszczeniu pola X w edytorze.
    expect(sql.includes("- 'twitter'")).toBe(true);
  });

  it("podstawia TYLKO tam, gdzie dzisiejsza wartosc nie jest profilem", () => {
    // Ten sam predykat, co `isSocialProfileUrl` - inaczej migracja albo
    // nadpisalaby prace redakcji, albo zostawilaby `https://x.com/?ref=...`
    // jako „profil". Rozjazd obu stron jest tu jedynym realnym ryzykiem,
    // bo SQL nie umie zaimportowac modulu.
    expect(sql.includes("'^https?://[^/]+/[^/?#]'")).toBe(true);
  });

  it("wpisuje adres kontaktowy z modulu, a nie domene spoza serwisu", () => {
    expect(sql.includes(`'${NES_CONTACT_EMAIL}'`)).toBe(true);
    expect(sql.includes("'kontakt@neweustrategies.pl'")).toBe(false);
  });
});
