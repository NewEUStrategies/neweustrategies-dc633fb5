// JEDNO źródło prawdy dla kotwic nagłówków (`<h2 id="...">` + `href="#..."`).
//
// PRZYCZYNA ŹRÓDŁOWA (dlaczego ten moduł istnieje):
// Kotwice generowały PIĘĆ niezależnych implementacji o CZTERECH zachowaniach:
//
//   1. lib/manualToc.ts                   - transliteracja ł→l, limit 80, fallback
//   2. lib/toc/settings.ts                - bez transliteracji, bez limitu, bez fallbacku
//   3. components/blocks/renderer/data.ts  - jak (2)
//   4. components/share/FloatingShareBar   - bez transliteracji, limit 64, fallback
//   5. builder TocWidget                   - bez transliteracji, limit 80 cięty
//      PO zdjęciu myślnika z krawędzi (mogła zostać "…-"), fallback
//
// Wszystkie opierały się na `NFKD` + zdjęciu znaków łączących. To działa dla
// liter ROZKŁADALNYCH (ą → a + ogonek, ś → s + akut), ale NIE dla liter
// ATOMOWYCH: `ł` (U+0142) nie ma rozkładu kanonicznego, więc przechodzi do
// reguły "nie-alfanumeryczne → myślnik" i gubi się w środku wyrazu. Ten sam
// nagłówek dostawał zatem inny identyfikator w każdym silniku:
//
//   "Wyzwania małych firm" → silnik richtext: wyzwania-malych-firm
//                          → silnik bloków:   wyzwania-ma-ych-firm
//
// Skutek: przy migracji treści bloki↔richtext kotwice przestawały być stabilne -
// linki głębokie (spis treści, udostępnione URL-e z `#`, linkowanie wewnętrzne)
// trafiały w pustkę. Kanoniczna postać to (1): transliteracja + limit 80 +
// fallback, bo to jedyne zachowanie, które nigdy nie gubi litery. Historyczne
// warianty pozostają odtwarzalne przez `legacyAnchorVariants`, żeby już
// opublikowane linki `#` dalej działały (patrz renderHeading w silniku bloków).
//
// Moduł jest czysty (bez DOM, bez i18n, bez zależności) - działa identycznie na
// serwerze (workerd) i w przeglądarce, więc SSR i hydratacja nie mogą się
// rozjechać.

/**
 * Litery, których `NFKD` NIE rozkłada na "litera bazowa + znak łączący", więc
 * zdjęcie znaków łączących nie zredukuje ich do ASCII. Bez jawnej mapy każda z
 * nich degraduje do myślnika i psuje slug w środku wyrazu.
 *
 * Zakres jest celowo REDAKCYJNY, nie wyczerpujący Unicode: polski (`ł`, dla
 * którego zgłoszono błąd), nordycki, germański, romański, chorwacki/serbski,
 * turecki, islandzki, maltański, lapoński. Rozszerzenia fonetyczne IPA
 * (U+0180-U+024F) pozostają nieobsłużone - w treści redakcyjnej PL/EN nie
 * występują, a ich degradacja do myślnika jest zachowaniem dotychczasowym
 * (brak regresji).
 *
 * Klucze podane MAŁYMI literami - normalizacja wielkości liter dzieje się przed
 * transliteracją, więc `Ł` i `ł` trafiają w ten sam wpis.
 */
const ATOMIC_LETTERS: Readonly<Record<string, string>> = {
  ł: "l", // ł - polski
  ŀ: "l", // ŀ - kataloński (l·l)
  ø: "o", // ø - duński / norweski
  ǿ: "o", // ǿ
  đ: "d", // đ - chorwacki / serbski / wietnamski
  ð: "d", // ð - islandzki (eth)
  þ: "th", // þ - islandzki (thorn)
  ß: "ss", // ß - niemiecki
  æ: "ae", // æ - duński / norweski / islandzki
  ǣ: "ae", // ǣ
  ǽ: "ae", // ǽ
  œ: "oe", // œ - francuski
  ħ: "h", // ħ - maltański
  ı: "i", // ı - turecki (i bez kropki)
  ŋ: "n", // ŋ - lapoński
  ŧ: "t", // ŧ - lapoński
  ĸ: "k", // ĸ - grenlandzki
  ƶ: "z", // ƶ
  ǥ: "g", // ǥ
};

const ATOMIC_LETTERS_RE = new RegExp(`[${Object.keys(ATOMIC_LETTERS).join("")}]`, "gu");

