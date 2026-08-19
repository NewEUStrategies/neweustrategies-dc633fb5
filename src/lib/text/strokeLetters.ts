// Litery, których Unicode NIE rozkłada na „podstawa + znak diakrytyczny".
//
// DLACZEGO TEN PLIK ISTNIEJE. Każdy generator sluga w repo robi ten sam ruch:
// `normalize("NFD"/"NFKD")` plus usunięcie znaków łączących. To radzi sobie
// z ą/ć/ę/ń/ó/ś/ź/ż, bo są ZŁOŻENIAMI (litera + znak). „ł" (U+0142) złożeniem
// NIE jest — to osobna litera z przekreśleniem — więc normalizacja zostawia ją
// bez zmian, a następny krok (`[^a-z0-9]+`) zamienia ją na dywiz albo usuwa
// z brzegu.
//
// Skutek dla polskiego produktu jest dotkliwy, bo dotyczy ADRESÓW, które są
// trwałe (linkowane i indeksowane): „Łódź" dawało `odz`, „Miłość" → `mio-c`,
// „Paweł" → `pawe`.
//
// Defekt został naprawiony najpierw w propozycji adresu profilu (commit
// 592a99a), którego opis wprost wymienił pozostałe powierzchnie jako dług:
// `taxonomySlug`, `content.functions`, `invitations.functions`. Mapa mieszka
// więc TUTAJ, a nie w kolejnej kopii — trzecia kopia rozjechałaby się przy
// pierwszej zmianie, a rozjazd oznaczałby, że ten sam tytuł daje różne adresy
// zależnie od tego, który ekran go wygenerował.
//
// Zakres: litery ze znakiem i ligatury spotykane w nazwach i nazwiskach z UE —
// katalog treści i osób jest ogólnoeuropejski.
export const STROKE_LETTERS: Readonly<Record<string, string>> = {
  ł: "l",
  đ: "d",
  ð: "d",
  ø: "o",
  æ: "ae",
  œ: "oe",
  ß: "ss",
  þ: "th",
  ħ: "h",
  ŀ: "l",
  ı: "i",
};

/**
 * Zamienia litery z przekreśleniem i ligatury na odpowiedniki ASCII.
 *
 * Wołać PRZED normalizacją Unicode i PRZED zamianą reszty na dywizy — po niej
 * litera jest już dywizem i nie ma czego transliterować. Wejście musi być
 * zmniejszone (`toLowerCase()`), bo mapa jest zapisana małymi literami.
 */
export function replaceStrokeLetters(lowercased: string): string {
  return lowercased.replace(/[^a-z0-9]/g, (char) => STROKE_LETTERS[char] ?? char);
}
