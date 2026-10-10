// STAN SIATKI MAPY - poprawki po przeglądzie W6.
//
//   * Nazwy krajów: każda nazwa z KAŻDEGO zasobu `public/geo` daje swój kod
//     bez skorowidza (przed wczytaniem zasobu i w regionie, który kraju nie
//     ma) - „Czech Republic" na mapie Azji to CZ „poza regionem", a nie
//     nieznany kod. Cypr Północny (XN) i Somaliland (XS) są znanymi kodami.
//   * Uwagi: kraj spoza regionu bez wartości NIE jest „kreskowany jako brak
//     danych" - nie ma go na rysunku.
//   * Wartość, której czytnik nie odczyta („PL; 12%"), nie jest luką: siatka
//     trzyma ją jako `raw`, zapis innego wiersza oddaje ją bez zmian, a pola
//     za wartością („PL; 5; uwaga") też przeżywają zapis.
//   * Wklejenie do textarei widgetu dokłada kraje zamiast zastąpić pole.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { parseMapData } from "@/lib/charts/csv";
import { parseMapValues } from "@/lib/charts/parse";
import type { GeoAsset } from "@/lib/charts/types";
import { ASSET_ONLY_COUNTRY_NAMES } from "../mapCountryNames";
import {
  blockMapValues,
  countryNameOf,
  mapCountryLookup,
  mapGridIsBlank,
  mapRowsSignature,
  mapRowStatuses,
  mapSetCell,
  mergeWidgetMapText,
  readBlockMapRows,
  readWidgetMapRows,
  resolveCountryEntry,
  widgetMapText,
} from "../mapGridState";

const GEO = "public/geo";
const ZASOBY = readdirSync(GEO)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ plik: f, asset: JSON.parse(readFileSync(`${GEO}/${f}`, "utf8")) as GeoAsset }));
const zasob = (prefix: string) => {
  const z = ZASOBY.find((x) => x.plik.startsWith(prefix));
  if (z === undefined) throw new Error(`brak zasobu ${prefix}`);
  return z.asset.countries;
};
const EUROPA = mapCountryLookup(zasob("europe-"));
const AZJA = mapCountryLookup(zasob("asia-"));

describe("nazwa kraju z dowolnego zasobu daje kod - także bez skorowidza", () => {
  const wszystkie = ZASOBY.flatMap(({ plik, asset }) =>
    asset.countries.flatMap((c) => [
      [plik, c.pl, c.id],
      [plik, c.en, c.id],
    ]),
  );

  it("bramka: każda nazwa każdego zasobu -> jej kod (bez skorowidza)", () => {
    const zle = wszystkie.filter(([, nazwa, id]) => resolveCountryEntry(nazwa) !== id);
    expect(zle).toEqual([]);
  });

  it("tabela nazw zasobów niesie wyłącznie nazwy, które zasób naprawdę ma", () => {
    const znane = new Set(wszystkie.map(([, nazwa, id]) => `${nazwa}|${id}`));
    const obce = ASSET_ONLY_COUNTRY_NAMES.filter(([nazwa, id]) => !znane.has(`${nazwa}|${id}`));
    expect(obce).toEqual([]);
  });

  it("„Czech Republic” przed wczytaniem zasobu i na mapie Azji -> CZ", () => {
    expect(resolveCountryEntry("Czech Republic")).toBe("CZ");
    expect(resolveCountryEntry("Czech Republic", AZJA.index)).toBe("CZ");
    expect(resolveCountryEntry("Russian Federation", mapCountryLookup(undefined).index)).toBe("RU");
    expect(mapRowStatuses([{ id: "CZ", value: 1 }], AZJA.ids)).toEqual([{ kind: "outside" }]);
  });

  it("skorowidz zastępczy (zasób jeszcze się wczytuje) zna nazwy zasobów", () => {
    const swiat = mapCountryLookup(undefined).index;
    expect(swiat.byName.get("czech republic")).toBe("CZ");
    expect(swiat.ids.has("XN")).toBe(true);
  });

  it("Cypr Północny i Somaliland to znane kody z nazwą także bez zasobu", () => {
    expect(mapRowStatuses([{ id: "XN", value: 1 }], null)).toEqual([{ kind: "ok" }]);
    expect(mapRowStatuses([{ id: "XS", value: 1 }], EUROPA.ids)).toEqual([{ kind: "outside" }]);
    expect(countryNameOf("XN", "pl", new Map())).toBe("Cypr Północny");
    expect(countryNameOf("XS", "en", new Map())).toBe("Somaliland");
  });
});

