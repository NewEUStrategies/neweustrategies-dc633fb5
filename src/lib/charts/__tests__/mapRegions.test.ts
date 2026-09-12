// REGIONY MAPY: JEDNA LISTA, CZTERY POWIERZCHNIE POZA ZASIĘGIEM TYPU.
//
// PO CO TEN PLIK ISTNIEJE - dokładnie z tego samego powodu, co bliźniaczy
// `chartKinds.test.ts` obok. Lista regionów żyje w sześciu miejscach:
//
//   1. `MAP_REGIONS` w `src/lib/charts/types.ts` - ŹRÓDŁO, z niego wyprowadzony
//      jest typ `MapRegion`;
//   2. `GEO_ASSET_URL` (tamże) - adres zasobu geometrii per region;
//   3. `REGION_ASPECT_FALLBACK` w `geoAspect.ts` - aspekt migotki przed
//      wczytaniem zasobu;
//   4. edytor bloku CMS - `DataMapBlock` w `DataVizBlocks.tsx`;
//   5. schemat widgetu buildera - `data-map` i `feature-corridor-map`
//      w `schemas.ts`;
//   6. słownik PL i EN - `blocks.editors.dataMap.*` w `i18n-admin-blocks.ts`.
//
// Punkty 2 i 3 są typowane `Record<MapRegion, ...>`, więc pilnuje ich
// KOMPILATOR - i tak ma zostać; bramka sprawdza je tylko na własności, których
// typ nie wyraża (adres nie może być pusty ani wspólny dla dwóch regionów).
// Punkty 4-6 są zwykłymi danymi i napisami: dopisanie regionu do źródła nie
// wywoła w nich ani jednego błędu kompilacji.
//
// CO SIĘ PSUŁO. Przed rozszerzeniem listy do siedmiu regionów każda z tych
// powierzchni czytała region przez `x === "world" ? "world" : "europe"`.
// To porównanie NIE JEST równoważne walidacji: degraduje do Europy każdy
// region, którego akurat nie wymieniono - więc region dodany do typu,
// edytora i słownika i tak rysowałby Europę, cicho i bez błędu kompilacji.
// Dlatego bramka sprawdza obecność W OBIE STRONY: każdy region ze źródła jest
// w każdej powierzchni, i żadna powierzchnia nie oferuje regionu, którego typ
// nie zna.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GEO_ASSET_URL, MAP_REGIONS, isMapRegion, mapRegionLabelKey } from "@/lib/charts/types";
import { REGION_ASPECT_FALLBACK, aspectFromViewBox, mapAspect } from "@/lib/charts/geoAspect";
import { parseDataMapConfig, parseMapRegion } from "@/lib/charts/parse";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";

const dataViz = readFileSync("src/components/admin/blocks/edit/DataVizBlocks.tsx", "utf8");
const slownik = readFileSync("src/lib/i18n-admin-blocks.ts", "utf8");

/** Widgety buildera, których pole `region` mówi o TEJ liście regionów. */
const WIDGETS_Z_REGIONEM = ["data-map", "feature-corridor-map"] as const;

/**
 * Grupa `dataMap` z jednej połowy słownika. Wycinamy grupę, a nie szukamy
 * klucza w całym pliku: `asia:` albo `oceania:` trafiłoby kiedyś na klucz
 * z zupełnie innej grupy i bramka orzekłaby obecność tłumaczenia, którego nie
 * ma w liście wyboru regionu.
 */
function grupaDataMap(polowa: string): string {
  const start = polowa.indexOf("dataMap: {");
  expect(start, "w słowniku nie ma grupy dataMap").toBeGreaterThan(-1);
  const koniec = polowa.indexOf("\n      },", start);
  expect(koniec, "grupa dataMap nie ma domknięcia").toBeGreaterThan(start);
  return polowa.slice(start, koniec);
}

/** Blok PL kończy się tam, gdzie zaczyna się `const en: typeof pl = {`. */
function polowy(): { pl: string; en: string } {
  const granica = slownik.search(/^const en\b/m);
  expect(granica).toBeGreaterThan(0);
  return { pl: slownik.slice(0, granica), en: slownik.slice(granica) };
}

