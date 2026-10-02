// CO DOWODZI TEN PLIK: cache-buster og:image (`?v=<epoch>`) jest jedynym
// mechanizmem, który wymusza na scraperach (Facebook, LinkedIn, X, Slack,
// Signal) pobranie nowego avatara po zmianie profilu - patrz
// `src/routes/author.$slug.tsx` (ogVersionFromIso + withOgVersion) oraz hook
// `api/public/hooks.refresh-og-image`. Trzy klasy błędów są tu kosztowne i
// całkowicie ciche:
//   1. Doklejenie `?v=` do signed URL / URL z policy CDN zerwałoby podpis -
//      og:image zwracałoby 403, czyli podgląd bez obrazka.
//   2. Wersja `0` (brak `updated_at`) doklejona do adresu tworzyłaby nowy
//      wariant URL dla każdego wpisu - scraper cache'owałby śmieci.
//   3. Zgubienie `?v=` przy realnej zmianie profilu zostawia w podglądach
//      social stary avatar na tygodnie, bez żadnego sygnału w panelu.
// Moduł jest czysty (dwie funkcje, zero I/O), więc dowód jest tabelaryczny.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: nie sprawdza, czy trasa faktycznie wstawia
// og:image do <head> ani czy adres jest absolutny - to robi e2e na żywym SSR,
// test `head contract on ${path}` w `e2e/seo.spec.ts` (asercja
// `og:image absolute` na "/", "/en", "/blog", "/qa"). Nie dubluje też budowy
// samej karty OG (`src/lib/seo/ogCard.ts` ma własny plik testowy) - tutaj
// chodzi wyłącznie o wersjonowanie adresu.
import { describe, expect, it } from "vitest";

import { ogVersionFromIso, withOgVersion } from "@/lib/seo/ogImage";

// Znaczniki czasu liczone z Date.UTC, nie z zegara procesu - test nie zależy
// od strefy runnera ani od "teraz".
const EPOCH_2026_02_03 = Date.UTC(2026, 1, 3, 10, 15, 0);
const AVATAR = "https://cdn.example.com/storage/avatars/anna.png";
const CDN_ANNA = "https://cdn.example.com/anna.png";

describe("ogVersionFromIso", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["pusty łańcuch", ""],
  ])("brak daty (%s) daje stabilne 0", (_opis, iso) => {
    expect(ogVersionFromIso(iso)).toBe(0);
  });

  it.each([
    ["ISO w UTC", "2026-02-03T10:15:00Z", EPOCH_2026_02_03],
    ["ISO z milisekundami", "2026-02-03T10:15:00.000Z", EPOCH_2026_02_03],
    // Offset musi być zredukowany do tej samej chwili: 12:15+02:00 == 10:15Z.
    // Inaczej dwa zapisy tego samego momentu dawałyby różne `?v=`.
    ["ISO z offsetem +02:00", "2026-02-03T12:15:00+02:00", EPOCH_2026_02_03],
    ["ISO z offsetem -05:00", "2026-02-03T05:15:00-05:00", EPOCH_2026_02_03],
    ["data bez czasu (traktowana jako UTC)", "2026-02-03", Date.UTC(2026, 1, 3)],
  ])("poprawne %s daje epoch w milisekundach", (_opis, iso, expected) => {
    expect(ogVersionFromIso(iso)).toBe(expected);
  });

  it("nowsza data daje wyższą wersję - to jest cały sens cache-bustera", () => {
    expect(ogVersionFromIso("2026-02-04T10:15:00Z")).toBeGreaterThan(
      ogVersionFromIso("2026-02-03T10:15:00Z"),
    );
  });

  it.each([
    ["napis nie-data", "nie-data"],
    ["miesiąc i dzień poza zakresem", "2026-13-45"],
    ["sam ogon czasu", "T10:15:00Z"],
    ["śmieciowy timestamp", "0000-00-00T00:00:00Z"],
    ["fragment SQL/NULL z bazy", "NULL"],
  ])("nieparsowalne wejście (%s) spada na 0, nie na NaN", (_opis, iso) => {
    const version = ogVersionFromIso(iso);
    expect(version).toBe(0);
    expect(Number.isNaN(version)).toBe(false);
  });
});

