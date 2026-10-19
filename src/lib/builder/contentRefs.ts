// Live content reference resolvers for builder widgets.
// Any widget that points at a post/page/category/tag should run its display
// data through these hooks so editing the source entity propagates instantly
// (covers, titles, excerpts, hrefs, taxonomy labels) without duplicating
// payload in widget JSON.
//
// Cache keys are stable + lang-scoped so a single invalidate({ queryKey:
// ["post-ref"] }) refreshes every widget on the page.

import { useCallback, useMemo } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { edgeTtlCache } from "@/lib/ssrCache";
import { WIDGET_QUERY_ROOTS } from "./queryKeys";

export type Lang = "pl" | "en";

export interface PostRefData {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover: string;
  href: string;
  publishedAt: string | null;
  authorName: string;
  authorAvatar: string;
  authorSlug: string;
}

const POST_REF_STALE = 60_000; // 1 min - aggressive enough to feel "live"
const POST_REF_GC = 5 * 60_000;

interface RawPostRow {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  author_id: string | null;
}

/** Wynik odczytu z flagą odmowy: "nie wiem" (`refused`) to co innego niż "nie ma". */
interface Fetched<T> {
  value: T;
  refused: boolean;
}

async function fetchPostRef(id: string): Promise<Fetched<RawPostRow | null>> {
  const { data, error } = await supabase
    .from("posts")
    .select(
      "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, author_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return { value: null, refused: true };
  return { value: (data as RawPostRow | null) ?? null, refused: false };
}

interface AuthorInfo {
  name: string;
  avatar: string;
  slug: string;
}

const EMPTY_AUTHOR: AuthorInfo = { name: "", avatar: "", slug: "" };

async function fetchAuthorInfo(id: string | null): Promise<Fetched<AuthorInfo>> {
  if (!id) return { value: EMPTY_AUTHOR, refused: false };
  // profiles_public: publiczna projekcja profilu (ta sama, którą czyta cała
  // powierzchnia publiczna) zamiast pełnej tabeli `profiles` - lżejszy wiersz,
  // spójny kontrakt widoczności.
  const { data, error } = await supabase
    .from("profiles_public")
    .select("display_name, avatar_url, slug")
    .eq("id", id)
    .maybeSingle();
  const row = data as {
    display_name: string | null;
    avatar_url: string | null;
    slug: string | null;
  } | null;
  return {
    value: {
      name: row?.display_name ?? "",
      avatar: row?.avatar_url ?? "",
      slug: row?.slug ?? "",
    },
    refused: Boolean(error),
  };
}

/** Wpis + autor jednym pakietem (niezależnym od języka - mapowanie na wariant
 *  PL/EN robi `toPostRef` po odczycie, więc oba języki dzielą jeden wpis TTL). */
interface PostRefBundle {
  row: RawPostRow | null;
  author: AuthorInfo;
}

/**
 * Pakiet złożony z ODMOWY bazy. Rzucany wewnątrz fetchera `edgeTtlCache`, żeby
 * magazyn go NIE zapisał (rzut = brak wpisu), i łapany zaraz na zewnątrz, żeby
 * widget dostał tę samą degradację co dotąd (brak wpisu / brak autora).
 */
class RefusedPostRefBundle extends Error {
  constructor(readonly bundle: PostRefBundle) {
    super("post-ref: odmowa odczytu - wynik nie trafia do cache");
  }
}

/**
 * Referencja wpisu JEDNYM round-tripem: RPC `get_post_refs` (migracja
 * 20260724151000, join wpis + publiczny profil autora w bazie). Wcześniej
 * każdy referowany wpis slidera kosztował dwa SEKWENCYJNE round-tripy
 * (wpis -> autor). Fallback dwuetapowy zostaje na okno wdrożeniowe migracji;
 * całość za edgeTtlCache per tenant host (klucz per id, wspólny dla języków).
 */
async function fetchPostRefBundle(id: string): Promise<PostRefBundle> {
  // "Nie wiem" (odmowa) to nie "nie ma": pakiet z odmowy nie może zamrozić
  // "wpisu nie ma" na TTL + okno serve-stale dla całego hosta, więc omija
  // magazyn, a następny odczyt pyta bazę ponownie.
  return cachedPostRefBundle(id).catch((err: unknown) => {
    if (err instanceof RefusedPostRefBundle) return err.bundle;
    throw err;
  });
}

function cachedPostRefBundle(id: string): Promise<PostRefBundle> {
  return edgeTtlCache(
    `builder:post-ref:${id}`,
    POST_REF_STALE,
    async (): Promise<PostRefBundle> => {
      // Cast przez `unknown`: wygenerowane typy Supabase nie znają jeszcze
      // funkcji z migracji 20260724151000 (regeneracja typów po jej wdrożeniu).
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: { _post_ids: string[] },
        ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
      )("get_post_refs", { _post_ids: [id] });
      if (!error && Array.isArray(data)) {
        const row = (data[0] ?? null) as
          | (RawPostRow & {
              author_name: string | null;
              author_avatar: string | null;
              author_slug: string | null;
            })
          | null;
        if (!row) return { row: null, author: EMPTY_AUTHOR };
        return {
          row,
          author: {
            name: row.author_name ?? "",
            avatar: row.author_avatar ?? "",
            slug: row.author_slug ?? "",
          },
        };
      }
      const row = await fetchPostRef(id);
      const author = await fetchAuthorInfo(row.value?.author_id ?? null);
      const bundle = { row: row.value, author: author.value };
      if (row.refused || author.refused) throw new RefusedPostRefBundle(bundle);
      return bundle;
    },
  );
}

