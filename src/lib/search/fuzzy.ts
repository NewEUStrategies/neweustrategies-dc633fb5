// Tiny fuzzy matcher. Sublime-style: subsequence match with bonuses for
// consecutive hits, word boundaries, and prefix. Returns a score (higher
// = better) plus the matched character indexes for highlighting.
//
// Designed to be allocation-light enough to run synchronously on a list of
// a few thousand items during typing.

export interface FuzzyMatch {
  score: number;
  indexes: number[];
}

/**
 * Litery, których rozkład kanoniczny (NFD) NIE oddziela znaku diakrytycznego -
 * „ł" jest osobnym punktem kodowym, nie „l" plus kreska. To ta sama pułapka,
 * która zjadła literę „ł" w propozycji adresu profilu (naprawa z 18.08.2026).
 *
 * Mapa trzyma WYŁĄCZNIE odwzorowania jeden-do-jednego. Ligatury (ß→ss, æ→ae)
 * są świadomie pominięte: składanie MUSI zachować długość napisu, bo `indexes`
 * wskazuje pozycje w ORYGINALNYM tekście i służy do podświetlania trafień.
 */
const FOLD_SINGLE: Readonly<Record<string, string>> = {
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ø: "o",
  Ø: "O",
};

/**
 * Składa znaki diakrytyczne, ZACHOWUJĄC DŁUGOŚĆ (jeden znak → jeden znak).
 * Iteracja po jednostkach UTF-16, nie po punktach kodowych: para zastępcza
 * (emoji) przeszłaby wtedy jako jeden krok i skróciła wynik, rozjeżdżając
 * indeksy podświetlenia.
 */
export function foldDiacritics(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const single = FOLD_SINGLE[ch];
    if (single !== undefined) {
      out += single;
      continue;
    }
    const stripped = ch.normalize("NFD").replace(/\p{M}/gu, "");
    out += stripped.length === 1 ? stripped : ch;
  }
  return out;
}

/**
 * Składa FRAZĘ WYSZUKIWANĄ. W odróżnieniu od `foldDiacritics` NIE musi
 * zachowywać długości: `indexes` opisują pozycje w CELU, nie w zapytaniu,
 * więc skrócenie frazy niczego nie rozjeżdża. To pozwala zrobić dwie rzeczy,
 * na które po stronie celu miejsca nie ma:
 *
 *   1. złożyć wejście do NFC - wklejka bywa rozłożona kanonicznie („s” + U+0301
 *      zamiast „ś”; tak trzyma nazwy plików HFS+, tak potrafi oddać schowek),
 *   2. usunąć znaki łączące, które po NFC nie mają formy złożonej.
 *
 * Bez tego zapytanie rozłożone NIE TRAFIA w cel złożony: matcher musi
 * skonsumować KAŻDY znak frazy, a osieroconej kreski w celu nie ma. Odwrotny
 * przypadek (cel rozłożony, fraza złożona) działa i bez tego - dopasowanie jest
 * podciągiem, więc zbłąkany znak łączący w celu zostaje po prostu pominięty,
 * a `indexes` nadal wskazują właściwe litery.
 */
export function foldQuery(s: string): string {
  return foldDiacritics(s.normalize("NFC")).replace(/\p{M}/gu, "");
}

/**
 * Match `query` against `target` (case-insensitive, diacritics-insensitive).
 * Returns null if any character of the query is not present in order.
 *
 * Składanie diakrytyków jest SYMETRYCZNE (fraza i cel), więc „platnosci"
 * znajduje „Płatności", a „płatności" nadal znajduje „Platnosci". Zwracane
 * `indexes` wskazują pozycje w oryginalnym `target` - podświetlenie zaznacza
 * literę z ogonkiem, nie jej złożony odpowiednik.
 *
 * Fraza idzie przez `foldQuery` (dodatkowo NFC + usunięcie znaków łączących),
 * cel przez `foldDiacritics` (zachowujące długość) - powód rozdziału opisany
 * przy `foldQuery`.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const q = foldQuery(query.trim().toLowerCase());
  if (!q) return { score: 0, indexes: [] };
  const t = foldDiacritics(target.toLowerCase());
  const indexes: number[] = [];
  let score = 0;
  let qi = 0;
  let prev = -2;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] !== q[qi]) continue;
    let bonus = 1;
    if (i === 0)
      bonus += 8; // start of string
    else {
      const before = t[i - 1];
      if (before === " " || before === "-" || before === "_" || before === "/" || before === ".")
        bonus += 6;
      if (before !== before.toLowerCase() && t[i] === t[i].toLowerCase()) bonus += 2;
    }
    if (i === prev + 1) bonus += 5; // consecutive
    score += bonus;
    indexes.push(i);
    prev = i;
    qi++;
  }
  if (qi < q.length) return null;
  // Penalize long targets so a short exact-ish hit beats a long match.
  score -= Math.max(0, t.length - q.length) * 0.05;
  return { score, indexes };
}

export interface RankableItem {
  /** Single string used for matching. Combine label + keywords + path. */
  haystack: string;
}

export function rankItems<T extends RankableItem>(
  items: readonly T[],
  query: string,
  limit = 50,
): T[] {
  const q = query.trim();
  if (!q) return items.slice(0, limit);
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const m = fuzzyMatch(q, item.haystack);
    if (m) scored.push({ item, score: m.score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}
