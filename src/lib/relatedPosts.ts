// Related posts: shared types, defaults, merge helper, and pure scoring
// algorithm (v2) used by the public query layer, admin panel and unit tests.
//
// Wersja 2 wprowadza konfigurowalne wagi sygnałów, IDF (rzadkie tagi ważą
// więcej), sygnały behawioralne (popularność / dwell) i personalizację
// (profil zalogowanego użytkownika). Wynik scoringu jest rozbity per sygnał,
// żeby panel analityczny mógł pokazać "z czego wzięło się to dopasowanie".
import type { BlogListItem } from "@/lib/queries/public";

export type RelatedPosition = "end" | "sidebar" | "after_paragraph";
export type RelatedLayout = "grid" | "list" | "slider" | "cards" | "magazine" | "timeline";
export type RelatedSource = "categories" | "tags" | "both" | "author";

export interface RelatedPostsConfig {
  enabled: boolean;
  position: RelatedPosition;
  after_paragraph: number;
  layout: RelatedLayout;
  columns: 2 | 3 | 4;
  items_limit: number;
  source_strategy: RelatedSource;
  show_excerpt: boolean;
  show_meta: boolean;
  show_cover: boolean;
  recency_boost_days: number;
  slider_autoplay: boolean;
  slider_interval_ms: number;
  title_pl: string;
  title_en: string;
  // v2 - wagi silnika 0..10, IDF, próg minimalnego score
  weight_categories: number;
  weight_tags: number;
  weight_author: number;
  weight_recency: number;
  weight_popularity: number;
  weight_dwell: number;
  weight_personalization: number;
  use_idf: boolean;
  min_score: number;
}

export type RelatedPostsOverride = Partial<RelatedPostsConfig>;

export const RELATED_POSTS_DEFAULTS: RelatedPostsConfig = {
  enabled: true,
  position: "end",
  after_paragraph: 3,
  layout: "grid",
  columns: 3,
  items_limit: 6,
  source_strategy: "both",
  show_excerpt: true,
  show_meta: true,
  show_cover: true,
  recency_boost_days: 30,
  slider_autoplay: false,
  slider_interval_ms: 5000,
  title_pl: "Powiązane wpisy",
  title_en: "Related posts",
  weight_categories: 3,
  weight_tags: 2,
  weight_author: 1,
  weight_recency: 1,
  weight_popularity: 2,
  weight_dwell: 2,
  weight_personalization: 3,
  use_idf: true,
  min_score: 0,
};

export function mergeRelatedConfig(
  global: Partial<RelatedPostsConfig> | null | undefined,
  override: RelatedPostsOverride | null | undefined,
): RelatedPostsConfig {
  const base: RelatedPostsConfig = { ...RELATED_POSTS_DEFAULTS, ...(global ?? {}) };
  if (!override) return base;
  // Only spread defined override keys so `null`/missing values don't clobber the global.
  const cleaned = Object.fromEntries(
    Object.entries(override).filter(([, v]) => v !== undefined && v !== null),
  ) as RelatedPostsOverride;
  return { ...base, ...cleaned };
}

// -- Scoring algorithm v2 ----------------------------------------------------

export interface RelatedCandidateMeta {
  categoryIds: ReadonlySet<string>;
  tagIds: ReadonlySet<string>;
  authorId: string | null;
}

export interface CurrentPostMeta {
  categoryIds: ReadonlySet<string>;
  tagIds: ReadonlySet<string>;
  authorId: string | null;
}

/** Profil zainteresowań usera zbudowany z historii czytania. */
export interface UserAffinityProfile {
  /** Kategoria -> ilość razy przeczytanych wpisów w tej kategorii. */
  categoryHits: ReadonlyMap<string, number>;
  /** Tag -> ilość razy przeczytanych wpisów z tym tagiem. */
  tagHits: ReadonlyMap<string, number>;
  totalReads: number;
}

export interface ScoringSignals {
  /** Popularność w oknie (unikalni odwiedzający lub views), znormalizowana 0..1. */
  popularityByPost?: ReadonlyMap<string, number>;
  /** Proxy dwell time - liczba czytelników wpisu (unikalnych user_id), znormalizowana 0..1. */
  dwellByPost?: ReadonlyMap<string, number>;
  /** Profil aktualnie zalogowanego usera. */
  userProfile?: UserAffinityProfile;
  /** Inverse Document Frequency dla kategorii (id -> waga 0..3). */
  idfCat?: ReadonlyMap<string, number>;
  /** Inverse Document Frequency dla tagów (id -> waga 0..3). */
  idfTag?: ReadonlyMap<string, number>;
}

export interface ScoreBreakdown {
  categories: number;
  tags: number;
  author: number;
  recency: number;
  popularity: number;
  dwell: number;
  personalization: number;
}

export interface ScoredCandidate {
  total: number;
  breakdown: ScoreBreakdown;
}

type ScoringConfig = Pick<
  RelatedPostsConfig,
  | "source_strategy"
  | "recency_boost_days"
  | "weight_categories"
  | "weight_tags"
  | "weight_author"
  | "weight_recency"
  | "weight_popularity"
  | "weight_dwell"
  | "weight_personalization"
  | "use_idf"
>;

/**
 * Wersja legacy - liczy tylko sumę i zachowana dla kompatybilności testów.
 * Nowy kod powinien używać `scoreRelatedDetailed`.
 */