/**
 * Ten sam zbiór liter, ale w OBU wielkościach - dla konsumentów, którzy (inaczej
 * niż slug) muszą zachować wielkość liter, np. nazwa pobieranego pliku.
 * `ß`.toUpperCase() daje dwuznak „SS", więc do klasy znaków wchodzą wyłącznie
 * jednoznakowe warianty.
 */
const ATOMIC_LETTERS_ANY_CASE_RE = new RegExp(
  `[${[
    ...new Set([
      ...Object.keys(ATOMIC_LETTERS),
      ...Object.keys(ATOMIC_LETTERS)
        .map((c) => c.toUpperCase())
        .filter((c) => c.length === 1),
    ]),
  ].join("")}]`,
  "gu",
);

/**
 * Transliteracja LITER ATOMOWYCH z zachowaniem wielkości.
 *
 *   transliterateAtomicLetters("Łódź")  → "Lódź"   (dalsze diakrytyki zdejmuje NFKD)
 *   transliterateAtomicLetters("Straße") → "Strasse"
 *
 * Wyprowadzone z `slugifyAnchor`, bo `normalize("NFKD")` NIE rozkłada tych liter
 * (nie mają rozkładu kanonicznego), więc każdy konsument, który po NFKD wycina
 * znaki poza ASCII, GUBI je bezgłośnie. Ten moduł jest JEDNYM miejscem, w którym
 * ta mapa żyje - dokładnie po to, żeby nie powstała druga i nie rozjechała się
 * z pierwszą.
 */
export function transliterateAtomicLetters(input: string): string {
  return input.replace(ATOMIC_LETTERS_ANY_CASE_RE, (char) => {
    const mapped = ATOMIC_LETTERS[char.toLowerCase()];
    if (mapped === undefined) return char;
    // Wejście małą literą zostaje małe; wielką - podnosimy pierwszy znak, żeby
    // „Þ" dało „Th", a nie „TH".
    return char === char.toLowerCase() ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
  });
}

/**
 * Znaki łączące, które `NFKD` odkleja od litery bazowej. Historyczne
 * implementacje używały surowego zakresu `̀-ͯ`; `\p{Mn}` obejmuje ten
 * zakres i rozszerzenia (Latin Extended Additional, wietnamski), a przy okazji
 * nie jest zgłaszane przez `no-misleading-character-class`.
 */
const COMBINING_MARKS_RE = /\p{Mn}/gu;

/**
 * Litery modyfikujące, które `NFKD` produkuje obok litery bazowej
 * (np. `ẚ` → `a` + `ʾ`). Bez tego modyfikator wyciekłby do sluga jako myślnik.
 */
const MODIFIER_LETTERS_RE = /\p{Lm}/gu;

const NON_SLUG_RE = /[^a-z0-9]+/g;
const EDGE_DASHES_RE = /^-+|-+$/g;

/** Maksymalna długość kotwicy. Wspólna dla WSZYSTKICH silników. */
export const ANCHOR_MAX_LENGTH = 80;

/** Kotwica dla nagłówka, z którego nie zostało nic slugowalnego. */
export const ANCHOR_FALLBACK = "section";

/**
 * Historyczny limit `FloatingShareBar`. Używany WYŁĄCZNIE do odtwarzania
 * aliasów legacy - nowe kotwice zawsze używają `ANCHOR_MAX_LENGTH`.
 */
const LEGACY_SHARE_BAR_MAX_LENGTH = 64;

/**
 * Historyczny rdzeń slugujący (silniki 2-4): bez transliteracji liter atomowych
 * i bez zdejmowania liter modyfikujących. Zachowany BAJT W BAJT, bo od niego
 * zależy poprawność aliasów wstecznych.
 */
function legacyAsciiSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS_RE, "")
    .replace(NON_SLUG_RE, "-")
    .replace(EDGE_DASHES_RE, "");
}

/**
 * Transliteracja liter atomowych (`ł` → `l`, `ø` → `o`, `ß` → `ss`, ...) -
 * WSPÓŁDZIELONY prymityw slugujący. Wejście musi być już małymi literami
 * (klucze mapy są małe), więc funkcja robi `toLowerCase()` sama.
 *
 * Wydzielone, bo slug tokenu marki (`lib/builder/designTokens.ts`) miał własny
 * rdzeń bez transliteracji i psuł nazwy z polskimi literami dokładnie tak, jak
 * kotwice przed unifikacją. Jedna mapa liter, jedno miejsce do rozszerzania.
 */