describe("uwaga kraju spoza regionu", () => {
  it("bez wartości: ani rysunek, ani nota - nie „kreskowany jako brak danych”", () => {
    expect(
      mapRowStatuses(
        [
          { id: "JP", value: null },
          { id: "JP", value: 4 },
          { id: "DE", value: null },
        ],
        EUROPA.ids,
      ),
    ).toEqual([{ kind: "duplicate", row: 2 }, { kind: "outside" }, { kind: "noValue" }]);
    expect(mapRowStatuses([{ id: "JP", value: null }], EUROPA.ids)).toEqual([
      { kind: "outsideNoValue" },
    ]);
  });
});

describe("wartość, której czytnik nie odczyta, nie jest luką", () => {
  it("widget: „PL; 12%” zostaje napisem, a zapis innego wiersza go oddaje", () => {
    const text = "PL; 12%\nDE; 30\nFR; 1.234,5; szacunek";
    const rows = readWidgetMapRows(text);
    expect(rows).toEqual([
      { id: "PL", value: null, raw: "12%" },
      { id: "DE", value: 30 },
      { id: "FR", value: null, raw: "1.234,5", rest: "szacunek" },
    ]);
    // Mapa dalej czyta tylko to, co czytała.
    expect(parseMapData(text)).toEqual([{ id: "DE", value: 30 }]);
    const poEdycji = mapSetCell(rows, 1, { value: 31 });
    expect(widgetMapText(poEdycji)).toBe("PL; 12%\nDE; 31\nFR; 1.234,5; szacunek");
    expect(mapRowStatuses(poEdycji, EUROPA.ids).map((s) => s.kind)).toEqual([
      "invalidValue",
      "ok",
      "invalidValue",
    ]);
  });

  it("pola za wartością przeżywają zapis, także przy wierszu bez wartości", () => {
    const text = "PL; 5; uwaga; druga\nDE;; tylko uwaga";
    expect(widgetMapText(readWidgetMapRows(text))).toBe(text);
  });

  it("zapis wartości zdejmuje napis - także wyczyszczenie do luki", () => {
    const rows = readWidgetMapRows("PL; abc");
    const poprawione = mapSetCell(rows, 0, { value: 7 });
    expect(poprawione[0]).toEqual({ id: "PL", value: 7 });
    const wyczyszczone = mapSetCell(rows, 0, { value: null });
    expect(wyczyszczone).not.toBe(rows);
    expect(wyczyszczone[0]).toEqual({ id: "PL", value: null });
    expect(widgetMapText(wyczyszczone)).toBe("PL;");
    // Zmiana KODU nie rusza napisu wartości.
    expect(mapSetCell(rows, 0, { id: "DE" })[0]).toEqual({ id: "DE", value: null, raw: "abc" });
  });

  it("blok: napis w data.values zostaje w zapisie, rysunek go pomija jak dotąd", () => {
    const values = [
      { id: "PL", value: "12%" },
      { id: "DE", value: 30 },
    ];
    const rows = readBlockMapRows(values);
    expect(rows[0]).toEqual({ id: "PL", value: null, raw: "12%" });
    const poEdycji = mapSetCell(rows, 1, { value: 31 });
    expect(blockMapValues(poEdycji)).toEqual([
      { id: "PL", value: "12%" },
      { id: "DE", value: 31 },
    ]);
    expect(parseMapValues(blockMapValues(poEdycji))).toEqual([{ id: "DE", value: 31 }]);
  });

  it("napis liczy się jako treść: siatka nie jest pusta, a podpis go widzi", () => {
    expect(mapGridIsBlank([{ id: "", value: null, raw: "x" }])).toBe(false);
    expect(mapRowsSignature([{ id: "PL", value: null, raw: "x" }])).not.toBe(
      mapRowsSignature([{ id: "PL", value: null }]),
    );
  });
});

describe("wklejenie do textarei widgetu dokłada kraje", () => {
  const pole = "PL; 38\nDE; 84\nFR; 68";

  it("jeden wiersz z arkusza dopisuje kraj, reszta zostaje", () => {
    expect(mergeWidgetMapText(pole, [{ id: "IT", value: 59 }])).toBe(
      "PL; 38\nDE; 84\nFR; 68\nIT; 59",
    );
  });

  it("kraj, który pole ma, dostaje nową wartość w swoim pierwszym wierszu", () => {
    expect(
      mergeWidgetMapText("PL; 38; uwaga\nDE; 84\nPL; 1", [
        { id: "PL", value: 40 },
        { id: "ES", value: 5 },
      ]),
    ).toBe("PL; 40; uwaga\nDE; 84\nPL; 1\nES; 5");
  });

  it("inne linie zostają co do znaku, puste linie na końcu nie rozdzielają", () => {
    expect(mergeWidgetMapText("pl;  12%\nDE;\n\n", [{ id: "CZ", value: 1 }])).toBe(
      "pl;  12%\nDE;\nCZ; 1",
    );
  });
});
