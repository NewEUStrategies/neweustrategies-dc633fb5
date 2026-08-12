// Grupowanie tematyczne stron w panelu /admin/pages.
//
// Rzeczywistość projektu: `pages` nie mają kolumny kategorii/typu — grupujemy
// deterministycznie po wzorcach slugów (i posiłkowo po tytułach). Każda
// pozycja ma dokładnie jeden temat (pierwsze trafienie po kolejności `TOPICS`),
// a "other" to negacja wszystkich pozostałych wzorców.
//
// Filtry działają po stronie serwera (Supabase `.or(slug.ilike.*, ...)`),
// więc paginacja i licznik pozostają spójne. Wzorce piszemy w formacie
// PostgREST `ilike` (LIKE bez case-sensitivity, `%` = wildcard).
// Wzorce są STAŁYMI zdefiniowanymi w tym pliku (nie user input), więc nie
// przechodzą przez `escapeLike` — ta funkcja usuwa `%`, co złamałoby ILIKE.

export type PageTopicKey =
  | "all"
  | "basic"
  | "events"
  | "conferences"
  | "chatham"
  | "clubs"
  | "debates"
  | "interviews"
  | "podcasts"
  | "membership"
  | "editorial"
  | "legal"
  | "forms"
  | "recruitment"
  | "mentoring"
  | "subscription"
  | "other";

export interface PageTopicDef {
  key: PageTopicKey;
  label_pl: string;
  label_en: string;
  /** Wzorce ILIKE dla kolumny `slug`. Puste dla `all` i `other`. */
  slugPatterns: string[];
}

// KOLEJNOŚĆ MA ZNACZENIE: pierwsze dopasowanie wygrywa (używane przez
// `topicForSlug` w renderze wiersza). Dlatego "chatham" i "conferences"
// idą PRZED ogólnym "events".
export const TOPICS: readonly PageTopicDef[] = [
  { key: "all", label_pl: "Wszystkie", label_en: "All", slugPatterns: [] },
  {
    key: "basic",
    label_pl: "Strony podstawowe",
    label_en: "Basic pages",
    slugPatterns: [
      "main",
      "home",
      "blog",
      "blog-%",
      "moje-konto",
      "my-account",
      "account",
      "koszyk",
      "cart",
      "checkout",
      "zamowienie",
      "zamowienia",
      "order",
      "orders",
      "login",
      "sign-in",
      "register",
      "sign-up",
      "password-reset",
      "reset-password",
      "logout",
      "sitemap",
      "search",
      "wyszukiwarka",
      "404",
    ],
  },
  {
    key: "conferences",
    label_pl: "Konferencje i panele",
    label_en: "Conferences & panels",
    slugPatterns: ["konferenc%", "panel-%", "%-panel", "%-panelu", "sesja-%", "sesje-%"],
  },
  {
    key: "chatham",
    label_pl: "Spotkania Chatham House",
    label_en: "Chatham House meetings",
    slugPatterns: ["chatham-%", "%chatham-house%", "spotkania-chatham%", "spotkanie-chatham%"],
  },
  {
    // Kluby dyskusyjne: hub /club plus podstrony klubów. Osobny temat, bo to
    // moduł zamknięty (pro+ i zaproszeni), a nie publiczne wydarzenie.
    key: "clubs",
    label_pl: "Kluby dyskusyjne",
    label_en: "Discussion clubs",
    slugPatterns: ["club", "club-%", "kluby%", "klub-%"],
  },

  {
    key: "debates",
    label_pl: "Debaty",
    label_en: "Debates",
    slugPatterns: ["debat%", "%-debata", "%-debate", "roundtable%", "%-roundtable"],
  },
  {
    key: "events",
    label_pl: "Wydarzenia",
    label_en: "Events",
    slugPatterns: [
      "event-%",
      "events-%",
      "%-event",
      "wydarzeni%",
      "agenda-%",
      "%-agenda",
      "countdown-%",
      "networking%",
      "sponsors-page",
      "speakers-directory",
      "prelegen%",
    ],
  },
  {
    key: "interviews",
    label_pl: "Wywiady",
    label_en: "Interviews",
    slugPatterns: ["wywiad%", "%-wywiad", "interview%", "%-interview"],
  },
  {
    key: "podcasts",
    label_pl: "Podcasty",
    label_en: "Podcasts",
    slugPatterns: ["podcast%", "%-podcast", "odcinek-%"],
  },
  {
    key: "membership",
    label_pl: "Członkostwo i subskrypcje",
    label_en: "Membership",
    slugPatterns: [
      "pricing",
      "cennik%",
      "membership-%",
      "%-membership",
      "dolacz-%",
      "join-%",
      "wspieraj-%",
      "donate%",
    ],
  },
  {
    key: "editorial",
    label_pl: "Redakcja",
    label_en: "Editorial",
    slugPatterns: ["analizy%", "analyses%", "the-great-game%", "contribute%", "zglos-%"],
  },
  {
    key: "legal",
    label_pl: "Prawne i informacyjne",
    label_en: "Legal & info",
    slugPatterns: [
      "polityka-%",
      "privacy%",
      "cookies%",
      "wytyczne-%",
      "guidelines%",
      "kontakt%",
      "contact%",
      "o-nas",
      "about%",
      "reklamuj-%",
      "advertis%",
      "membership-login",
      "membership-registration",
      "zwroty",
      "regulamin%",
      "terms%",
    ],
  },
  {
    key: "forms",
    label_pl: "Formularze",
    label_en: "Forms",
    slugPatterns: [
      "%formularz%",
      "%-form",
      "form-%",
      "apply-%",
      "%-apply",
      "edit-your-submission",
      "customize-interests",
      "zglos-%",
      "submit-%",
    ],
  },
  {
    key: "recruitment",
    label_pl: "Rekrutacja",
    label_en: "Recruitment",
    slugPatterns: [
      "jobs",
      "jobs-%",
      "zatrudniamy",
      "zatrudniamy-%",
      "kariera",
      "kariera-%",
      "career",
      "careers",
      "praca",
      "praca-%",
      "%-recruitment",
      "recruitment%",
    ],
  },
  {
    key: "mentoring",
    label_pl: "Mentoring",
    label_en: "Mentoring",
    slugPatterns: ["mentoring", "mentoring-%", "%-mentoring", "mentor-%", "%-mentor"],
  },
  {
    key: "subscription",
    label_pl: "Subskrypcja",
    label_en: "Subscription",
    slugPatterns: [
      "subksrybuj",
      "subskrybuj%",
      "subscribe%",
      "%-subscribe",
      "newsletter%",
      "%-newsletter",
    ],
  },
  { key: "other", label_pl: "Pozostałe", label_en: "Other", slugPatterns: [] },
] as const;

