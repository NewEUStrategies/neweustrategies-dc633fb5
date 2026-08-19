// Scorer v2 (`scoreRelatedDetailed`) - sygnały, których legacy `scoreRelated`
// nie umiał podać: popularność, proxy czasu czytania, personalizacja i wagi IDF.
// Cała ta gałąź stała nieotestowana, a to ona decyduje o kolejności rekomendacji
// dla ZALOGOWANEGO czytelnika (dla anonimowego liczą się tylko kategorie, tagi,
// autor i świeżość).
//
// Trzy reguły, których złamanie widzi czytelnik:
//
//   1. ROZBICIE MUSI SUMOWAĆ SIĘ DO CAŁOŚCI. Panel pokazuje wkład per sygnał,
//      więc suma inna niż `total` to raport, który kłamie o własnym silniku.
//   2. BRAK SYGNAŁU TO ZERO, NIE NaN. Wpis bez odsłon, bez czytelników albo
//      czytelnik bez historii nie mogą wyprodukować NaN - NaN nie przechodzi
//      progu `minScore`, więc CAŁA lista rekomendacji zniknęłaby po cichu.
//   3. IDF DZIAŁA WYŁĄCZNIE PRZY WŁĄCZONYM `use_idf`. Przełącznik w panelu musi
//      naprawdę przełączać, a nie tylko wyglądać.
import { describe, it, expect } from "vitest";
import {
  RELATED_POSTS_DEFAULTS,
  scoreRelated,
  scoreRelatedDetailed,
  type CurrentPostMeta,
  type RelatedCandidateMeta,
  type ScoreBreakdown,
  type ScoringSignals,
} from "@/lib/relatedPosts";

const NOW = new Date("2026-08-18T10:00:00.000Z").getTime();
const DAY_MS = 86_400_000;

const CAND_ID = "cand-1";

interface MetaOverrides {
  categoryIds?: string[];
  tagIds?: string[];
  authorId?: string | null;
}

function current(overrides: MetaOverrides = {}): CurrentPostMeta {
  return {
    categoryIds: new Set(overrides.categoryIds ?? ["cat-a"]),
    tagIds: new Set(overrides.tagIds ?? ["tag-a"]),
    // `in`, nie `??`: JAWNE `authorId: null` musi przejść, a `null ?? "author-1"`
    // wraca do wartości domyślnej i test braku autora nic by nie dowodził.
    authorId: "authorId" in overrides ? (overrides.authorId ?? null) : "author-1",
  };
}

function candidate(overrides: MetaOverrides = {}): RelatedCandidateMeta {
  return {
    categoryIds: new Set(overrides.categoryIds ?? ["cat-a"]),
    tagIds: new Set(overrides.tagIds ?? ["tag-a"]),
    authorId: "authorId" in overrides ? (overrides.authorId ?? null) : "author-1",
  };
}

function cfg(overrides: Partial<Parameters<typeof scoreRelatedDetailed>[2]> = {}) {
  return {
    source_strategy: "both" as const,
    recency_boost_days: 0,
    weight_categories: 1,
    weight_tags: 1,
    weight_author: 1,
    weight_recency: 1,
    weight_popularity: 0,
    weight_dwell: 0,
    weight_personalization: 0,
    use_idf: false,
    ...overrides,
  };
}

function sumBreakdown(breakdown: ScoreBreakdown): number {
  return Object.values(breakdown).reduce((a, b) => a + b, 0);
}

