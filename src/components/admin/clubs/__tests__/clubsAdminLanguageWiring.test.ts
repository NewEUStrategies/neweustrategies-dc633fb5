// Jak modul admina klubow obchodzi sie z jezykiem - bramka na WZORZEC, nie na
// tlumaczenia.
//
// Ten modul nie mial dlugu slownikowego: z 26 wyrazen `isPl ? … : …` ani jedno
// nie bylo etykieta interfejsu (te od dawna ida przez `t()` i `i18n-club`).
// Wszystkie byly jednym z trzech: wyborem TRESCI z blizniaczych kolumn,
// kodem jezyka dla formatowania daty, albo decyzja o tym, do KTOREJ KOLUMNY
// zapisac wartosc. Konwersja polegala wiec na czyms innym niz w panelu
// spolecznosci i ta bramka pilnuje czegos innego:
//
//   1. `isPl` nie wraca jako PROPS. Dwie trasy przekazywaly go w dol do szesciu
//      zakladek, a te dalej do wlasnych podkomponentow - nowe miejsce montowania
//      mogло po prostu zapomniec podac jezyk, a typ `boolean` niczego nie
//      podpowiadal. Kazdy komponent wyprowadza jezyk sam.
//   2. Tresc z blizniaczych kolumn idzie przez `pickLocalized`, nie przez
//      `isPl ? x_pl : x_en`. Recznie napisany warunek uznawal ciag z samych
//      spacji za obecny, wiec pusta w praktyce nazwa grupy renderowala biala
//      plame zamiast siegnac po drugi jezyk.
//   3. Kod jezyka dla dat NIE jest tlumaczony w komponencie na "pl"/"en":
//      `formatDate*` z `lib/i18n/format` normalizuje wejscie samo (`uiLocale`),
//      wiec przekazujemy surowe `i18n.language`. Jedno miejsce mniej, w ktorym
//      ta decyzja moze sie rozjechac.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ORGANISMS = "src/components/admin/clubs/organisms";
const ROUTES = [
  "src/routes/admin.community.clubs.index.tsx",
  "src/routes/admin.community.clubs.$clubId.tsx",
] as const;

/** Komponent-molekula wspoldzielona z powierzchnia publiczna - tez odpieta. */
const SHARED = ["src/components/clubs/molecules/ClubAnchorPicker.tsx"] as const;

const FILES = [
  ...readdirSync(ORGANISMS)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => join(ORGANISMS, name)),
  ...ROUTES,
  ...SHARED,
].map((path) => ({ path, src: readFileSync(path, "utf8") }));

/** Kod bez komentarzy - komentarze WOLNO opisywac stary wzorzec. */
function code(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

describe("modul admina klubow - obsluga jezyka", () => {
  it("nie przekazuje jezyka propsem `isPl`", () => {
    const offenders = FILES.filter(({ src }) => /isPl/.test(code(src))).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("nie wybiera tresci recznym warunkiem na blizniaczych kolumnach", () => {
    // Wzorzec `? x.foo_pl : x.foo_en` w dowolnej kolejnosci jezykow.
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      for (const m of code(src).matchAll(/\?\s*[\w.]+_(?:pl|en)\s*:\s*[\w.]+_(?:pl|en)/g)) {
        offenders.push(`${path}: ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('nie tlumaczy jezyka na "pl"/"en" w wywolaniu formatera daty', () => {
    // Celowo WASKO: `formatDate*` normalizuje wejscie samo, wiec ternarium
    // w jego argumencie jest zbedna kopia decyzji. Sama derywacja `UiLang`
    // (dla `pickLocalized` albo mapy `Record<UiLang, …>`) jest poprawna
    // i idzie przez `uiLang` z `lib/i18n/format`.
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      for (const m of code(src).matchAll(/formatDate\w*\([^)]*\?\s*"(?:pl|en)"/g)) {
        offenders.push(`${path}: ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("wyprowadza jezyk interfejsu helperem, nie kopia warunku w komponencie", () => {
    // Po konwersji sam napisalem te sama linie w osmiu plikach - bramka to
    // wylapala, wiec zostaje jako straznik na przyszlosc.
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      if (/\(i18n\.language \?\? "pl"\)\.startsWith\(/.test(code(src))) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it("nie wpisuje twardych znacznikow BCP-47 - te sa w `lib/i18n/format`", () => {
    const offenders = FILES.filter(
      ({ src }) => code(src).includes('"pl-PL"') || code(src).includes('"en-GB"'),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("nazwa startowa nowego dzialu nie zalezy od jezyka panelu", () => {
    // DEFEKT DANYCH, nie etykieta: przy angielskim interfejsie do kolumny
    // POLSKIEJ wpisywalo sie "New section", wiec polski odwiedzajacy widzial
    // angielska nazwe dzialu - i zostawala w bazie na stale.
    const src = readFileSync(join(ORGANISMS, "ClubGroupsTab.tsx"), "utf8");
    expect(src).toContain('name_pl: "Nowy dział"');
    expect(src).toContain('name_en: "New section"');
    expect(code(src)).not.toMatch(/name_pl:\s*\w+\s*\?/);
  });
});