/** Wszystkie wzorce z wyłączeniem `all` i `other` (do budowy filtra "other"). */
export const CATEGORIZED_PATTERNS: readonly string[] = TOPICS.filter(
  (t) => t.key !== "all" && t.key !== "other",
).flatMap((t) => t.slugPatterns);

/**
 * Filtr PostgREST dla `.or(...)` — pozytywne dopasowanie slug ILIKE.
 * Zwraca `null`, jeśli topic nie wymaga filtra na serwerze (`all`).
 * Dla `other` zwraca `null`, a wywołujący dokłada łańcuch `.not(...)`.
 */
export function topicOrFilter(topic: PageTopicKey): string | null {
  if (topic === "all" || topic === "other") return null;
  const def = TOPICS.find((t) => t.key === topic);
  if (!def || def.slugPatterns.length === 0) return null;
  // escapeLike neutralizuje `,` i inne znaki, które PostgREST traktuje jako
  // separatory w `.or()` — dla naszych wzorców to no-op, ale trzymamy dyscyplinę.
  return def.slugPatterns.map((p) => `slug.ilike.${p.replace(/,/g, "")}`).join(",");
}

/** LIKE-patterns dla "other" — do zastosowania jako `.not("slug","ilike",p)` w łańcuchu. */
export function otherNotPatterns(): readonly string[] {
  return CATEGORIZED_PATTERNS;
}

/** Wyznacza temat po slugu (pierwsze dopasowanie po kolejności `TOPICS`). */
export function topicForSlug(slug: string | null | undefined): PageTopicKey {
  const s = (slug ?? "").toLowerCase();
  if (!s) return "other";
  for (const def of TOPICS) {
    if (def.key === "all" || def.key === "other") continue;
    if (def.slugPatterns.some((p) => matchLike(s, p))) return def.key;
  }
  return "other";
}

// Minimalny matcher SQL LIKE (`%` = *, `_` = ?) w JS — wyłącznie do UI-owego
// oznaczania wierszy. NIE używać do bezpieczeństwa/RLS.
function matchLike(input: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .toLowerCase()
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, ".*")
        .replace(/_/g, ".") +
      "$",
    "i",
  );
  return re.test(input);
}

export function topicLabel(key: PageTopicKey, lang: string): string {
  const def = TOPICS.find((t) => t.key === key);
  if (!def) return key;
  return lang.startsWith("en") ? def.label_en : def.label_pl;
}
