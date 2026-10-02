// Server function: sugestie linków wewnętrznych dla edytora SEO.
// Zwraca do N kandydatów z tenanta bieżącego użytkownika, dopasowanych po
// wspólnych kategoriach/tagach oraz FTS po `posts.search_vector` (tytuł, slug,
// lead, treść). Wynik służy do szybkiego wstawiania linków między analizami
// (SEO/related-content).
//
// BŁĄD ZAPYTANIA NIE JEST PUSTĄ LISTĄ. Każda odpowiedź Supabase jest
// sprawdzana na `error`; awaria (padnięty FTS, cofnięty grant, timeout)
// kończy się wyjątkiem `LinkSuggestionsQueryError` i wpisem w log serwera.
// Pusta lista znaczy wyłącznie „zapytania przeszły i nic nie pasuje" (albo
// „profil bez tenanta" - świadoma odmowa, nie awaria). Bez tego rozróżnienia
// redakcja widziała „brak dopasowań" przy niedziałającym narzędziu
// i przestawała linkować wewnętrznie.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type PostsRow = Database["public"]["Tables"]["posts"]["Row"];

/**
 * Kolumna tsvector tabeli `posts`, w którą celuje FTS. Jedyna taka kolumna
 * w schemacie (`20260628210000_fulltext_search.sql`; trigger
 * `posts_search_vector_tg`). `satisfies keyof PostsRow` wiąże nazwę z
 * wygenerowanymi typami - literówka albo zmiana nazwy kolumny wywala tsc,
 * zamiast dawać 42703 „column does not exist" przy każdym wywołaniu.
 */
export const FTS_COLUMN = "search_vector" satisfies keyof PostsRow;

/**
 * Górna granica kandydatów w finalnym `.in("id", ids)`. Powiązania z
 * kategorii i tagów nie mają limitu (do `max_rows` wierszy), a każdy uuid to
 * ~37 znaków w URL GET - popularna kategoria dawała 414 na bramie. Wynik i tak
 * tnie się do `limit` (≤ 20), więc do selecta idą najlepiej punktowani.
 */
export const MAX_FINAL_CANDIDATES = 100;

const Input = z.object({
  postId: z.string().uuid().nullable().optional(),
  titlePl: z.string().max(500).nullable().optional(),
  titleEn: z.string().max(500).nullable().optional(),
  contentPl: z.string().max(20000).nullable().optional(),
  contentEn: z.string().max(20000).nullable().optional(),
  categoryIds: z.array(z.string().uuid()).max(50).optional(),
  tagIds: z.array(z.string().uuid()).max(200).optional(),
  limit: z.number().int().min(1).max(20).default(8),
});

export interface LinkSuggestion {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  score: number;
  reasons: string[];
}

/**
 * Prefiks kodu w treści wyjątku. Wzorzec `E_CSRF`/`E_RATE_LIMIT` z
 * `src/lib/errors/serverErrors.ts`: klasa błędu nie przeżywa serializacji
 * granicy server fn, a treść komunikatu - tak, więc klient może rozpoznać
 * awarię po prefiksie bez parsowania komunikatu bazy.
 */
export const LINK_SUGGESTIONS_QUERY_FAILED = "E_LINK_SUGGESTIONS_QUERY";

/** Które zapytanie handlera padło - trafia do logu i do treści wyjątku. */
export type LinkSuggestionsStage = "profile" | "categories" | "tags" | "fts" | "posts";

/**
 * Awaria zapytania handlera. Treść to WYŁĄCZNIE `kod: etap` - komunikat bazy
 * (nazwy kolumn, polityk, fragmenty SQL) zostaje w logu serwera i nie wychodzi
 * do przeglądarki.
 */
export class LinkSuggestionsQueryError extends Error {
  readonly code = LINK_SUGGESTIONS_QUERY_FAILED;
  readonly stage: LinkSuggestionsStage;
  constructor(stage: LinkSuggestionsStage) {
    super(`${LINK_SUGGESTIONS_QUERY_FAILED}: ${stage}`);
    this.name = "LinkSuggestionsQueryError";
    this.stage = stage;
  }
}

/**
 * Loguje awarię i rzuca typowany wyjątek. W logu: etap, kod i komunikat
 * PostgREST - bez identyfikatora użytkownika, tenanta i treści szkicu
 * (tytuł/treść to dane redakcyjne, nie diagnostyka).
 */
function failQuery(stage: LinkSuggestionsStage, error: { message: string; code?: string }): never {
  console.error("[linkSuggestions] query failed", {
    stage,
    code: error.code ?? null,
    message: error.message,
  });
  throw new LinkSuggestionsQueryError(stage);
}

/**
 * Litery, których NFD nie rozkłada na bazę + znak diakrytyczny, a które
 * `unaccent` po stronie bazy i tak zamienia. `ł` nie ma rozkładu
 * kanonicznego, więc bez tej mapy „ładzie" zostałoby `ładzie`, a w wektorze
 * jest `ladzie` - token nie trafiłby w żaden wpis.
 */
const UNACCENT_EXTRA: Record<string, string> = {
  ł: "l",
  đ: "d",
  ħ: "h",
  ı: "i",
  ø: "o",
  ß: "ss",
  æ: "ae",
  œ: "oe",
};

