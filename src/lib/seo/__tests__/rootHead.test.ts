// Plan pobierania zasobów krytycznych: `<link>` w `<head>` i nagłówek HTTP `Link`.
//
// CO TO DOWODZI. Te dwa zestawy opisują TEN SAM plan dwiema drogami: nagłówek
// startuje pobieranie, zanim parser dojdzie do `<head>` (fundament pod 103 Early
// Hints), a `<link>` obsługuje wszystko, co nagłówka nie dostało. Rozjazd między
// nimi nie daje ŻADNEGO objawu poza cichą stratą wydajności - przeglądarka
// rozgrzewa połączenie, którego nikt nie użyje, albo płaci pełny DNS+TCP+TLS na
// zimno przy pierwszym obrazku. W `__root.tsx` były to dwie listy literałów
// w odległości pięćdziesięciu linii, bez ani jednego testu parytetu.
//
// TO JEST TEST PARYTETU, nie dwa testy dwóch list - dlatego zestawy są
// porównywane ze sobą, a nie każdy z osobna z oczekiwanym tekstem.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. `fontPreloadLinks` /
// `fontPreloadLinkHeaderValues` (100% pokryte, własny plik) i
// `feedDiscoveryLinks` z `meta.ts` - tu sprawdzamy TYLKO, że korzeń je woła
// i z jakim językiem, a nie co same zwracają.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  rootDocumentLinks,
  rootLinkHeaderValues,
  SUPABASE_PRECONNECT_ORIGIN,
  type RootAssets,
} from "../rootHead";

const ASSETS: RootAssets = {
  appCss: "/assets/app-abc123.css",
  fontLatin: "/assets/rhd-latin-1.woff2",
  fontLatinExt: "/assets/rhd-latin-ext-1.woff2",
};

const ORIGIN = "https://neweuropeanstrategies.com";

/** Wszystkie `href` deskryptorów o danym `rel`. */
function hrefs(links: ReadonlyArray<Record<string, string>>, rel: string): string[] {
  return links.filter((l) => l.rel === rel).map((l) => l.href);
}

describe("parytet `<link>` i nagłówka `Link`", () => {
  it("arkusz stylów jest w OBU zestawach", () => {
    // CSS blokuje render; brak w nagłówku to stracone Early Hints, brak
    // w `<head>` to strona bez stylów.
    expect(hrefs(rootDocumentLinks("pl", ORIGIN, ASSETS), "stylesheet")).toEqual([ASSETS.appCss]);
    expect(rootLinkHeaderValues("pl", ASSETS)).toContain(
      `<${ASSETS.appCss}>; rel="preload"; as="style"`,
    );
  });

  it("host obrazów jest rozgrzewany w OBU zestawach", () => {
    const links = rootDocumentLinks("pl", ORIGIN, ASSETS);
    expect(hrefs(links, "preconnect")).toContain(SUPABASE_PRECONNECT_ORIGIN);
    expect(rootLinkHeaderValues("pl", ASSETS)).toContain(
      `<${SUPABASE_PRECONNECT_ORIGIN}>; rel="preconnect"`,
    );
  });

  it("preload fontów jest per-język i ZGODNY między zestawami", () => {
    // Latin-ext to polskie diakrytyki: pobierany dla PL, pomijany dla EN.
    // Gdyby zestawy różniły się językiem, jeden pobierałby font, którego
    // drugi nie zapowiada.
    for (const lang of ["pl", "en"] as const) {
      const zLinkow = hrefs(rootDocumentLinks(lang, ORIGIN, ASSETS), "preload").filter((h) =>
        h.endsWith(".woff2"),
      );
      const zNaglowka = rootLinkHeaderValues(lang, ASSETS)
        .filter((v) => v.includes(".woff2"))
        .map((v) => v.slice(1, v.indexOf(">")));
      expect(zNaglowka).toEqual(zLinkow);
    }
  });

  it("PL pobiera latin-ext, EN nie", () => {
    const pl = rootLinkHeaderValues("pl", ASSETS).join(" ");
    const en = rootLinkHeaderValues("en", ASSETS).join(" ");
    expect(pl).toContain(ASSETS.fontLatinExt);
    expect(en).not.toContain(ASSETS.fontLatinExt);
    // Latin podpiera OBA języki.
    expect(en).toContain(ASSETS.fontLatin);
  });

  it("kolejność w nagłówku: arkusz, potem połączenie, potem fonty", () => {
    // Kolejność jest kontraktem: CSS blokuje render, więc idzie pierwszy.
    const values = rootLinkHeaderValues("pl", ASSETS);
    expect(values[0]).toContain(ASSETS.appCss);
    expect(values[1]).toContain(SUPABASE_PRECONNECT_ORIGIN);
    expect(values.slice(2).every((v) => v.includes(".woff2"))).toBe(true);
  });
});