describe("scoreRelatedDetailed - inwariant rozbicia", () => {
  it("suma rozbicia jest RÓWNA `total` (raport panelu nie kłamie)", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ recency_boost_days: 30, weight_recency: 2 }),
      new Date(NOW - DAY_MS).toISOString(),
      CAND_ID,
      undefined,
      NOW,
    );
    expect(sumBreakdown(scored.breakdown)).toBeCloseTo(scored.total, 10);
    expect(scored.total).toBeGreaterThan(0);
  });

  it("kandydat bez części wspólnej dostaje zero na wszystkich sygnałach", () => {
    const scored = scoreRelatedDetailed(
      current({ categoryIds: ["cat-a"], tagIds: ["tag-a"], authorId: "author-1" }),
      candidate({ categoryIds: ["cat-z"], tagIds: ["tag-z"], authorId: "author-2" }),
      cfg(),
      null,
      CAND_ID,
      undefined,
      NOW,
    );
    expect(scored.total).toBe(0);
    expect(scored.breakdown).toMatchObject({ categories: 0, tags: 0, author: 0 });
  });

  it("`source_strategy: categories` liczy kategorie i IGNORUJE tagi", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ source_strategy: "categories", weight_tags: 5 }),
      null,
      CAND_ID,
      undefined,
      NOW,
    );
    expect(scored.breakdown.categories).toBe(1);
    expect(scored.breakdown.tags).toBe(0);
  });

  it("`source_strategy: tags` liczy tagi i IGNORUJE kategorie", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ source_strategy: "tags", weight_categories: 5 }),
      null,
      CAND_ID,
      undefined,
      NOW,
    );
    expect(scored.breakdown.tags).toBe(1);
    expect(scored.breakdown.categories).toBe(0);
  });

  it("`source_strategy: author` daje autorowi CZTEROKROTNĄ wagę", () => {
    const asAuthor = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ source_strategy: "author", weight_author: 2 }),
      null,
      CAND_ID,
      undefined,
      NOW,
    );
    const asBoth = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ source_strategy: "both", weight_author: 2 }),
      null,
      CAND_ID,
      undefined,
      NOW,
    );
    expect(asAuthor.breakdown.author).toBe(8);
    expect(asBoth.breakdown.author).toBe(2);
  });

  it("BRAK autora po którejkolwiek stronie nie daje bonusu autorskiego", () => {
    const noneOnCurrent = scoreRelatedDetailed(
      current({ authorId: null }),
      candidate(),
      cfg(),
      null,
      CAND_ID,
      undefined,
      NOW,
    );
    const noneOnCandidate = scoreRelatedDetailed(
      current(),
      candidate({ authorId: null }),
      cfg(),
      null,
      CAND_ID,
      undefined,
      NOW,
    );
    expect(noneOnCurrent.breakdown.author).toBe(0);
    expect(noneOnCandidate.breakdown.author).toBe(0);
  });
});

describe("scoreRelatedDetailed - okno świeżości", () => {
  it("wpis W OKNIE dostaje płaski bonus równy wadze", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ recency_boost_days: 30, weight_recency: 3 }),
      new Date(NOW - 5 * DAY_MS).toISOString(),
      CAND_ID,
      undefined,
      NOW,
    );
    expect(scored.breakdown.recency).toBe(3);
    expect(scored.total).toBeGreaterThan(3);
  });

  it("wpis POZA oknem nie dostaje nic", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ recency_boost_days: 30, weight_recency: 3 }),
      new Date(NOW - 90 * DAY_MS).toISOString(),
      CAND_ID,
      undefined,
      NOW,
    );
    expect(scored.breakdown.recency).toBe(0);
    expect(scored.total).toBe(3);
  });

  it("wpis z datą W PRZYSZŁOŚCI nie dostaje bonusu (ujemny wiek jest odsiewany)", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ recency_boost_days: 30, weight_recency: 3 }),
      new Date(NOW + 5 * DAY_MS).toISOString(),
      CAND_ID,
      undefined,
      NOW,
    );
    expect(scored.breakdown.recency).toBe(0);
    expect(Number.isFinite(scored.total)).toBe(true);
  });

  it("okno wyłączone (0 dni) nie liczy świeżości nawet dla dzisiejszego wpisu", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ recency_boost_days: 0, weight_recency: 9 }),
      new Date(NOW).toISOString(),
      CAND_ID,
      undefined,
      NOW,
    );
    expect(scored.breakdown.recency).toBe(0);
    expect(scored.total).toBe(3);
  });

  it("BRAK daty publikacji nie liczy świeżości i nie daje NaN", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ recency_boost_days: 30, weight_recency: 3 }),
      null,
      CAND_ID,
      undefined,
      NOW,
    );
    expect(scored.breakdown.recency).toBe(0);
    expect(Number.isNaN(scored.total)).toBe(false);
  });
});

