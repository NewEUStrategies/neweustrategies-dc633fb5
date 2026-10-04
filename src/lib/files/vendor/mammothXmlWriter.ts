// Zastępca `xmlbuilder` WYŁĄCZNIE dla `mammoth/lib/xml/writer.js` w bundlu
// przeglądarki. Przekierowanie robi `scripts/lib/officeParserTrim.ts`; tam jest
// pełne uzasadnienie i bramka, która pilnuje założeń przy aktualizacji pakietu.
//
// DLACZEGO TO BEZPIECZNE. W mammoth `xmlbuilder` służy jednej rzeczy: ZAPISOWI
// XML (`xml.writeString`), którego używa tylko `embedStyleMap` - wpisanie mapy
// stylów z powrotem DO pliku .docx. Podgląd dokumentu woła wyłącznie
// `convertToHtml` (`src/lib/files/officeParse.ts`), który plik tylko CZYTA.
// Biblioteka zapisu (~9 KB gzip) jechała więc do każdej przeglądarki, która
// otworzyła podgląd .docx, i nie wykonywała się nigdy.
//
// GDYBY KTOŚ JEDNAK SIĘGNĄŁ PO ZAPIS, dostaje głośny błąd z nazwą przyczyny,
// a nie cichy, częściowy plik.
//
// i18n: brak treści dla użytkownika - komunikat dla programisty.

/** Jedyne API `xmlbuilder`, którego dotyka `mammoth/lib/xml/writer.js`. */
export function create(): never {
  throw new Error(
    "mammoth: zapis XML (embedStyleMap) jest wycięty z bundla przeglądarki - " +
      "patrz scripts/lib/officeParserTrim.ts",
  );
}
