// Rejestr elementów danych RODO kontra NOŚNIKI, które platforma naprawdę zapisuje.
//
// CO TO ZA POWIERZCHNIA I CO TU JEST RYZYKIEM. `src/lib/cookieBanner/registry.ts`
// zasila dwie rzeczy widoczne dla człowieka: tabelę podmiotów w banerze zgód
// (`ConsentBanner`) oraz panel „Wykryte elementy" w `/admin/settings/cookie-banner`.
// To jest deklaracja RODO - lista tego, co serwis zapisuje na urządzeniu
// czytelnika, w jakim celu i na jak długo. Wpis, który się nie dopasuje, nie
// znika: trafia do gałęzi `auto` z opisem ZGADNIĘTYM heurystycznie. Deklaracja
// wygląda więc na kompletną także wtedy, gdy jest nieprawdziwa.
//
// CO TEN PLIK DOWODZI.
//   1. Że DWA nośniki, które moduł zgód ustawia w każdej przeglądarce -
//      `nes_cookie_consent` (mirror decyzji, 365 dni) i `nes_gpc` (sygnał
//      Global Privacy Control) - NIE mają wpisu w rejestrze i są opisywane
//      zgadywanką.
//   2. Że zgadywanka trafia w ZŁĄ KATEGORIĘ: oba wychodzą jako `functional`,
//      czyli kategoria, którą czytelnik może ODMÓWIĆ - podczas gdy zapis dowodu
//      zgody i sygnału GPC jest `necessary` i platforma stawia je tak czy tak.
//      Baner pokazuje więc przełącznik nad czymś, co i tak zostanie zapisane.
//   3. Że opis celu i czas życia też są nieprawdziwe: cookie dostaje etykietę
//      „preferencja interfejsu zapisana LOKALNIE" i TTL „bez limitu", a nie
//      „dowód zgody RODO, 365 dni".
//   4. Że wpis `consent:v2`, który W REJESTRZE JEST, ma `kind: "localStorage"` -
//      więc nawet on nie opisuje cookie'owego mirrora tej samej decyzji.
//
// DLACZEGO ŻADEN INNY TEST TEGO NIE ŁAPIE. Wzorce (`consent*`, `gpc*`) są
// ZAKOTWICZONE (`^...$` w `globToRegExp`), więc `gpc*` łapie `gpc`, ale nie
// `nes_gpc`. Nazwy nośników mieszkają w `src/lib/ads/consent.ts` i
// `src/lib/consent/gpc.ts` jako osobne stałe; nic nie wiąże ich z rejestrem -
// ani typ, ani bramka. `src/lib/cookieBanner/registry.ts` nie miał do dziś
// żadnego testu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Zachowania samego CMP (zapis, klamra GPC,
// synchronizacja z profilem) dowodzą `src/lib/ads/__tests__/consentWritePath.test.ts`,
// `consentProfileSync.test.ts` i `src/lib/consent/__tests__/gpcCmpClamp.test.ts`.
// Tutaj chodzi WYŁĄCZNIE o to, czy deklaracja RODO opisuje to, co naprawdę
// leży w przeglądarce.
import { afterEach, describe, expect, it } from "vitest";

import { COOKIE_CONSENT_CARRIER, GPC_CARRIER, classifyKey } from "./carriers.fixture";
import { detectCollectedElements } from "@/lib/cookieBanner/registry";