export function transliterateAtomicLetters(input: string): string {
  return input.toLowerCase().replace(ATOMIC_LETTERS_RE, (c) => ATOMIC_LETTERS[c] ?? c);
}

/**
 * Kanoniczna kotwica nagłówka. Deterministyczna, ASCII-only, stabilna między
 * silnikami (bloki / richtext / builder) i między serwerem a przeglądarką.
 *
 *   slugifyAnchor("Wyzwania małych firm")  → "wyzwania-malych-firm"
 *   slugifyAnchor("Gęślą jaźń")            → "gesla-jazn"
 *   slugifyAnchor("   ")                   → "section"
 */
export function slugifyAnchor(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(ATOMIC_LETTERS_RE, (c) => ATOMIC_LETTERS[c] ?? c)
    .normalize("NFKD")
    .replace(COMBINING_MARKS_RE, "")
    .replace(MODIFIER_LETTERS_RE, "")
    .replace(NON_SLUG_RE, "-")
    .replace(EDGE_DASHES_RE, "")
    .slice(0, ANCHOR_MAX_LENGTH)
    .replace(EDGE_DASHES_RE, "");
  return slug || ANCHOR_FALLBACK;
}

/**
 * Kotwice, jakie ten sam nagłówek dostawał PRZED unifikacją - do utrzymania
 * wstecznej zgodności już opublikowanych linków `#`.
 *
 * Zwraca wyłącznie warianty RÓŻNE od kanonicznego, więc dla nagłówka bez liter
 * atomowych i krótszego niż limit lista jest pusta i nic nie dokładamy do DOM-u.
 *
 * Warianty:
 *  - silnik bloków / spis treści: bez transliteracji, BEZ limitu długości,
 *  - `FloatingShareBar`: bez transliteracji, limit 64 znaków,
 *  - builder `TocWidget`: bez transliteracji, limit 80 znaków cięty PO
 *    zdjęciu myślników z krawędzi - cięcie mogło zostawić "…-" na końcu;
 *    odtwarzane bajt w bajt, bo alias musi trafić w opublikowany fragment.
 */
export function legacyAnchorVariants(input: string): string[] {
  const canonical = slugifyAnchor(input);
  const raw = legacyAsciiSlug(input);
  const candidates = [
    raw,
    raw.slice(0, LEGACY_SHARE_BAR_MAX_LENGTH).replace(EDGE_DASHES_RE, "") || ANCHOR_FALLBACK,
    raw.slice(0, ANCHOR_MAX_LENGTH) || ANCHOR_FALLBACK,
  ];
  const out: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || candidate === canonical || out.includes(candidate)) continue;
    out.push(candidate);
  }
  return out;
}

/**
 * Przydziela unikalne kotwice w obrębie JEDNEGO dokumentu. Jedna semantyka
 * deduplikacji dla wszystkich silników: sufiks `-2`, `-3`, … liczony od BAZY.
 *
 * (Poprzednio `FloatingShareBar` doklejał sufiks do ostatnio wygenerowanego id,
 * więc trzeci duplikat wychodził jako `tytul-2-2` zamiast `tytul-3`, a silnik
 * bloków nie deduplikował wcale i emitował zduplikowane `id` w DOM - niepoprawny
 * HTML, przy którym `#kotwica` skakała zawsze do pierwszego trafienia.)
 */
export interface AnchorAllocator {
  /**
   * Zwraca unikalną kotwicę dla nagłówka. `explicit` (kotwica podana ręcznie
   * przez autora w edytorze) ma pierwszeństwo nad slugiem z treści.
   */
  allocate(text: string, explicit?: string | null): string;
  /** Rezerwuje istniejące id (np. `footnotes-heading`), by nie doszło do kolizji. */
  reserve(id: string): void;
  /** Czy kotwica została już przydzielona lub zarezerwowana. */
  has(id: string): boolean;
}

export function createAnchorAllocator(): AnchorAllocator {
  const used = new Set<string>();
  return {
    allocate(text, explicit) {
      const trimmedExplicit = explicit?.trim() ?? "";
      const base = trimmedExplicit || slugifyAnchor(text);
      if (!used.has(base)) {
        used.add(base);
        return base;
      }
      let n = 2;
      let candidate = `${base}-${n}`;
      while (used.has(candidate)) {
        n += 1;
        candidate = `${base}-${n}`;
      }
      used.add(candidate);
      return candidate;
    },
    reserve(id) {
      if (id) used.add(id);
    },
    has(id) {
      return used.has(id);
    },
  };
}
