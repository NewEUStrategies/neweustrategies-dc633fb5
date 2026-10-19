// KOTWICA WPISANA PRZEZ AUTORA - od dialogu paska do `id` w HTML i `href` spisu.
//
// Paski bloków kanwy (`HeadingWidgetToolbar`, `GenericWidgetToolbar`) pytają
// autora o „Kotwicę (ID)" i zapisują ją do `block.data.anchor`. Silnik kotwic
// (`resolveBlockAnchors` / `blockAnchor`) bierze kotwicę JAWNĄ dosłownie -
// nie slugifikuje jej drugi raz, bo jest ona kontraktem autora. Cała
// poprawność stoi więc na `normalizeAuthorAnchor` po stronie paska.
//
// CO MA TU DOWÓD
//   * `normalizeAuthorAnchor`: pusta odpowiedź to świadome zdjęcie kotwicy
//     (pusty napis, bez fallbacku `section`), każda inna przechodzi przez
//     kanoniczny slug - transliteracja `ł`, tylko `[a-z0-9-]`, limit 80 - i jest
//     IDEMPOTENTNA (ponowne zatwierdzenie dialogu nie zmienia kotwicy),
//   * kotwica autora wychodzi z silnika bez zmiany i spis treści linkuje
//     dokładnie ją,
//   * kotwica autora równa slugowi innego nagłówka nie daje DWÓCH takich
//     samych `id` w dokumencie - drugi dostaje sufiks,
//   * nagłówek zagnieżdżony (poza płaską listą dokumentu) też honoruje kotwicę
//     autora, bez aliasów wstecznych,
//   * nagłówek z treścią nie-napisem (import) nie dostaje kotwicy i nie
//     zajmuje sluga kolejnym nagłówkom.
//
// Moduły są czyste - bez atrap.
import { describe, expect, it } from "vitest";

import { blockAnchor, resolveBlockAnchors } from "../anchors";
import type { Block } from "../types";
import { ANCHOR_MAX_LENGTH, normalizeAuthorAnchor, slugifyAnchor } from "@/lib/content/anchorSlug";
import { extractHeadingsFromBlockList } from "@/lib/toc/settings";

function naglowek(id: string, text: unknown, extra: Record<string, unknown> = {}): Block {
  return { id, type: "heading", data: { level: 2, text, ...extra } } as Block;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("normalizeAuthorAnchor - wpis z dialogu kotwicy", () => {
  it.each(["", "   ", "\t\n"])("pusta odpowiedź %j zdejmuje kotwicę (pusty napis)", (wpis) => {
    expect(normalizeAuthorAnchor(wpis)).toBe("");
  });

  it.each([
    ["Sekcja Łączna", "sekcja-laczna"],
    ["  Nowa   Sekcja  ", "nowa-sekcja"],
    ['#Rozdział 2/3? "v1.0"', "rozdzial-2-3-v1-0"],
    ["Straße & Øresund", "strasse-oresund"],
  ])("%j daje kanoniczny slug %j", (wpis, slug) => {
    expect(normalizeAuthorAnchor(wpis)).toBe(slug);
    expect(normalizeAuthorAnchor(wpis)).toBe(slugifyAnchor(wpis));
  });

  it("wpis bez ani jednego znaku slugowalnego dostaje fallback silnika, a nie pusty id", () => {
    // Autor COŚ wpisał - to nie jest zdjęcie kotwicy, więc obowiązuje ta sama
    // reguła co dla nagłówka bez treści slugowalnej.
    expect(normalizeAuthorAnchor("### !!!")).toBe("section");
  });

  it("długi wpis jest przycięty do limitu silnika i nie kończy się myślnikiem", () => {
    const wynik = normalizeAuthorAnchor("Bardzo długi rozdział ".repeat(10));
    expect(wynik.length).toBeLessThanOrEqual(ANCHOR_MAX_LENGTH);
    expect(wynik).toMatch(SLUG_RE);
  });

  it.each(["Sekcja Łączna", "#Rozdział 2/3?", "Bardzo długi rozdział ".repeat(10)])(
    "jest idempotentna - ponowne zatwierdzenie %j nie zmienia kotwicy",
    (wpis) => {
      const raz = normalizeAuthorAnchor(wpis);
      expect(normalizeAuthorAnchor(raz)).toBe(raz);
    },
  );
});

describe("kotwica autora w silniku kotwic i spisie treści", () => {
  it("wychodzi z silnika bez zmiany, a spis treści linkuje dokładnie ją", () => {
    const anchor = normalizeAuthorAnchor("Sekcja Łączna");
    const bloki = [naglowek("h1", "Traktat", { anchor }), naglowek("h2", "Wnioski")];
    expect(resolveBlockAnchors(bloki).get("h1")).toEqual({ id: "sekcja-laczna", legacyIds: [] });
    expect(extractHeadingsFromBlockList(bloki).map((h) => h.anchor)).toEqual([
      "sekcja-laczna",
      "wnioski",
    ]);
  });

  it("kotwica autora równa slugowi innego nagłówka nie daje dwóch takich samych id", () => {
    const bloki = [
      naglowek("h1", "Wstęp", { anchor: normalizeAuthorAnchor("Wnioski") }),
      naglowek("h2", "Wnioski"),
    ];
    const mapa = resolveBlockAnchors(bloki);
    expect(mapa.get("h1")?.id).toBe("wnioski");
    expect(mapa.get("h2")?.id).toBe("wnioski-2");
  });

  it("nagłówek zagnieżdżony honoruje kotwicę autora, bez aliasów wstecznych", () => {
    // Nagłówek w kolumnie/grupie nie jest w płaskiej liście dokumentu, więc
    // `blockAnchor` liczy go lokalnie - kotwica autora nadal wygrywa z treścią.
    const zagniezdzony = naglowek("n1", "Wyzwania małych firm", { anchor: "moj-rozdzial" });
    expect(blockAnchor(zagniezdzony, [])).toEqual({ id: "moj-rozdzial", legacyIds: [] });
  });

  it("nagłówek z treścią nie-napisem nie dostaje kotwicy i nie zajmuje sluga", () => {
    // Import potrafi wnieść `text` jako liczbę. Taki nagłówek nie ma czego
    // linkować, więc nie może też „zjeść" sluga następnemu nagłówkowi.
    const bloki = [naglowek("h1", 2026), naglowek("h2", "2026")];
    const mapa = resolveBlockAnchors(bloki);
    expect(mapa.has("h1")).toBe(false);
    expect(mapa.get("h2")?.id).toBe("2026");
    expect(blockAnchor(naglowek("n1", { html: "x" }), [])).toEqual({ id: "", legacyIds: [] });
  });
});
