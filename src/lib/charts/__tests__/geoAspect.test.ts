// Bramka: wartość startowa aspektu MUSI zgadzać się z zasobem na dysku.
//
// Tablica `REGION_ASPECT_FALLBACK` istnieje po to, żeby migotka zajęła
// dokładnie tyle miejsca, ile zajmie gotowa mapa. Gdy liczba w kodzie rozjedzie
// się z `viewBox` wygenerowanego pliku, tablica przestaje robić to jedno, do
// czego służy - i nic tego nie zgłasza, bo mapa i tak narysuje się poprawnie,
// tyle że po skoku layoutu. Tak właśnie Azja stała na 0,78 przy zasobie 0,96.
//
// Zasoby czytamy Z DYSKU, a nie z atrapy: rozjazd bierze się z REGENERACJI
// geometrii, więc bramka na zaślepce pilnowałaby samej siebie.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAP_REGIONS, GEO_ASSET_URL, type GeoAsset } from "../types";
import { REGION_ASPECT_FALLBACK, aspectFromViewBox, mapAspect } from "../geoAspect";

const wczytaj = (region: (typeof MAP_REGIONS)[number]): GeoAsset => {
  const url = GEO_ASSET_URL[region];
  return JSON.parse(readFileSync(join(process.cwd(), "public", url), "utf8")) as GeoAsset;
};

describe("geoAspect", () => {
  it.each(MAP_REGIONS)("wartość startowa dla %s zgadza się z viewBox zasobu", (region) => {
    const zZasobu = aspectFromViewBox(wczytaj(region).viewBox);
    expect(zZasobu).not.toBeNull();
    expect(REGION_ASPECT_FALLBACK[region]).toBeCloseTo(zZasobu as number, 10);
  });

  it("każdy region ma wpis, żaden wpis nie jest bez regionu", () => {
    expect(Object.keys(REGION_ASPECT_FALLBACK).sort()).toEqual([...MAP_REGIONS].sort());
  });

  it("zły albo brakujący viewBox daje null, a nie dzielenie przez zero", () => {
    for (const zly of [undefined, "", "0 0 960", "0 0 0 500", "0 0 960 0", "a b c d"]) {
      expect(aspectFromViewBox(zly)).toBeNull();
    }
  });

  it("mapAspect bierze zasób, gdy jest, i wartość startową, gdy go nie ma", () => {
    expect(mapAspect("europe", undefined)).toBe(REGION_ASPECT_FALLBACK.europe);
    expect(mapAspect("europe", { viewBox: "0 0 100 50" })).toBe(0.5);
    // Zcache'owana kopia bez poprawnego viewBox nie może wywrócić wysokości.
    expect(mapAspect("asia", { viewBox: "popsute" })).toBe(REGION_ASPECT_FALLBACK.asia);
  });
});
