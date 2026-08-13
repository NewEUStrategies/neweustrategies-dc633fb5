// Wyszukiwanie klubów po CZĘŚCIACH nazwy, z rankingiem trafności.
//
// Hub przez długi czas miał tylko wyszukiwanie serwerowe (`club_search`), które
// szuka w WĄTKACH. Wpisanie fragmentu nazwy klubu ("bezp", "europy srodkowej")
// nie dawało więc samego klubu, tylko wątki - albo nic. Katalog huba i tak jest
// już w pamięci (RPC `club_list`), więc dopasowanie nazw robimy po stronie
// klienta: zero dodatkowych round-tripów i wynik natychmiast po wpisaniu.
//
// Reguły dopasowania:
//   - zapytanie tnie się na TOKENY po białych znakach i myślnikach, każdy token
//     musi trafić w co najmniej jedno pole (AND) - "srodkowej bezp" znajduje
//     "Bezpieczeństwo Europy Środkowo-Wschodniej" niezależnie od kolejności,
//   - porównanie idzie po tekście bez znaków diakrytycznych i bez wielkości
//     liter, żeby "srodkowo" == "Środkowo",
//   - trafność: prefiks nazwy > początek słowa w nazwie > fragment nazwy >
//     slug > fragment opisu/obszaru. Punkty sumują się po tokenach, więc klub
//     trafiony dwoma tokenami stoi nad trafionym jednym.
import { uiLocale } from "@/lib/i18n/format";
import { pickLocalized, type LocaleCode } from "@/lib/i18n/pickLocalized";

export interface ClubMatchInput {
  slug: string;
  name_pl: string;
  name_en: string;
  tagline_pl: string | null;
  tagline_en: string | null;
  policy_area: string | null;
}

/** Bez diakrytyków, bez wielkości liter, pojedyncze spacje. */
export function normalizeClubText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0142/g, "l")
    .replace(/\u0141/g, "l")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokeny zapytania; puste tokeny i separatory znikają. */
export function tokenizeClubQuery(query: string): string[] {
  return normalizeClubText(query)
    .split(/[\s\-/,.]+/)
    .filter((token) => token.length > 0);
}

const WEIGHT = {
  namePrefix: 10,
  nameWordStart: 7,
  nameContains: 4,
  slug: 3,
  topic: 2,
  tagline: 2,
} as const;

function scoreField(haystack: string, token: string, weights: { start: number; inside: number }) {
  if (haystack === "") return 0;
  if (haystack.startsWith(token)) return weights.start;
  if (haystack.includes(` ${token}`)) return Math.round((weights.start + weights.inside) / 2);
  if (haystack.includes(token)) return weights.inside;
  return 0;
}

/**
 * Punktacja jednego klubu względem tokenów. Zwraca 0, gdy KTÓRYKOLWIEK token
 * nie ma trafienia - wynik częściowy byłby szumem, nie wynikiem.
 */
export function scoreClubMatch(
  club: ClubMatchInput,
  tokens: readonly string[],
  topicLabel?: string | null,
): number {
  if (tokens.length === 0) return 0;

  const names = [normalizeClubText(club.name_pl), normalizeClubText(club.name_en)];
  const slug = normalizeClubText(club.slug.replace(/-/g, " "));
  const taglines = [
    normalizeClubText(club.tagline_pl ?? ""),
    normalizeClubText(club.tagline_en ?? ""),
  ];
  const topic = normalizeClubText(topicLabel ?? club.policy_area ?? "");

  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const name of names) {
      best = Math.max(
        best,
        scoreField(name, token, { start: WEIGHT.namePrefix, inside: WEIGHT.nameContains }),
      );
      // Trafienie w środek słowa nazwy nadal jest lepsze niż w opis.
      if (best === 0 && name.includes(token)) best = WEIGHT.nameWordStart - 4;
    }
    if (best === 0) best = scoreField(slug, token, { start: WEIGHT.slug, inside: WEIGHT.slug });
    if (best === 0) best = scoreField(topic, token, { start: WEIGHT.topic, inside: WEIGHT.topic });
    if (best === 0) {
      for (const tagline of taglines) {
        best = Math.max(
          best,
          scoreField(tagline, token, { start: WEIGHT.tagline, inside: WEIGHT.tagline }),
        );
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/**
 * Filtr + sortowanie katalogu po trafności. Remis rozstrzyga nazwa, żeby
 * kolejność była stabilna między renderami.
 */
export function rankClubs<T extends ClubMatchInput>(
  clubs: readonly T[],
  query: string,
  options?: { lang?: LocaleCode; topicLabel?: (club: T) => string | null },
): T[] {
  const tokens = tokenizeClubQuery(query);
  if (tokens.length === 0) return [...clubs];
  const lang = options?.lang ?? "pl";

  return clubs
    .map((club) => ({
      club,
      score: scoreClubMatch(club, tokens, options?.topicLabel?.(club) ?? null),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // `pickLocalized`, nie `lang === "pl" ? name_pl : name_en`: klub nazwany
      // tylko w jednym języku dawał przy remisie klucz PUSTY, a pusty ciąg
      // sortuje się PRZED każdą nazwą - taki klub wskakiwał na czoło listy
      // trafień, nie mając w nazwie ani jednego szukanego słowa.
      const an = normalizeClubText(pickLocalized(a.club, "name", lang));
      const bn = normalizeClubText(pickLocalized(b.club, "name", lang));
      return an.localeCompare(bn, uiLocale(lang));
    })
    .map((entry) => entry.club);
}
