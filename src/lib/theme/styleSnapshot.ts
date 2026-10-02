// Migawka bloku `<style>` wyrenderowanego przez serwer - podstawa odroczenia
// generatorów CSS korzenia (`useDeferredStyleCss`).
//
// PO CO. Pięć komponentów `<style>` montowanych w `__root.tsx` (tokeny marki,
// kolory globalne, opcje motywu, Theme Design, rozmiary czcionek) budowało
// przy hydratacji DOKŁADNIE ten sam napis CSS, który serwer już wysłał w HTML-u.
// Generatory są ciężkie (`globalColors.ts` 44 kB, `themeDesign.ts` 22 kB,
// `fontSizes.ts` 7,5 kB źródeł) i siedziały statycznie w chunku wejściowym -
// każdy czytelnik pobierał je i wykonywał przed pierwszą interakcją (audyt PSI
// 2026-10-02: 1,9 MB JS bootu, TBT 343 ms).
//
// MECHANIKA. Serwer dopisuje do `<style>` atrybut `data-css-hash` ze skrótem
// DANYCH WEJŚCIOWYCH generatora. Klient przy hydratacji czyta z DOM-u treść
// bloku i ten skrót (`readStyleSnapshot`) i renderuje je 1:1 - bez generatora.
// Dopiero gdy skrót bieżących danych różni się od migawki (zapytanie wróciło
// po terminie SSR, podgląd na żywo w panelu, zapis ustawień), komponent
// dociąga generator przez `import()` i przelicza CSS.
//
// DLACZEGO SKRÓT DANYCH, A NIE PORÓWNANIE CSS. Porównanie wymagałoby
// generatora po stronie klienta - czyli dokładnie tego, czego unikamy.
// Skrót liczymy z `JSON.stringify` danych zapytań: te same dane przechodzą
// przez dehydratację react-query, więc po obu stronach mają identyczną
// strukturę i kolejność kluczy.
//
// `textContent` elementu `<style>` jest równy napisowi z `dangerouslySetInnerHTML`:
// to element „raw text" - parser HTML nie dekoduje w nim encji, a jedyny
// znacznik zdolny go zamknąć (`</style`) neutralizuje `hardenStyleCss` przed
// renderem po obu stronach.

/** Atrybut `<style>` niosący skrót danych wejściowych generatora. */
export const STYLE_HASH_ATTR = "data-css-hash";

export interface StyleSnapshot {
  /** Utwardzony CSS bloku. */
  css: string;
  /** Skrót danych, z których CSS powstał (`hashStyleInput`). */
  hash: string;
}

/**
 * Deterministyczny 53-bitowy skrót (cyrb53) serializacji JSON danych.
 * Nie kryptograficzny - rozróżnia kolejne stany ustawień, nie broni niczego.
 * `undefined` (brak wiersza) serializuje się do pustego napisu, więc brak
 * danych i `null` mają różne skróty - tak jak różnią się dla generatora.
 */
export function hashStyleInput(input: unknown): string {
  const text = JSON.stringify(input) ?? "";
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  // Druga połowa ma stałą szerokość (7 znaków base36 mieści 2^32), więc
  // sklejenie jest jednoznaczne.
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36).padStart(7, "0");
}

/**
 * Odczyt migawki z dokumentu: pierwszy `<style>` z danym znacznikiem
 * (np. `data-theme-design`). `null`, gdy nie ma DOM-u (serwer) albo bloku
 * (render bez SSR - wtedy komponent emituje pusty blok i dociąga generator).
 */
export function readStyleSnapshot(marker: string): StyleSnapshot | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLStyleElement>(`style[${marker}]`);
  if (!el) return null;
  return { css: el.textContent ?? "", hash: el.getAttribute(STYLE_HASH_ATTR) ?? "" };
}