describe("zestaw `<link>` korzenia", () => {
  it("dwa preconnecty do jednego originu to NIE duplikat", () => {
    // Przeglądarka kluczuje połączenia parą (origin, tryb poświadczeń):
    // `anonymous` rozgrzewa pulę CORS (fetch supabase-js), a `<img>` okładek
    // idzie w trybie no-cors i bez drugiego wpisu płaci handshake na zimno.
    // Ten test istnieje, żeby nikt ich nie „posprzątał" jako duplikatu.
    const links = rootDocumentLinks("pl", ORIGIN, ASSETS);
    const preconnects = links.filter(
      (l) => l.rel === "preconnect" && l.href === SUPABASE_PRECONNECT_ORIGIN,
    );
    expect(preconnects).toHaveLength(2);
    expect(preconnects.filter((l) => l.crossOrigin === "anonymous")).toHaveLength(1);
    expect(preconnects.filter((l) => l.crossOrigin === undefined)).toHaveLength(1);
  });

  it("dns-prefetch poprzedza preconnect do tego samego hosta", () => {
    // Fallback dla przeglądarek ignorujących preconnect - musi wskazywać
    // DOKŁADNIE ten sam host, inaczej rozgrzewa nie to połączenie.
    const links = rootDocumentLinks("pl", ORIGIN, ASSETS);
    expect(hrefs(links, "dns-prefetch")).toEqual([SUPABASE_PRECONNECT_ORIGIN]);
  });

  it("favicon i apple-touch-icon są jawne", () => {
    // Bez jawnej deklaracji podglądy linków i crawlery biorą znak generatora.
    const links = rootDocumentLinks("pl", ORIGIN, ASSETS);
    expect(hrefs(links, "icon")).toEqual(["/favicon.ico"]);
    expect(hrefs(links, "apple-touch-icon")).toEqual(["/favicon.ico"]);
  });

  it("autodiscovery feedów dostaje origin żądania", () => {
    const links = rootDocumentLinks("pl", ORIGIN, ASSETS);
    const alternates = links.filter((l) => l.rel === "alternate");
    expect(alternates.length).toBeGreaterThan(0);
    expect(alternates.every((l) => l.href.startsWith(ORIGIN))).toBe(true);
  });

  it("pusty origin nie produkuje adresów zaczynających się od ukośnika podwójnego", () => {
    // W teście jednostkowym `getOrigin()` zwraca "" (brak zakresu żądania),
    // więc ta gałąź jest realna także w produkcji przy renderze po hydracji.
    const links = rootDocumentLinks("pl", "", ASSETS);
    expect(links.every((l) => !l.href.startsWith("//"))).toBe(true);
  });
});

describe("źródło originu Supabase", () => {
  // DEFEKT ZGŁOSZONY, NIE NAPRAWIONY. Origin, do którego korzeń rozgrzewa
  // połączenie, jest ZASZYTY w kodzie (`SUPABASE_PRECONNECT_ORIGIN`), a klient
  // Supabase w runtime bierze swój URL z `resolveSupabasePublicConfig()`
  // (`VITE_SUPABASE_URL` / `window.__SUPABASE_CONFIG__` / `env.SUPABASE_URL`).
  //
  // KONSEKWENCJA: na instalacji z innym projektem Supabase wszystkie trzy
  // `<link>` i wpis nagłówka `Link` rozgrzewają połączenie do OBCEGO hosta -
  // czyli płacimy DNS+TCP+TLS do serwera, z którym nie rozmawiamy, a handshake
  // do właściwego i tak idzie na zimno. Objawu nie ma żadnego poza wolniejszym
  // LCP i ostrzeżeniem Lighthouse „preconnect found but not used".
  //
  // To dotyczy też `start.ts`, gdzie `connect-src` CSP jest budowane
  // z ROZWIĄZANEGO originu - czyli te dwa miejsca mogą się rozjechać.
  //
  // Naprawa (podanie rozwiązanego originu parametrem) zmienia zachowanie
  // produkcyjne, więc jest decyzją dla człowieka - nie skutkiem ubocznym
  // refaktoru pod testy. Wyprowadzenie do `rootHead.ts` już zredukowało cztery
  // kopie literału do jednej, więc naprawa jest teraz zmianą w jednym miejscu.
  it.fails("origin preconnectu pochodzi z konfiguracji, nie z literału w kodzie", () => {
    const source = readFileSync("src/lib/seo/rootHead.ts", "utf8");
    const hardcoded = /"https:\/\/[a-z0-9]+\.supabase\.co"/.test(source);
    expect({ zaszytyLiteral: hardcoded }).toEqual({ zaszytyLiteral: false });
  });

  it("origin jest zdefiniowany w JEDNYM miejscu", () => {
    // Cztery kopie w `__root.tsx` (linie 221, 224, 235, 270) sprowadzone do
    // jednej stałej: naprawa defektu wyżej jest teraz zmianą w jednym miejscu.
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    expect(root).not.toMatch(/supabase\.co/);
    expect(SUPABASE_PRECONNECT_ORIGIN).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
  });
});