describe("regiony mapy - jedno źródło", () => {
  it("typ jest WYPROWADZONY z tablicy, nie zsynchronizowany z nią ręcznie", () => {
    for (const region of MAP_REGIONS) expect(isMapRegion(region)).toBe(true);
    for (const obcy of ["", "europe ", "EUROPE", "eu", "antarctica", "mars", "auto"]) {
      expect(isMapRegion(obcy), `"${obcy}" nie jest regionem`).toBe(false);
    }
  });

  it("identyfikatory są w kebab-case - to one jadą do treści bloku", () => {
    // Zapis identyfikatora jest częścią kontraktu z bazą: raz zapisany
    // `north-america` siedzi w treści wpisów i nie wolno go przemianować bez
    // migracji. camelCase zostaje po stronie słownika (patrz niżej).
    for (const region of MAP_REGIONS) {
      expect(region, `region ${region} nie jest w kebab-case`).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it("klucz słownikowy regionu to camelCase identyfikatora", () => {
    expect(mapRegionLabelKey("north-america")).toBe("northAmerica");
    expect(mapRegionLabelKey("europe")).toBe("europe");
  });
});

describe("regiony mapy - zasób geometrii i aspekt", () => {
  it("każdy region ma SWÓJ adres zasobu, i żaden nie jest wspólny", () => {
    // Kompletność tablicy pilnuje `Record<MapRegion, string>`; tu sprawdzamy
    // to, czego typ nie wyraża. Wspólny adres dla dwóch regionów rysowałby
    // Europę na mapie Azji - dokładnie tak, jak wspólny klucz cache'u.
    const adresy = MAP_REGIONS.map((r) => GEO_ASSET_URL[r]);
    for (const [i, region] of MAP_REGIONS.entries()) {
      expect(adresy[i], `region ${region} nie ma adresu zasobu`).toMatch(
        /^\/geo\/[a-z0-9-]+\.v\d+\.json$/,
      );
    }
    expect(new Set(adresy).size, "dwa regiony wskazują ten sam plik").toBe(MAP_REGIONS.length);
  });

  it("nazwa pliku niesie region - inaczej diagnostyka 404 nic nie mówi", () => {
    for (const region of MAP_REGIONS) {
      expect(GEO_ASSET_URL[region], `adres regionu ${region} go nie nazywa`).toContain(region);
    }
  });

  it("każdy region ma aspekt startowy w sensownym zakresie", () => {
    // Ta wartość rysuje wyłącznie migotkę (wysokość pudełka, zanim zasób
    // dojedzie), więc wolno jej być przybliżeniem - ale nie wolno jej być
    // zerem ani liczbą z innego świata: pudełko o wysokości 30 px albo
    // 5000 px to skok layoutu, przed którym ta tablica ma bronić.
    for (const region of MAP_REGIONS) {
      const aspekt = REGION_ASPECT_FALLBACK[region];
      expect(aspekt, `region ${region} bez aspektu startowego`).toBeGreaterThan(0.3);
      expect(aspekt, `nieprawdopodobny aspekt regionu ${region}`).toBeLessThan(2);
    }
  });

  it("Ameryka Południowa jest PORTRETOWA - layout musi to znieść", () => {
    // Jedyny region wyższy niż szerszy. Stoi w bramce, bo każda mapa w tym
    // silniku była dotąd pozioma i „szerokość razy aspekt" czytało się jako
    // liczbę mniejszą od szerokości.
    expect(REGION_ASPECT_FALLBACK["south-america"]).toBeGreaterThan(1);
  });

  it("aspekt liczy się z viewBoxu ZASOBU, a nie ze stałej", () => {
    expect(aspectFromViewBox("0 0 960 480")).toBe(0.5);
    expect(mapAspect("europe", { viewBox: "0 0 960 480" })).toBe(0.5);
  });

  it("brak zasobu albo kaleki viewBox oddaje aspekt startowy regionu", () => {
    // Zasób bywa zcache'owaną kopią z innej wersji generatora; nieczytelny
    // `viewBox` nie może wyjść jako NaN w wysokości pudełka.
    expect(mapAspect("world", undefined)).toBe(REGION_ASPECT_FALLBACK.world);
    for (const kaleki of ["", "0 0 960", "0 0 960 0", "0 0 a b", "   "]) {
      expect(aspectFromViewBox(kaleki), `"${kaleki}" nie jest aspektem`).toBeNull();
      expect(mapAspect("asia", { viewBox: kaleki })).toBe(REGION_ASPECT_FALLBACK.asia);
    }
  });
});

describe("regiony mapy - obecność w KAŻDEJ powierzchni autorskiej", () => {
  it("edytor bloku CMS wyprowadza listę ze ŹRÓDŁA, a nie z ręcznych <option>", () => {
    // Tu nie da się - i nie trzeba - sprawdzać obecności regionu po regionie:
    // lista opcji POWSTAJE z `MAP_REGIONS`, więc dowodem jest brak drugiej
    // listy, a nie zgodność dwóch. Wcześniej stały tu dwa wpisane ręcznie
    // `<option value="europe">`, przez co region dodany do źródła był z
    // edytora nieosiągalny.
    const blok = dataViz.slice(dataViz.indexOf("export function DataMapBlock"));
    expect(blok, "edytor mapy nie wyprowadza regionów z MAP_REGIONS").toContain("MAP_REGIONS.map");
    expect(blok, "edytor mapy liczy klucz słownika sam, zamiast wołać mapRegionLabelKey").toContain(
      "mapRegionLabelKey",
    );
    for (const region of MAP_REGIONS) {
      expect(blok, `edytor mapy wpisuje region ${region} z ręki`).not.toContain(
        `<option value="${region}"`,
      );
    }
  });

  it("schematy widgetów buildera znają każdy region", () => {
    for (const typ of WIDGETS_Z_REGIONEM) {
      const schemat = WIDGET_SCHEMAS[typ];
      expect(schemat, `brak schematu widgetu ${typ}`).toBeTruthy();
      const pole = (schemat ?? []).find((f) => f.key === "region");
      expect(pole, `schemat ${typ} musi mieć pole region`).toBeTruthy();
      const wartosci = (pole?.options ?? []).map((o) => o.value);
      for (const region of MAP_REGIONS) {
        expect(wartosci, `schemat ${typ} nie zna regionu ${region}`).toContain(region);
      }
      // I w drugą stronę: opcja, której typ nie zna, degraduje się po zapisie
      // do Europy - autor wybiera Antarktydę, dostaje Europę i nie wie czemu.
      for (const w of wartosci) {
        expect(isMapRegion(w), `schemat ${typ} oferuje nieznany region ${w}`).toBe(true);
      }
      // Etykieta jest źródłem angielskiego napisu (`BUILDER_LABELS_EN`), więc
      // opcja bez etykiety to region bez nazwy w obu językach naraz.
      for (const opcja of pole?.options ?? []) {
        expect(opcja.label, `opcja regionu "${opcja.value}" nie ma etykiety`).toBeTruthy();
      }
    }
  });

  it("słownik ma nazwę regionu w OBU językach", () => {
    const { pl, en } = polowy();
    const grupaPl = grupaDataMap(pl);
    const grupaEn = grupaDataMap(en);
    for (const region of MAP_REGIONS) {
      const klucz = `${mapRegionLabelKey(region)}:`;
      expect(grupaPl, `brak polskiej nazwy regionu ${region}`).toContain(klucz);
      expect(grupaEn, `brak angielskiej nazwy regionu ${region}`).toContain(klucz);
    }
  });
});

describe("parsowanie regionu z treści", () => {
  it("nieznany region DEGRADUJE do Europy, a nie rzuca", () => {
    // Treść bloku pochodzi z bazy i bywa z przyszłej albo cofniętej wersji
    // edytora. Mapa jest blokiem treści redakcyjnej: jej rzut to HTTP 500 na
    // całym wpisie, a nie „mapa się nie narysowała".
    for (const obcy of ["antarctica", "mars", "", "EUROPE", "world "]) {
      expect(() => parseDataMapConfig({ region: obcy })).not.toThrow();
      expect(parseDataMapConfig({ region: obcy }).region, `region "${obcy}"`).toBe("europe");
    }
    expect(parseDataMapConfig({}).region).toBe("europe");
  });

  it("każdy ZNANY region przechodzi przez parser bez zmiany", () => {
    for (const region of MAP_REGIONS) {
      expect(parseDataMapConfig({ region }).region).toBe(region);
      expect(parseMapRegion(region)).toBe(region);
    }
  });

  it("region spoza napisów też nie wywraca parsera", () => {
    // `region` w treści to `Json`, więc bywa liczbą, obiektem albo `null` -
    // np. po ręcznej edycji dokumentu albo imporcie z innego systemu.
    expect(parseDataMapConfig({ region: null }).region).toBe("europe");
    expect(parseDataMapConfig({ region: 7 }).region).toBe("europe");
    expect(parseDataMapConfig({ region: { pl: "Azja" } }).region).toBe("europe");
  });
});