function toPostRef(row: RawPostRow | null, author: AuthorInfo, lang: Lang): PostRefData | null {
  if (!row) return null;
  // `||`, nie `??`: pusty napis to BRAK tłumaczenia (jak `pickI18n` i
  // `postRefsForLang`), więc pusty tytuł EN spada na PL zamiast dziury w slajdzie.
  const title = (lang === "en" ? row.title_en : row.title_pl) || row.title_pl || row.title_en || "";
  const excerpt =
    (lang === "en" ? row.excerpt_en : row.excerpt_pl) || row.excerpt_pl || row.excerpt_en || "";
  return {
    id: row.id,
    slug: row.slug,
    title,
    excerpt,
    cover: row.cover_image_url ?? "",
    href: `/post/${row.slug}`,
    publishedAt: row.published_at,
    authorName: author.name,
    authorAvatar: author.avatar,
    authorSlug: author.slug,
  };
}

export function postRefQueryOptions(id: string | null | undefined, lang: Lang) {
  return {
    queryKey: [WIDGET_QUERY_ROOTS.postRef, id ?? "", lang] as const,
    queryFn: async (): Promise<PostRefData | null> => {
      if (!id) return null;
      const bundle = await fetchPostRefBundle(id);
      return toPostRef(bundle.row, bundle.author, lang);
    },
    enabled: Boolean(id),
    staleTime: POST_REF_STALE,
    gcTime: POST_REF_GC,
  };
}

/**
 * Identyfikatory wpisów po normalizacji (trim), bez pustych, nie-napisów
 * i powtórzeń - w kolejności wejścia. JEDNA funkcja dla hooka i rejestru
 * prefetchu SSR (`prefetch.ts`), więc serwer grzeje dokładnie te klucze
 * `post-ref`, które klient potem czyta.
 */
export function uniquePostRefIds(ids: ReadonlyArray<unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const normalized = typeof id === "string" ? id.trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * Batch resolver - one query per id, dedup'd before useQueries receives keys.
 *
 * Mapa jest kluczowana identyfikatorem W POSTACI, W JAKIEJ GO PODANO (konsument
 * czyta `refMap.get(it.postId)` surowym id), a zapytanie idzie po id
 * znormalizowanym - więc `" p1 "` z wklejki trafia ten sam wpis co `"p1"`.
 * Mapa jest stabilna referencyjnie, dopóki nie zmienią się id ani dane, więc
 * `useMemo` konsumenta nie przelicza slajdów na każdym renderze.
 */
export function useResolvedPostRefs(ids: ReadonlyArray<string | null | undefined>, lang: Lang) {
  // Tekstowy klucz wejścia: nowa tablica o tej samej treści nie zmienia wyniku.
  const requestedKey = JSON.stringify(ids.map((id) => (typeof id === "string" ? id : null)));
  const requested = useMemo(() => JSON.parse(requestedKey) as Array<string | null>, [requestedKey]);
  const uniqueIds = useMemo(() => uniquePostRefIds(requested), [requested]);
  const combine = useCallback(
    (results: Array<UseQueryResult<PostRefData | null>>) => {
      const byNormalized = new Map<string, PostRefData>();
      results.forEach((r, i) => {
        if (r.data) byNormalized.set(uniqueIds[i], r.data);
      });
      const map = new Map<string, PostRefData>();
      for (const id of requested) {
        const ref = id === null ? undefined : byNormalized.get(id.trim());
        if (id !== null && ref) map.set(id, ref);
      }
      return map;
    },
    [requested, uniqueIds],
  );
  return useQueries({
    queries: uniqueIds.map((id) => postRefQueryOptions(id, lang)),
    combine,
  });
}

/**
 * Invalidate every widget cache that consumes live entity refs.
 *
 * Re-exported from `queryKeys.ts`, which derives the set from the SAME string
 * constants the query modules use in their `queryKey`. Maintaining the list by
 * hand here previously let it drift: five roots ("post-list", "news-ticker",
 * "rated-list", "categories-widget", "tags-widget") matched no live query, so
 * realtime invalidation silently skipped those widgets.
 */
export { WIDGET_LIVE_QUERY_PREFIXES } from "./queryKeys";
