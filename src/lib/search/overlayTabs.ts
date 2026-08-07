// Zakładki wyszukiwarki overlay: wpisy / tematyka / osoby (sieć kontaktów) /
// eksperci. Jedno zapytanie React Query pobiera równolegle wszystkie sekcje,
// dzięki czemu liczniki przy zakładkach są prawdziwe, a przełączanie zakładek
// nie odpala nowych round-tripów. Każde źródło jest odporne na brak funkcji
// w bazie (fallback do pustej sekcji) - overlay nie może się wywracać.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const OVERLAY_TABS = ["posts", "topics", "clubs", "people", "experts"] as const;
export type OverlayTab = (typeof OVERLAY_TABS)[number];

export interface OverlayHit {
  id: string;
  label: string;
  meta: string | null;
  href: string;
  avatarUrl: string | null;
}

export type OverlayResults = Record<OverlayTab, OverlayHit[]>;

export const emptyOverlayResults = (): OverlayResults => ({
  posts: [],
  topics: [],
  clubs: [],
  people: [],
  experts: [],
});

type Lang = "pl" | "en";

const pick = (lang: Lang, pl: string | null, en: string | null): string =>
  (lang === "en" ? en || pl : pl || en) || "";

async function fetchPosts(q: string, lang: Lang, limit: number): Promise<OverlayHit[]> {
  const { data, error } = await supabase.rpc("search_posts", { _q: q, _limit: limit });
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id,
    label: pick(lang, r.title_pl, r.title_en),
    meta: pick(lang, r.excerpt_pl, r.excerpt_en) || null,
    href: `/post/${r.slug}`,
    avatarUrl: null,
  }));
}

async function fetchTopics(q: string, lang: Lang, limit: number): Promise<OverlayHit[]> {
  const like = `%${q}%`;
  const [cats, tags] = await Promise.all([
    supabase
      .from("categories")
      .select("id, slug, name_pl, name_en")
      .or(`name_pl.ilike.${like},name_en.ilike.${like},slug.ilike.${like}`)
      .limit(limit),
    supabase
      .from("tags")
      .select("id, slug, name")
      .or(`name.ilike.${like},slug.ilike.${like}`)
      .limit(limit),
  ]);
  const out: OverlayHit[] = [];
  for (const c of cats.data ?? []) {
    out.push({
      id: `cat-${c.id}`,
      label: pick(lang, c.name_pl, c.name_en),
      meta: null,
      href: `/category/${c.slug}`,
      avatarUrl: null,
    });
  }
  for (const tg of tags.data ?? []) {
    out.push({
      id: `tag-${tg.id}`,
      label: tg.name,
      meta: null,
      href: `/tag/${tg.slug}`,
      avatarUrl: null,
    });
  }
  return out.slice(0, limit);
}

/**
 * Wątki klubów. RPC filtruje po club_capabilities per wątek, więc do overlaya
 * trafia wyłącznie to, co wolający i tak może przeczytać - sekcja nie zdradza
 * istnienia klubu zamkniętego. Brak funkcji w bazie (starsze wdrożenie) kończy
 * się pustą sekcją, tak samo jak reszta źródeł.
 */
async function fetchClubs(q: string, limit: number): Promise<OverlayHit[]> {
  const { data, error } = await supabase.rpc("club_search", {
    p_query: q,
    p_club_id: undefined,
    p_limit: limit,
  });
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.thread_id,
    label: r.title,
    // Snippet z ts_headline niesie znaczniki <b>; overlay renderuje tekst,
    // więc zdejmujemy je tutaj zamiast wstrzykiwać HTML do listy wyników.
    meta: (r.snippet ?? "").replace(/<\/?b>/g, "") || null,
    href: `/club/${r.club_slug}/t/${r.thread_slug}`,
    avatarUrl: null,
  }));
}

async function fetchPeople(q: string, limit: number): Promise<OverlayHit[]> {
  // Pełny zestaw argumentów: 2-argumentowe wywołanie jest niejednoznaczne
  // między przeciążeniami search_people (42725).
  const { data, error } = await supabase.rpc("search_people", {
    p_query: q,
    p_limit: limit,
    p_offset: 0,
    p_verified_only: false,
  });
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id,
    label: r.display_name ?? "",
    meta: [r.job_title, r.current_company].filter(Boolean).join(" - ") || null,
    href: r.slug ? `/author/${r.slug}` : `/people?q=${encodeURIComponent(q)}`,
    avatarUrl: r.avatar_url ?? null,
  }));
}

async function fetchExperts(q: string, lang: Lang, limit: number): Promise<OverlayHit[]> {
  const { data, error } = await supabase.rpc("search_people_orgs", { _q: q, _limit: limit });
  if (error) return [];
  return (data ?? [])
    .filter((r) => (r.kind ?? "person") === "person")
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      label: pick(lang, r.label_pl, r.label_en),
      meta: pick(lang, r.sublabel_pl, r.sublabel_en) || null,
      href: `/author/${r.slug ?? r.id}`,
      avatarUrl: r.avatar_url ?? null,
    }));
}

export const overlaySearchQueryOptions = (q: string, lang: Lang, limit: number) =>
  queryOptions({
    queryKey: ["search-overlay-tabs", q, lang, limit] as const,
    enabled: q.length >= 2,
    staleTime: 60_000,
    queryFn: async (): Promise<OverlayResults> => {
      const [posts, topics, clubs, people, experts] = await Promise.all([
        fetchPosts(q, lang, limit).catch(() => []),
        fetchTopics(q, lang, limit).catch(() => []),
        fetchClubs(q, limit).catch(() => []),
        fetchPeople(q, limit).catch(() => []),
        fetchExperts(q, lang, limit).catch(() => []),
      ]);
      return { posts, topics, clubs, people, experts };
    },
  });

/** Pierwsza zakładka z wynikami - domyślny wybór po wpisaniu frazy. */
export function firstNonEmptyTab(results: OverlayResults, current: OverlayTab): OverlayTab {
  if (results[current].length > 0) return current;
  return OVERLAY_TABS.find((tab) => results[tab].length > 0) ?? current;
}