/** Sprząta ciasteczka postawione w teście - inaczej przeciekają między nimi. */
function usunCookie(nazwa: string) {
  document.cookie = `${nazwa}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

afterEach(() => {
  usunCookie(COOKIE_CONSENT_CARRIER);
  usunCookie(GPC_CARRIER);
  window.localStorage.clear();
});

describe("rejestr RODO kontra realne nośniki zgody", () => {
  it("wpis `consent:v2` istnieje i dopasowuje klucz localStorage, którego dotyczy", () => {
    // Kontrola pozytywna: bez niej wszystkie asercje poniżej mogłyby
    // „przechodzić" na rejestrze, który nie dopasowuje niczego.
    const wpis = classifyKey("consent:v2");
    expect(wpis?.name).toBe("consent:v2");
    expect(wpis?.category).toBe("necessary");
  });

  it("DEFEKT RODO: cookie `nes_cookie_consent` NIE MA wpisu - wzorce są zakotwiczone", () => {
    // `match: ["consent*", "cookie_consent*", "gpc*"]` po `globToRegExp` daje
    // `^consent.*$` itd. Nazwa realnego nośnika ma prefiks `nes_`, więc żaden
    // wzorzec jej nie łapie. Stan FAKTYCZNY, przypięty liczbą.
    expect(classifyKey(COOKIE_CONSENT_CARRIER)).toBeNull();
  });

  it("DEFEKT RODO: cookie `nes_gpc` też NIE MA wpisu", () => {
    expect(classifyKey(GPC_CARRIER)).toBeNull();
  });

  it("wzorzec `gpc*` łapie gołe `gpc` - czyli nazwę, której nikt nie ustawia", () => {
    // Dowód, że wzorzec nie jest martwy, tylko celuje obok. To rozróżnienie ma
    // znaczenie przy poprawce: nie chodzi o dopisanie wzorca, tylko o to, że
    // rejestr i moduł zgód nie mają wspólnego źródła nazw.
    expect(classifyKey("gpc")?.name).toBe("consent:v2");
    expect(classifyKey("nes_gpc")).toBeNull();
  });

  it("DEFEKT RODO: skan opisuje oba nośniki jako `functional` - kategorię ODMAWIALNĄ", () => {
    document.cookie = `${COOKIE_CONSENT_CARRIER}=%7B%22v%22%3A2%7D; path=/`;
    document.cookie = `${GPC_CARRIER}=1; path=/`;

    const wynik = detectCollectedElements();
    const auto = new Map(wynik.auto.map((e) => [e.name, e]));

    // Oba trafiają do gałęzi ZGADYWANEJ, nie do znanych wpisów.
    expect(auto.has(COOKIE_CONSENT_CARRIER)).toBe(true);
    expect(auto.has(GPC_CARRIER)).toBe(true);

    // I dostają kategorię, którą czytelnik może wyłączyć przełącznikiem -
    // mimo że dowód zgody i sygnał GPC są zapisywane bezwarunkowo.
    expect(auto.get(COOKIE_CONSENT_CARRIER)?.category).toBe("functional");
    expect(auto.get(GPC_CARRIER)?.category).toBe("functional");
    expect(wynik.byCategory.necessary.map((e) => e.name)).not.toContain(COOKIE_CONSENT_CARRIER);
  });

  it.fails(
    "OCZEKIWANE: dowód zgody i sygnał GPC są w kategorii `necessary`, bo platforma stawia je bezwarunkowo",
    () => {
      // Skutek dla czytelnika: w banerze widzi przełącznik „Funkcjonalne" nad
      // pozycją, która zostanie zapisana niezależnie od jego decyzji - i to
      // WŁAŚNIE ta pozycja jest zapisem jego decyzji. Deklaracja RODO obiecuje
      // wybór, którego w tym miejscu nie ma.
      //
      // NIE NAPRAWIAM TEGO W TYM ZLECENIU: poprawka to zmiana produkcyjnego
      // rejestru (nowy wpis albo wspólne źródło nazw z `ads/consent.ts`),
      // czyli zmiana zachowania pod zieloną bramkę - reguła 1 zlecenia tego
      // zabrania. Pozycja idzie do raportu i do eskalacji.
      document.cookie = `${COOKIE_CONSENT_CARRIER}=%7B%22v%22%3A2%7D; path=/`;
      document.cookie = `${GPC_CARRIER}=1; path=/`;
      const nazwy = detectCollectedElements().byCategory.necessary.map((e) => e.name);
      expect(nazwy).toContain(COOKIE_CONSENT_CARRIER);
      expect(nazwy).toContain(GPC_CARRIER);
    },
  );

  it.fails("OCZEKIWANE: opis celu i TTL cookie zgody mówią prawdę, a nie zgadują", () => {
    // STAN FAKTYCZNY: „Wykryta automatycznie preferencja interfejsu zapisana
    // LOKALNIE" (o cookie!) i TTL „Bez limitu" (realnie 365 dni). W tabeli
    // podmiotów baneru czytelnik dostaje więc trzy nieprawdziwe informacje
    // naraz: kategorię, cel i czas przechowywania.
    document.cookie = `${COOKIE_CONSENT_CARRIER}=%7B%22v%22%3A2%7D; path=/`;
    const wpis = detectCollectedElements().auto.find((e) => e.name === COOKIE_CONSENT_CARRIER);
    expect(wpis?.purpose_pl).toContain("zgod");
    expect(wpis?.ttl_pl).toContain("365");
  });

  it("wpis rejestru dla decyzji zgody deklaruje WYŁĄCZNIE localStorage", () => {
    // Czwarty bok tego samego defektu: nawet wpis, który ISTNIEJE, nie wie
    // o cookie'owym mirrorze tej samej decyzji. `consent.ts` pisze w OBA
    // nośniki (`writeLocal` + `writeCookie`), a deklaracja zna jeden.
    expect(classifyKey("consent:v2")?.kind).toBe("localStorage");
  });

  it("kanarek: skan naprawdę widzi ciasteczka, a nie tylko localStorage", () => {
    // Bez tego wszystkie asercje o `auto` mogłyby przechodzić dlatego, że skan
    // nie czyta cookies w ogóle - a wtedy defekt byłby zupełnie inny.
    document.cookie = `${GPC_CARRIER}=1; path=/`;
    const wynik = detectCollectedElements();
    expect(wynik.scannedKeys).toBeGreaterThan(0);
    expect(wynik.auto.map((e) => e.name)).toContain(GPC_CARRIER);
  });
});
