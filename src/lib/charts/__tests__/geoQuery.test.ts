// Fabryka `queryOptions` dla statycznej geometrii map - 0/4 linii, 0/1 funkcji.
//
// PO CO TESTOWAĆ CZTERY LINIE. Bo ten plik jest JEDNYM PUNKTEM PRAWDY dla dwóch
// odległych powierzchni: publicznej mapy (`ChoroplethMap`) i edytora bloku w
// panelu. Trzy własności, których złamania nie widać na ekranie:
//
//   1. KLUCZ JEST WSPÓLNY I BEZ NAJEMCY. `["public", "geo", region]` nie ma
//      identyfikatora najemcy ani języka - i to jest POPRAWNE, bo zasób to
//      wersjonowany plik statyczny (`/geo/europe-50m.v1.json`), identyczny dla
//      każdego obszaru roboczego. Dorzucenie do klucza czegokolwiek zmiennego
//      zwielokrotniłoby pobrania TEGO SAMEGO pliku (setki kilobajtów geometrii)
//      raz na najemcę i raz na język. Klucz musi też RÓŻNICOWAĆ regiony -
//      wspólny klucz dla `europe` i `world` pokazałby Europę na mapie świata.
//   2. `staleTime: Infinity` JEST WNIOSKIEM Z WERSJI W NAZWIE PLIKU, nie
//      optymizmem. Nowa geometria dostaje nową nazwę (`.v2.json`), więc
//      zcache'owana kopia nie ma jak się zestarzeć. Skrócenie tego czasu
//      dokłada odpytania warunkowe bez żadnej możliwej zmiany treści.
//   3. BŁĄD MUSI BYĆ DIAGNOSTYCZNY. `res.ok === false` to najczęściej literówka
//      w nazwie zasobu albo brak pliku po wdrożeniu. Komunikat bez REGIONU i
//      KODU HTTP zamienia to w „mapa się nie ładuje" bez tropu.
//
// GRANICE. `fetch` jest atrapą - test jednostkowy nie dotyka sieci ani dysku.
// PRAWDZIWA jest tablica adresów `GEO_ASSET_URL`, bo to ona wiąże region z
// plikiem; atrapa w tym miejscu dowodziłaby wyłącznie własnej treści.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import { GEO_ASSET_URL, type GeoAsset, type MapRegion } from "@/lib/charts/types";

const REGIONS: MapRegion[] = ["europe", "world"];

function asset(): GeoAsset {
  return {
    v: 1,
    license: "ODbL 1.0",
    viewBox: "0 0 1000 800",
    countries: [{ id: "PL", pl: "Polska", en: "Poland", d: "M0 0 L1 1 Z" }],
  };
}

/** Atrapa `fetch` zapisująca adresy - żadnego wyjścia w sieć. */
function stubFetch(response: { ok: boolean; status: number; body?: unknown }) {
  const urls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return {
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", impl);
  return { urls, impl };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe("klucz cache'u", () => {
  it("stoi w przestrzeni publicznej i NIE nosi najemcy ani języka", () => {
    for (const region of REGIONS) {
      const key = geoAssetQueryOptions(region).queryKey;
      expect(key).toEqual(["public", "geo", region]);
      expect(key).toHaveLength(3);
    }
  });

  it("RÓŻNICUJE regiony - wspólny klucz dałby Europę na mapie świata", () => {
    const europe = geoAssetQueryOptions("europe").queryKey;
    const world = geoAssetQueryOptions("world").queryKey;
    expect(europe).not.toEqual(world);
  });

  it("jest stabilny między wywołaniami - inaczej każdy render pobiera geometrię od nowa", () => {
    expect(geoAssetQueryOptions("europe").queryKey).toEqual(
      geoAssetQueryOptions("europe").queryKey,
    );
  });
});

// ---------------------------------------------------------------------------
describe("czasy życia", () => {
  it("`staleTime` jest nieskończony - wersja siedzi w nazwie pliku", () => {
    for (const region of REGIONS) {
      expect(geoAssetQueryOptions(region).staleTime).toBe(Infinity);
    }
  });

  it("`gcTime` to dokładnie 24 h, a ponowienie jest JEDNO", () => {
    const options = geoAssetQueryOptions("world");
    expect(options.gcTime).toBe(24 * 60 * 60 * 1000);
    // Więcej ponowień na brakującym pliku to tylko dłuższe czekanie na tę samą
    // odpowiedź 404 - zasób statyczny albo jest, albo go nie ma.
    expect(options.retry).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("pobranie zasobu", () => {
  it("każdy region idzie POD SWÓJ adres z `GEO_ASSET_URL`", async () => {
    for (const region of REGIONS) {
      const { urls } = stubFetch({ ok: true, status: 200, body: asset() });
      await geoAssetQueryOptions(region).queryFn();
      expect(urls).toEqual([GEO_ASSET_URL[region]]);
      vi.unstubAllGlobals();
    }
  });

  it("adresy obu regionów są RÓŻNE - jeden plik dla obu byłby błędem danych", () => {
    expect(GEO_ASSET_URL.europe).not.toBe(GEO_ASSET_URL.world);
  });

  it("poprawna odpowiedź oddaje sparsowany zasób, a nie samą `Response`", async () => {
    stubFetch({ ok: true, status: 200, body: asset() });

    const result = await geoAssetQueryOptions("europe").queryFn();
    expect(result.v).toBe(1);
    expect(result.countries[0].id).toBe("PL");
  });

  it("zasób BEZ metadanych projekcji jest poprawny - starsze kopie ich nie mają", async () => {
    // `proj` jest opcjonalne w kontrakcie; fabryka nie ma prawa go wymagać,
    // bo zcache'owana kopia sprzed generatora projekcji nadal jest ważna.
    stubFetch({ ok: true, status: 200, body: asset() });

    const result = await geoAssetQueryOptions("world").queryFn();
    expect(result.proj).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("błąd pobrania jest diagnostyczny", () => {
  it("404 rzuca komunikatem zawierającym REGION i KOD - bez nich nie ma tropu", async () => {
    stubFetch({ ok: false, status: 404 });

    await expect(geoAssetQueryOptions("europe").queryFn()).rejects.toThrow(/geo asset europe.*404/);
  });

  it("5xx po stronie CDN też rzuca, a nie oddaje pustego zasobu", async () => {
    stubFetch({ ok: false, status: 503 });

    await expect(geoAssetQueryOptions("world").queryFn()).rejects.toThrow(/world.*503/);
  });

  it("na błędzie NIE dochodzi do parsowania treści", async () => {
    const parse = vi.fn(async () => asset());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: parse }) as unknown as Response),
    );

    await expect(geoAssetQueryOptions("europe").queryFn()).rejects.toThrow(/500/);
    expect(parse).not.toHaveBeenCalled();
  });
});