/**
 * Odpowiednik `unaccent(lower(...))` z `nes_posts_search_vector`: wektor
 * budowany jest jako `to_tsvector('simple', unaccent(...))`, więc w bazie nie
 * ma leksemu `komisją`, jest `komisja`. Token z diakrytykami nie trafiłby
 * w żaden wpis.
 */
function unaccentLower(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFD")
      // Tylko blok łączących znaków diakrytycznych (ogonek, kreska, kropka,
      // daszek). Szerokie `\p{Diacritic}` zjadłoby też samodzielne „^" czy
      // „`" i skleiło sąsiednie słowa w jeden token.
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[łđħıøßæœ]/g, (ch) => UNACCENT_EXTRA[ch] ?? ch)
      .normalize("NFC")
  );
}

function tokens(...values: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const raw of values) {
    if (!raw) continue;
    const stripped = unaccentLower(raw.replace(/<[^>]+>/g, " "));
    for (const t of stripped.split(/[^\p{L}\p{N}]+/u)) {
      if (t.length >= 4) out.add(t);
    }
  }
  return Array.from(out).slice(0, 12);
}

export const suggestInternalLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<LinkSuggestion[]> => {
    const { supabase, userId } = context;
    const { postId, titlePl, titleEn, contentPl, contentEn, categoryIds, tagIds, limit } = data;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) failQuery("profile", profileError);
    const tenantId = profile?.tenant_id;
    // Profil bez tenanta to odmowa, nie awaria: bez tenanta nie da się
    // ograniczyć zakresu, więc żadne zapytanie o wpisy nie leci.
    if (!tenantId) return [];

    const searchTokens = tokens(
      titlePl,
      titleEn,
      contentPl?.slice(0, 4000),
      contentEn?.slice(0, 4000),
    );

    const scores = new Map<string, { score: number; reasons: Set<string> }>();
    const bump = (id: string, s: number, reason: string) => {
      const cur = scores.get(id) ?? { score: 0, reasons: new Set<string>() };
      cur.score += s;
      cur.reasons.add(reason);
      scores.set(id, cur);
    };

    // Trzy źródła kandydatów są od siebie niezależne (żadne nie czyta wyniku
    // innego), więc idą RÓWNOLEGLE - jedna runda do bazy zamiast trzech
    // kolejnych. Builder PostgREST jest leniwy (wysyła żądanie dopiero przy
    // `then`), więc kolejność wywołań `from()` i postać łańcuchów się nie
    // zmieniają. Gałąź bez wejścia daje `null` i nie generuje zapytania.
    const [categoryRes, tagRes, ftsRes] = await Promise.all([
      categoryIds?.length
        ? supabase
            .from("post_categories")
            .select("post_id, category_id")
            .in("category_id", categoryIds)
        : null,
      tagIds?.length
        ? supabase.from("post_tags").select("post_id, tag_id").in("tag_id", tagIds)
        : null,
      searchTokens.length
        ? supabase
            .from("posts")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("status", "published")
            // Surowe `to_tsquery` (bez `type`): ` | ` to tu OR, więc wystarczy
            // JEDEN wspólny token. `websearch` traktuje `|` jak interpunkcję
            // i daje AND wszystkich tokenów - wpis musiałby zawierać każde
            // z 12 słów. Tokeny mają wyłącznie \p{L}\p{N}, więc nie wnoszą
            // składni tsquery.
            .textSearch(FTS_COLUMN, searchTokens.join(" | "), { config: "simple" })
            .limit(40)
        : null,
    ]);
    // Błędy sprawdzane w stałej kolejności, żeby etap w wyjątku był
    // deterministyczny. Częściowy wynik NIE wychodzi: punktacja policzona bez
    // jednego źródła to też nieprawdziwa odpowiedź, tylko trudniejsza do
    // zauważenia niż pusta lista.
    if (categoryRes?.error) failQuery("categories", categoryRes.error);
    if (tagRes?.error) failQuery("tags", tagRes.error);
    if (ftsRes?.error) failQuery("fts", ftsRes.error);

    for (const r of categoryRes?.data ?? []) {
      if (r.post_id === postId) continue;
      bump(r.post_id, 4, "category");
    }
    for (const r of tagRes?.data ?? []) {
      if (r.post_id === postId) continue;
      bump(r.post_id, 3, "tag");
    }
    for (const r of ftsRes?.data ?? []) {
      if (r.id === postId) continue;
      bump(r.id, 2, "content");
    }

    if (scores.size === 0) return [];

    // Do selecta idą najlepiej punktowani; sortowanie stabilne, więc przy
    // remisie wygrywa kolejność źródeł (kategorie → tagi → FTS).
    const ids = Array.from(scores.entries())
      .sort(([, a], [, b]) => b.score - a.score)
      .slice(0, MAX_FINAL_CANDIDATES)
      .map(([id]) => id);
    const { data: posts, error: postsError } = await supabase
      .from("posts")
      .select("id, slug, title_pl, title_en, excerpt_pl, status, tenant_id")
      .in("id", ids)
      .eq("tenant_id", tenantId)
      .eq("status", "published");
    if (postsError) failQuery("posts", postsError);

    const out: LinkSuggestion[] = (posts ?? []).map((p) => {
      const s = scores.get(p.id)!;
      return {
        id: p.id,
        slug: p.slug,
        title_pl: p.title_pl,
        title_en: p.title_en,
        excerpt_pl: p.excerpt_pl,
        score: s.score,
        reasons: Array.from(s.reasons),
      };
    });

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  });
