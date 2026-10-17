// Zastępca `mammoth/lib/xml/xmldom.js` WYŁĄCZNIE dla `mammoth/lib/xml/reader.js`
// w bundlu przeglądarki: natywny `DOMParser` zamiast `@xmldom/xmldom`.
// Przekierowanie robi `scripts/lib/officeParserTrim.ts`; tam jest pełne
// uzasadnienie i bramka, która pilnuje założeń przy aktualizacji pakietu.
//
// DLACZEGO. xmldom (~64 kB źródła, ~9 KB gzip w chunku podglądu .docx) to
// parser XML w JavaScripcie - a przeglądarka ma własny, w silniku. Podgląd
// .pptx w `officeParse.ts` od początku parsuje natywnym `DOMParser`.
//
// KONTRAKT `reader.js`: `parseFromString(napis)` oddaje dokument albo RZUCA
// (u mammoth: przy każdym zgłoszeniu `errorHandler` xmldom), a `Node` niesie
// stałe `ELEMENT_NODE`/`TEXT_NODE`. Czytnik idzie potem po `documentElement`,
// `childNodes`, `attributes`, `namespaceURI`, `localName`, `nodeValue`
// i `value` - natywny DOM daje dla poprawnego XML te same wartości co xmldom
// (przestrzenie nazw, atrybuty `xmlns`, CDATA jako osobny węzeł, normalizacja
// białych znaków w wartościach atrybutów); dowód: HTML z wszystkich plików
// .docx z testów mammoth identyczny z nietkniętą biblioteką
// (`officeParserTrimBuild.test.ts`).
//
// KOŃCE LINII JAK W XMLDOM. xmldom przed parsowaniem zamienia `\r\n`,
// `\r\u0085`, samotne `\r`, `\u0085` i `\u2028` na `\n` (reguła XML 1.1);
// parser XML 1.0 przeglądarki zostawia `\u0085` i `\u2028` w tekście. Ta sama
// zamiana robiona tu przed `DOMParser` daje znak w znak ten sam tekst.
//
// BŁĄD PARSOWANIA. Natywny parser nie rzuca: Chrome i Safari wstawiają do
// dokumentu `<parsererror>` w przestrzeni XHTML, Firefox oddaje dokument
// z korzeniem `<parsererror>` we własnej przestrzeni. Oba przypadki zamieniamy
// na wyjątek, jak mammoth. RÓŻNICA ŚWIADOMA: natywny parser odrzuca XML
// niepoprawny składniowo, który xmldom przepuszczał (np. surowe `&`, znaki
// sterujące, niezadeklarowany prefiks, białe znaki przed deklaracją `<?xml`,
// niedomknięte znaczniki w złej kolejności, tekst za korzeniem). Takiego pliku
// nie otworzy też Word; podgląd pokaże wtedy stan „nie udało się odczytać"
// zamiast częściowej treści. Treść komunikatu błędu jest inna niż w xmldom -
// interfejs go nie pokazuje (`DocumentViewerBody`: `parseFailed`). Lista
// przypadków w obie strony jest przypięta w `officeParserTrim.test.ts`.
//
// DTD ODRZUCAMY, ZANIM PARSER JĄ ZOBACZY. xmldom ignorował podzbiór
// wewnętrzny i padał na każdej encji spoza pięciu predefiniowanych;
// przeglądarka encje wewnętrzne ROZWIJA (także zagnieżdżone - „billion
// laughs" na karcie czytelnika, przed którym chronią ją tylko limity silnika).
// OPC (ECMA-376 cz. 2) zabrania deklaracji DTD w częściach pakietu, więc
// `<!DOCTYPE` w prologu (jedyne miejsce, gdzie wolno go postawić) to błąd
// jeszcze przed parsowaniem; `doctype` po parsowaniu to drugi bezpiecznik.
// Na encjach własnych oba parsery dają więc ten sam wynik: błąd.
//
// i18n: brak treści dla użytkownika - komunikat dla programisty.

/** Stałe typów węzłów, po które sięga `reader.js` (`xmldom.Node`). */
export const Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 } as const;

/** Przestrzenie elementu `<parsererror>`: Blink/WebKit (XHTML) i Gecko. */
const PARSER_ERROR_NAMESPACES = [
  "http://www.w3.org/1999/xhtml",
  "http://www.mozilla.org/newlayout/xml/parsererror.xml",
];

/** `normalizeLineEndings` z `@xmldom/xmldom/lib/dom-parser.js`. */
export function normalizeLineEndings(input: string): string {
  return input.replace(/\r[\n\u0085]/g, "\n").replace(/[\r\u0085\u2028]/g, "\n");
}

/**
 * Prolog (BOM, deklaracja, instrukcje, komentarze, białe znaki) zakończony
 * `<!DOCTYPE`. Ciało instrukcji kończy się na PIERWSZYM `?>`, komentarza - na
 * pierwszym `-->`, a białe znaki idą po jednym: każdy prolog da się podzielić
 * tylko na jeden sposób, więc wyrażenie nie wraca wykładniczo na tysiącu
 * instrukcji bez DTD (test mierzy czas).
 */
const DOCTYPE_IN_PROLOG =
  /^\uFEFF?(?:\s|<\?(?:[^?]|\?(?!>))*\?>|<!--(?:[^-]|-(?!->))*-->)*<!DOCTYPE/;

export function parseFromString(source: string): Document {
  if (DOCTYPE_IN_PROLOG.test(source)) {
    throw new Error("fatalError: deklaracja DTD w części pakietu OOXML");
  }
  const doc = new DOMParser().parseFromString(normalizeLineEndings(source), "text/xml");
  for (const namespace of PARSER_ERROR_NAMESPACES) {
    const error = doc.getElementsByTagNameNS(namespace, "parsererror")[0];
    if (error !== undefined) {
      throw new Error(`fatalError: ${(error.textContent ?? "").trim()}`);
    }
  }
  if (doc.doctype !== null) {
    throw new Error("fatalError: deklaracja DTD w części pakietu OOXML");
  }
  return doc;
}