export function scoreRelated(
  current: CurrentPostMeta,
  cand: RelatedCandidateMeta,
  cfg: Pick<RelatedPostsConfig, "source_strategy" | "recency_boost_days"> &
    Partial<ScoringConfig>,
  publishedAt: string | null,
  now: number = Date.now(),
): number {
  const merged: ScoringConfig = {
    source_strategy: cfg.source_strategy,
    recency_boost_days: cfg.recency_boost_days,
    weight_categories: cfg.weight_categories ?? RELATED_POSTS_DEFAULTS.weight_categories,
    weight_tags: cfg.weight_tags ?? RELATED_POSTS_DEFAULTS.weight_tags,
    weight_author: cfg.weight_author ?? RELATED_POSTS_DEFAULTS.weight_author,
    weight_recency: cfg.weight_recency ?? RELATED_POSTS_DEFAULTS.weight_recency,
    weight_popularity: cfg.weight_popularity ?? 0,
    weight_dwell: cfg.weight_dwell ?? 0,
    weight_personalization: cfg.weight_personalization ?? 0,
    use_idf: cfg.use_idf ?? false,
  };
  return scoreRelatedDetailed(current, cand, merged, publishedAt, undefined, undefined, now).total;
}

/** Główny scorer v2 - zwraca sumę i rozbicie per sygnał. */
export function scoreRelatedDetailed(
  current: CurrentPostMeta,
  cand: RelatedCandidateMeta,
  cfg: ScoringConfig,
  publishedAt: string | null,
  candidatePostId: string | undefined,
  signals: ScoringSignals | undefined,
  now: number = Date.now(),
): ScoredCandidate {
  const breakdown: ScoreBreakdown = {
    categories: 0,
    tags: 0,
    author: 0,
    recency: 0,
    popularity: 0,
    dwell: 0,
    personalization: 0,
  };

  const useCats = cfg.source_strategy === "categories" || cfg.source_strategy === "both";
  const useTags = cfg.source_strategy === "tags" || cfg.source_strategy === "both";

  if (useCats) {
    let sum = 0;
    cand.categoryIds.forEach((id) => {
      if (current.categoryIds.has(id)) {
        const idf = cfg.use_idf ? signals?.idfCat?.get(id) ?? 1 : 1;
        sum += idf;
      }
    });
    breakdown.categories = sum * cfg.weight_categories;
  }

  if (useTags) {
    let sum = 0;
    cand.tagIds.forEach((id) => {
      if (current.tagIds.has(id)) {
        const idf = cfg.use_idf ? signals?.idfTag?.get(id) ?? 1 : 1;
        sum += idf;
      }
    });
    breakdown.tags = sum * cfg.weight_tags;
  }

  if (cand.authorId && current.authorId && cand.authorId === current.authorId) {
    breakdown.author =
      cfg.source_strategy === "author" ? cfg.weight_author * 4 : cfg.weight_author;
  }

  if (publishedAt && cfg.recency_boost_days > 0) {
    const ageDays = (now - new Date(publishedAt).getTime()) / 86_400_000;
    if (ageDays >= 0 && ageDays < cfg.recency_boost_days) {
      // Płaski bonus w oknie (parametr `weight_recency` steruje siłą).
      breakdown.recency = cfg.weight_recency;
    }
  }


  if (candidatePostId && signals?.popularityByPost) {
    const p = signals.popularityByPost.get(candidatePostId) ?? 0;
    breakdown.popularity = cfg.weight_popularity * p;
  }

  if (candidatePostId && signals?.dwellByPost) {
    const d = signals.dwellByPost.get(candidatePostId) ?? 0;
    breakdown.dwell = cfg.weight_dwell * d;
  }

  if (signals?.userProfile && signals.userProfile.totalReads > 0) {
    let pers = 0;
    const total = signals.userProfile.totalReads;
    cand.categoryIds.forEach((id) => {
      const hits = signals.userProfile?.categoryHits.get(id) ?? 0;
      if (hits > 0) pers += hits / total;
    });
    cand.tagIds.forEach((id) => {
      const hits = signals.userProfile?.tagHits.get(id) ?? 0;
      if (hits > 0) pers += (hits / total) * 0.6; // tagi lżej niż kategorie
    });
    breakdown.personalization = cfg.weight_personalization * pers;
  }

  const total =
    breakdown.categories +
    breakdown.tags +
    breakdown.author +
    breakdown.recency +
    breakdown.popularity +
    breakdown.dwell +
    breakdown.personalization;

  return { total, breakdown };
}

export interface RankedScored<T extends { post: BlogListItem }> {
  post: BlogListItem;
  score: number;
  breakdown?: ScoreBreakdown;
  extra?: T;
}

export function rankRelated<T extends { post: BlogListItem; score: number }>(
  items: T[],
  limit: number,
  minScore = 0,
): T[] {
  return items
    .filter((i) => i.score > 0 && i.score >= minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.post.published_at ?? "").localeCompare(a.post.published_at ?? "");
    })
    .slice(0, limit);
}

/**
 * Buduje mapę IDF (Inverse Document Frequency) dla listy dokumentów.
 * `df` to liczba dokumentów w których termin występuje, `N` to całość.
 * Zwraca wartości w przedziale ~0.1..3.5, więc silnik lekko wzmacnia
 * rzadkie tagi i tłumi mainstreamowe.
 */
export function buildIdf(
  df: ReadonlyMap<string, number>,
  totalDocs: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const N = Math.max(1, totalDocs);
  df.forEach((count, id) => {
    const v = Math.log(1 + N / Math.max(1, count));
    // Klamruj do 0.2..3, żeby żadna waga nie zdominowała
    out.set(id, Math.min(3, Math.max(0.2, v)));
  });
  return out;
}

/** Normalizuje mapę do zakresu 0..1 względem maksimum. */
export function normalizeMap(m: ReadonlyMap<string, number>): Map<string, number> {
  let max = 0;
  m.forEach((v) => {
    if (v > max) max = v;
  });
  const out = new Map<string, number>();
  if (max <= 0) return out;
  m.forEach((v, k) => out.set(k, v / max));
  return out;
}