describe("withOgVersion", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["pusty łańcuch", ""],
  ])("brak url (%s) daje null, nie łańcuch z samym ?v=", (_opis, url) => {
    expect(withOgVersion(url, EPOCH_2026_02_03)).toBeNull();
  });

  it.each([
    ["wersja 0 (brak updated_at)", 0],
    ["wersja ujemna (data przed epoką)", -1],
    ["duża wartość ujemna", -EPOCH_2026_02_03],
  ])("%s zostawia url bez zmian", (_opis, version) => {
    expect(withOgVersion(AVATAR, version)).toBe(AVATAR);
  });

  it("data:URL nie jest wersjonowany", () => {
    // Doklejenie `?v=` do data:URL zmieniłoby dane obrazka (query staje się
    // częścią payloadu base64) - scraper dostałby uszkodzony plik.
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    expect(withOgVersion(dataUrl, EPOCH_2026_02_03)).toBe(dataUrl);
  });

  it.each([
    [
      "signed URL Supabase Storage",
      "https://xyz.supabase.co/storage/v1/object/sign/avatars/anna.png?token=abc.def",
    ],
    ["URL z policy CDN", "https://cdn.example.com/anna.png?Expires=1&Signature=xyz"],
    ["URL z pustym query", "https://cdn.example.com/anna.png?"],
    // `v=` obok obcego parametru: query nie jest w całości nasze, więc nie
    // wiemy, czy `token` nie podpisuje także `v` - zostaje jak jest.
    ["obce query z v=", "https://cdn.example.com/anna.png?token=abc&v=1"],
    ["obce query przed fragmentem", "https://cdn.example.com/anna.png?token=abc#hero"],
    ["względny z obcym query", "/uploads/anna.png?w=400"],
  ])("%s zostaje nietknięty (obce query już istnieje)", (_opis, url) => {
    expect(withOgVersion(url, EPOCH_2026_02_03)).toBe(url);
  });

  it.each([
    ["absolutny z poprzednią wersją", "https://cdn.example.com/anna.png?v=1", CDN_ANNA],
    ["względny z poprzednią wersją", "/uploads/anna.png?v=1", "/uploads/anna.png"],
    // Zdublowane `v=` (np. ręcznie wklejony adres) zwija się do jednego.
    ["kilka parametrów v=", "https://cdn.example.com/anna.png?v=1&v=2", CDN_ANNA],
    ["puste v=", "https://cdn.example.com/anna.png?v=", CDN_ANNA],
  ])("%s: query złożone tylko z `v=` jest PODMIENIANE, nie dublowane", (_opis, url, czysty) => {
    expect(withOgVersion(url, EPOCH_2026_02_03)).toBe(`${czysty}?v=${EPOCH_2026_02_03}`);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("wersja nieskończona (%s) zostawia url bez zmian, a nie `?v=NaN`", (_opis, version) => {
    expect(withOgVersion(AVATAR, version)).toBe(AVATAR);
  });

  it.each([
    ["absolutny https", AVATAR],
    ["ścieżka względna", "/uploads/anna.png"],
    ["URL bez rozszerzenia", "https://cdn.example.com/avatar"],
  ])("czysty url (%s) dostaje ?v=<version>", (_opis, url) => {
    expect(withOgVersion(url, EPOCH_2026_02_03)).toBe(`${url}?v=${EPOCH_2026_02_03}`);
  });

  it("wersja jest doklejona dosłownie jako liczba epoch", () => {
    expect(withOgVersion(AVATAR, 1)).toBe(`${AVATAR}?v=1`);
    expect(withOgVersion(AVATAR, EPOCH_2026_02_03)).toBe(`${AVATAR}?v=${EPOCH_2026_02_03}`);
  });

  // STRAŻNIK REGRESJI (dawny defekt: kod sprawdzał wyłącznie obecność `?`,
  // więc url z samym fragmentem dostawał `#hero?v=42`). KONSEKWENCJA, której
  // pilnuje: `?v=` za hashem jest częścią fragmentu, a fragment nie jest
  // wysyłany w żądaniu HTTP - zasób pobierał się pod starym adresem, więc
  // cache-buster nie działał wcale, a og:image różniło się od adresu pliku.
  it.each([
    [
      "absolutny",
      "https://cdn.example.com/anna.png#hero",
      "https://cdn.example.com/anna.png?v=42#hero",
    ],
    ["względny", "/uploads/anna.png#hero", "/uploads/anna.png?v=42#hero"],
    [
      "pusty fragment",
      "https://cdn.example.com/anna.png#",
      "https://cdn.example.com/anna.png?v=42#",
    ],
    [
      "poprzednia wersja przed fragmentem",
      "https://cdn.example.com/anna.png?v=1#hero",
      "https://cdn.example.com/anna.png?v=42#hero",
    ],
    // `?` WEWNĄTRZ fragmentu nie jest query - nie może blokować wersji.
    ["znak ? we fragmencie", "/uploads/anna.png#a?b=1", "/uploads/anna.png?v=42#a?b=1"],
  ])("url z fragmentem (%s) dostaje ?v= PRZED hashem", (_opis, url, expected) => {
    expect(withOgVersion(url, 42)).toBe(expected);
  });

  it("złożenie obu funkcji: brak updated_at nie wersjonuje, data wersjonuje", () => {
    expect(withOgVersion(AVATAR, ogVersionFromIso(null))).toBe(AVATAR);
    expect(withOgVersion(AVATAR, ogVersionFromIso("2026-02-03T10:15:00Z"))).toBe(
      `${AVATAR}?v=${EPOCH_2026_02_03}`,
    );
  });
});