describe("scoreRelatedDetailed - wagi IDF", () => {
  const signals: ScoringSignals = {
    idfCat: new Map([["cat-a", 2.5]]),
    idfTag: new Map([["tag-a", 0.4]]),
  };

  it("PRZEŁĄCZNIK DZIAŁA: przy `use_idf: false` wagi rzadkości są ignorowane", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ use_idf: false }),
      null,
      CAND_ID,
      signals,
      NOW,
    );
    expect(scored.breakdown.categories).toBe(1);
    expect(scored.breakdown.tags).toBe(1);
  });

  it("przy `use_idf: true` kategoria rzadka waży więcej, tag pospolity mniej", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ use_idf: true }),
      null,
      CAND_ID,
      signals,
      NOW,
    );
    expect(scored.breakdown.categories).toBeCloseTo(2.5, 10);
    expect(scored.breakdown.tags).toBeCloseTo(0.4, 10);
  });

  it("BRAK wagi dla danego id degraduje do 1, nie do zera", () => {
    const scored = scoreRelatedDetailed(
      current({ categoryIds: ["cat-brak"], tagIds: ["tag-brak"] }),
      candidate({ categoryIds: ["cat-brak"], tagIds: ["tag-brak"] }),
      cfg({ use_idf: true }),
      null,
      CAND_ID,
      signals,
      NOW,
    );
    expect(scored.breakdown.categories).toBe(1);
    expect(scored.breakdown.tags).toBe(1);
  });

  it("`use_idf: true` BEZ przekazanych sygnałów też degraduje do 1", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ use_idf: true }),
      null,
      CAND_ID,
      undefined,
      NOW,
    );
    expect(scored.breakdown.categories).toBe(1);
    expect(scored.breakdown.tags).toBe(1);
  });

  it("wiele wspólnych kategorii sumuje wagi, nie bierze maksimum", () => {
    const scored = scoreRelatedDetailed(
      current({ categoryIds: ["cat-a", "cat-b"], tagIds: [] }),
      candidate({ categoryIds: ["cat-a", "cat-b"], tagIds: [] }),
      cfg({ use_idf: true }),
      null,
      CAND_ID,
      {
        idfCat: new Map([
          ["cat-a", 2],
          ["cat-b", 3],
        ]),
      },
      NOW,
    );
    expect(scored.breakdown.categories).toBe(5);
    expect(scored.breakdown.tags).toBe(0);
  });
});

describe("scoreRelatedDetailed - popularność i proxy czasu czytania", () => {
  it("popularność wchodzi z wagą z panelu", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ weight_popularity: 4 }),
      null,
      CAND_ID,
      { popularityByPost: new Map([[CAND_ID, 0.5]]) },
      NOW,
    );
    expect(scored.breakdown.popularity).toBe(2);
    // Baza (kategoria + tag + autor, wagi po 1) = 3, plus popularność 2.
    expect(scored.total).toBe(5);
  });

  it("WPIS BEZ ODSŁON dostaje zero, nie NaN", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ weight_popularity: 4 }),
      null,
      CAND_ID,
      { popularityByPost: new Map([["inny-wpis", 0.9]]) },
      NOW,
    );
    expect(scored.breakdown.popularity).toBe(0);
    expect(Number.isNaN(scored.total)).toBe(false);
  });

  it("proxy czasu czytania wchodzi z własną wagą, niezależnie od popularności", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ weight_dwell: 10, weight_popularity: 0 }),
      null,
      CAND_ID,
      { dwellByPost: new Map([[CAND_ID, 0.25]]) },
      NOW,
    );
    expect(scored.breakdown.dwell).toBe(2.5);
    expect(scored.breakdown.popularity).toBe(0);
  });

  it("BRAK identyfikatora kandydata wyłącza oba sygnały per wpis", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ weight_popularity: 4, weight_dwell: 4 }),
      null,
      undefined,
      { popularityByPost: new Map([[CAND_ID, 1]]), dwellByPost: new Map([[CAND_ID, 1]]) },
      NOW,
    );
    expect(scored.breakdown.popularity).toBe(0);
    expect(scored.breakdown.dwell).toBe(0);
  });
});

