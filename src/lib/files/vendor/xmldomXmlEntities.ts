// Zastępca `@xmldom/xmldom/lib/entities.js` WYŁĄCZNIE dla
// `@xmldom/xmldom/lib/dom-parser.js` w bundlu przeglądarki. Przekierowanie robi
// `scripts/lib/officeParserTrim.ts`; tam jest pełne uzasadnienie i bramka
// założeń.
//
// DLACZEGO TO BEZPIECZNE. Parser wybiera tablicę encji z typu MIME:
// `isHTML ? entities.HTML_ENTITIES : entities.XML_ENTITIES`. Jedynym klientem
// xmldom w bundlu przeglądarki jest mammoth (podgląd .docx), a on woła
// `parseFromString(string)` BEZ typu MIME - czyli zawsze ścieżką XML. Tablica
// ~2100 nazwanych encji HTML (~12 KB gzip) była więc w bundlu martwa.
//
// `XML_ENTITIES` jest DOSŁOWNĄ kopią oryginału (test porównuje obie tablice).
// Tablica HTML nie udaje pustej - każdy dostęp do niej rzuca, więc gdyby
// w bundlu pojawił się klient parsujący HTML, zobaczy przyczynę od razu,
// a nie po cichu zgubione `&nbsp;`. Wtyczka dodatkowo przerywa build, gdy xmldom
// ma w grafie innego importera niż mammoth.
//
// i18n: brak treści dla użytkownika - komunikat dla programisty.

/** Pięć encji predefiniowanych w każdym dokumencie XML (XML 1.0 §4.6). */
export const XML_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
});

const htmlEntitiesTrimmed = (): never => {
  throw new Error(
    "xmldom: tablica encji HTML jest wycięta z bundla przeglądarki (parsujemy tylko XML) - " +
      "patrz scripts/lib/officeParserTrim.ts",
  );
};

/** Każda pułapka rzuca: tablica HTML nie istnieje w tym bundlu. */
export const HTML_ENTITIES: Readonly<Record<string, string>> = new Proxy(Object.freeze({}), {
  get: htmlEntitiesTrimmed,
  has: htmlEntitiesTrimmed,
  ownKeys: htmlEntitiesTrimmed,
  getOwnPropertyDescriptor: htmlEntitiesTrimmed,
});

/** Alias z oryginału (`exports.entityMap = exports.HTML_ENTITIES`). */
export const entityMap = HTML_ENTITIES;
