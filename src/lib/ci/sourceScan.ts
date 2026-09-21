// MASKOWANIE KOMENTARZY PRZED SKANOWANIEM ŹRÓDŁA - jedno miejsce dla bramek,
// które czytają kod jako tekst.
//
// DLACZEGO TO POWSTAŁO. Dwie bramki tego samego PR-a czytały źródło
// NIEZGODNIE. `chartAdviceAudience.test.ts` pomijał komentarze (bo komentarze
// w tym repozytorium cytują treść słownika, a pojedynczy cudzysłów prosty
// w cytacie wprowadzał parser w stan „jestem w napisie" i gubił domknięcie
// całego bloku). `chartDictionaryKeys.test.ts` skanował tekst surowym
// wyrażeniem regularnym - więc komentarz CYTUJĄCY wzorzec sklejanego klucza
// wywracał bramkę na jej własnej dokumentacji. Objaw jest podstępny, bo
// „naprawa" polega wtedy na przeredagowaniu komentarza, czyli na usunięciu
// zdania, które wyjaśniało, czego bramka pilnuje.
//
// KONTRAKT: długość napisu i pozycje wszystkich znaków POZA komentarzami
// zostają nietknięte, a same komentarze zamieniają się w spacje z zachowanymi
// znakami nowej linii. Dzięki temu numer linii i przesunięcie trafienia
// liczone na wyniku pasują do pliku na dysku, więc komunikat bramki nadal
// wskazuje miejsce, które człowiek otworzy w edytorze.

/**
 * Znaki, po których ukośnik zaczyna WYRAŻENIE REGULARNE, a nie dzielenie.
 *
 * Bez tej heurystyki wyrażenie zawierające `//` albo `/*` (na przykład
 * `/\/\//`) wyglądałoby jak początek komentarza i wymazałoby resztę pliku -
 * czyli bramka przestałaby cokolwiek widzieć i zrobiłaby się CICHO zielona.
 * To najgroźniejszy tryb awarii bramki, groźniejszy od fałszywego alarmu.
 */
const PRZED_WYRAZENIEM = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
  "\n",
]);

/** Słowa kluczowe, po których ukośnik też zaczyna wyrażenie regularne. */
const SLOWA_PRZED_WYRAZENIEM = ["return", "typeof", "case", "in", "of", "new", "delete", "void"];

/** Czy ukośnik na pozycji `i` zaczyna wyrażenie regularne, a nie dzielenie. */
function zaczynaWyrazenie(src: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && (src[j] === " " || src[j] === "\t")) j -= 1;
  if (j < 0) return true;
  const poprzedni = src[j];
  if (PRZED_WYRAZENIEM.has(poprzedni)) return true;
  // Słowo kluczowe bezpośrednio przed ukośnikiem: `return /x/.test(s)`.
  if (/[a-z]/.test(poprzedni)) {
    const koniec = j + 1;
    let start = koniec;
    while (start > 0 && /[a-zA-Z]/.test(src[start - 1])) start -= 1;
    return SLOWA_PRZED_WYRAZENIEM.includes(src.slice(start, koniec));
  }
  return false;
}

/**
 * To samo źródło z komentarzami zamienionymi na spacje (nowe linie zachowane).
 *
 * Napisy, napisy szablonowe i wyrażenia regularne zostają NIETKNIĘTE, bo
 * `"// nie komentarz"` jest treścią, a nie komentarzem - bramka szukająca
 * w źródle napisu musi go nadal znaleźć.
 *
 * OGRANICZENIE, świadome i zapięte testem: wstawki `${...}` w napisie
 * szablonowym są traktowane jako część napisu, więc komentarz WEWNĄTRZ
 * wstawki nie zostanie zamaskowany. W tym repozytorium nie ma takiego
 * zapisu, a pełne parsowanie zagnieżdżeń kosztowałoby więcej, niż daje.
 */
export function bezKomentarzy(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    // Napis zwykły albo szablonowy - przepisywany znak w znak.
    if (c === '"' || c === "'" || c === "`") {
      out.push(c);
      i += 1;
      while (i < src.length) {
        if (src[i] === "\\") {
          out.push(src[i], src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out.push(src[i]);
        if (src[i] === c) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") {
        out.push(" ");
        i += 1;
      }
      continue;
    }

    if (c === "/" && src[i + 1] === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        // Nowa linia zachowana, żeby numeracja linii się nie przesunęła.
        out.push(src[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      out.push(" ", " ");
      i += 2;
      continue;
    }

    if (c === "/" && zaczynaWyrazenie(src, i)) {
      out.push(c);
      i += 1;
      let wKlasie = false;
      while (i < src.length) {
        if (src[i] === "\\") {
          out.push(src[i], src[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (src[i] === "[") wKlasie = true;
        else if (src[i] === "]") wKlasie = false;
        // Niedomknięte wyrażenie do końca linii znaczy, że heurystyka się
        // pomyliła i to było dzielenie - wtedy przerywamy na nowej linii,
        // zamiast pożreć resztę pliku.
        else if (src[i] === "\n") break;
        out.push(src[i]);
        if (src[i] === "/" && !wKlasie) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    out.push(c);
    i += 1;
  }
  return out.join("");
}