describe("scoreRelatedDetailed - personalizacja", () => {
  const profile = {
    categoryHits: new Map([["cat-a", 5]]),
    tagHits: new Map([["tag-a", 10]]),
    totalReads: 10,
  };

  it("kategorie z historii czytania ważą pełną proporcją, tagi 60% z niej", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ weight_personalization: 1, weight_categories: 0, weight_tags: 0, weight_author: 0 }),
      null,
      CAND_ID,
      { userProfile: profile },
      NOW,
    );
    // kategoria: 5/10 = 0,5; tag: (10/10) * 0,6 = 0,6 -> razem 1,1
    expect(scored.breakdown.personalization).toBeCloseTo(1.1, 10);
    expect(scored.total).toBeCloseTo(1.1, 10);
  });

  it("CZYTELNIK BEZ HISTORII (`totalReads: 0`) daje zero, nie dzielenie przez zero", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ weight_personalization: 5 }),
      null,
      CAND_ID,
      { userProfile: { categoryHits: new Map(), tagHits: new Map(), totalReads: 0 } },
      NOW,
    );
    expect(scored.breakdown.personalization).toBe(0);
    expect(Number.isNaN(scored.total)).toBe(false);
  });

  it("kategoria i tag NIEOBECNE w historii nie dodają nic", () => {
    const scored = scoreRelatedDetailed(
      current({ categoryIds: ["cat-nowa"], tagIds: ["tag-nowy"] }),
      candidate({ categoryIds: ["cat-nowa"], tagIds: ["tag-nowy"] }),
      cfg({ weight_personalization: 5 }),
      null,
      CAND_ID,
      { userProfile: profile },
      NOW,
    );
    expect(scored.breakdown.personalization).toBe(0);
    expect(scored.breakdown.categories).toBe(1);
  });

  it("BRAK profilu (gość) wyłącza personalizację całkowicie", () => {
    const scored = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({ weight_personalization: 5 }),
      null,
      CAND_ID,
      {},
      NOW,
    );
    expect(scored.breakdown.personalization).toBe(0);
    expect(scored.total).toBe(3);
  });

  it("personalizacja liczy się z kategorii kandydata, także gdy NIE są wspólne z bieżącym wpisem", () => {
    const scored = scoreRelatedDetailed(
      current({ categoryIds: ["cat-inna"], tagIds: [] }),
      candidate({ categoryIds: ["cat-a"], tagIds: [] }),
      cfg({ weight_personalization: 2, weight_categories: 1, weight_author: 0 }),
      null,
      CAND_ID,
      { userProfile: profile },
      NOW,
    );
    expect(scored.breakdown.categories).toBe(0);
    expect(scored.breakdown.personalization).toBeCloseTo(1, 10);
  });
});

describe("scoreRelated (legacy) - zgodność z scorerem v2", () => {
  it("domyka brakujące wagi defaultami i zwraca tę samą sumę co v2", () => {
    const legacy = scoreRelated(
      current(),
      candidate(),
      { source_strategy: "both", recency_boost_days: 0 },
      null,
      NOW,
    );
    const v2 = scoreRelatedDetailed(
      current(),
      candidate(),
      cfg({
        weight_categories: RELATED_POSTS_DEFAULTS.weight_categories,
        weight_tags: RELATED_POSTS_DEFAULTS.weight_tags,
        weight_author: RELATED_POSTS_DEFAULTS.weight_author,
        weight_recency: RELATED_POSTS_DEFAULTS.weight_recency,
      }),
      null,
      undefined,
      undefined,
      NOW,
    );
    expect(legacy).toBeCloseTo(v2.total, 10);
    expect(legacy).toBeGreaterThan(0);
  });

  it("legacy zeruje sygnały v2 (popularność, dwell, personalizacja) - nie ma skąd ich wziąć", () => {
    const legacy = scoreRelated(
      current(),
      candidate(),
      { source_strategy: "both", recency_boost_days: 0, weight_popularity: 9, weight_dwell: 9 },
      null,
      NOW,
    );
    const withoutSignals = scoreRelated(
      current(),
      candidate(),
      { source_strategy: "both", recency_boost_days: 0 },
      null,
      NOW,
    );
    expect(legacy).toBeCloseTo(withoutSignals, 10);
    expect(Number.isFinite(legacy)).toBe(true);
  });
});
