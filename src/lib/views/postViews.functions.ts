// Server functions: post view counter + Trending list.
//
// `recordPostView` - anti-spammed by viewer-hash + 5-min window inside the
//                    SECURITY DEFINER SQL function (`public.record_post_view`).
//                    No auth required: anonymous reads count too.
// `getTrendingPosts` - top published posts by view count in the last N days.
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";
import { edgeTtlCache } from "@/lib/ssrCache";

// Anon client running UNDER RLS: public_tenant_id() (and with it
// trending_posts + the "Public reads published posts" policy) resolves the
// tenant of the site being browsed. fetchWithTenantHost dokleja x-tenant-host
// z bieżącego żądania - bez niego public_tenant_id() zawsze zwraca
// DOMYŚLNEGO tenanta (patrz tenant-host-fetch.ts).
function createAnonClient() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTenantHost },
  });
}

// JEDEN klient na izolat, tworzony LENIWIE.
//
// PO CO. `client()` był wołany W ŚRODKU handlera, więc każde `recordPostView`
// - a to najgorętsze wywołanie tego modułu, jedno na odsłonę artykułu -
// budowało nowego klienta Supabase od zera.
//
// DLACZEGO TO JEST BEZPIECZNE W IZOLACIE WIELOTENANTOWYM, a to jest tu jedyne
// pytanie, które się liczy: jeden izolat Workers obsługuje RÓWNOLEGLE żądania
// z różnych domen, więc współdzielony klient musiałby nie nieść ŻADNEGO stanu
// żądania. I nie niesie:
//   * nagłówki egzemplarza to sam `X-Client-Info` - opcje globalne wyżej nie
//     ustawiają `headers`, a `x-tenant-host` i `x-tenant-assert` dokleja
//     `fetchWithTenantHost` PER WYWOŁANIE, czytając kontekst bieżącego żądania
//     (patrz `integrations/supabase/tenant-host-fetch.ts`), nie kontekst z
//     chwili konstrukcji;
//   * `persistSession: false` daje storage PAMIĘCIOWY, do którego ten moduł
//     nigdy nie pisze (nie ma tu żadnego `sb.auth.*`), więc `Authorization`
//     to zawsze klucz anon - nie ma czego przeciec między tenantami.
// Dowodem jest `__tests__/postViewsClientReuse.test.ts`: dwa żądania z RÓŻNYCH
// hostów dostają różne nagłówki tenanta z TEGO SAMEGO egzemplarza klienta.
//
// LENIWIE, nie `const` na poziomie modułu: `createClient` rzuca przy braku
// `SUPABASE_URL`, a przy inicjalizacji modułu ten wyjątek wywróciłby CAŁY chunk
// (plik wisi w grafie strony wpisu przez `useRecordPostView`) zamiast jednego
// wywołania server function. Ten sam wzorzec, co
// `src/lib/auth/optionalUser.server.ts` i `src/integrations/supabase/client.ts`.
//
// UCZCIWIE O WIELKOŚCI ZYSKU: to jest oszczędność CPU, nie latencji.
// Konstrukcja klienta jest o dwa rzędy wielkości tańsza niż round-trip do
// Supabase, więc na czasie ściany nie widać jej wcale. Uzasadnia ją model
// rozliczeniowy Workers, w którym czas CPU jest zasobem bilowanym i
// limitowanym - a nie „szybciej wczyta się strona".
let cachedClient: ReturnType<typeof createAnonClient> | undefined;

function client(): ReturnType<typeof createAnonClient> {
  cachedClient ??= createAnonClient();
  return cachedClient;
}

const recordSchema = z.object({
  postId: z.string().uuid(),
  viewerHash: z.string().min(16).max(64),
});

export const recordPostView = createServerFn({ method: "POST" })
  .validator((d) => recordSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const sb = client();
    const { error } = await sb.rpc("record_post_view", {
      _post_id: data.postId,
      _viewer_hash: data.viewerHash,
    });
    if (error) {
      // Surface the error in logs but never block the page render.
      console.warn("record_post_view failed:", error.message);
    }
    return { ok: true };
  });

export interface TrendingPost {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  cover_image_url: string | null;
  published_at: string | null;
  parent_page_id: string;
  views_count: number;
  href: string;
  /** Autor wpisu (profiles.display_name / avatar_url) - używany przez styl `glassLive`. */
  author_display_name: string | null;
  author_avatar_url: string | null;
}

interface AuthorRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * Autorzy paska JEDNYM round-tripem: RPC `get_post_refs` (join wpis +
 * `profiles_public`). NIE wolno tu czytać `profiles` - ta tabela ma politykę
 * SELECT wyłącznie dla zalogowanych (self/staff), więc render anonimowy (SSR
 * strony głównej) dostawał pustą listę i pasek szedł bez autora.
 */
async function resolveAuthors(
  sb: ReturnType<typeof client>,
  postIds: readonly string[],
): Promise<Map<string, AuthorRow>> {
  const out = new Map<string, AuthorRow>();
  const ids = Array.from(new Set(postIds.filter(Boolean)));
  if (!ids.length) return out;
  // Bez rzutowania: `get_post_refs` jest już w wygenerowanych typach
  // (Args: { _post_ids: string[] }), więc `sb.rpc` typuje to wywołanie samo.
  // Rzutowanie przez `unknown` pochodziło z czasów, gdy funkcji w typach nie było,
  // i przeżyło regenerację - dokładnie klasa długu, którą pilnuje
  // `check:unknown-casts`.
  const { data, error } = await sb.rpc("get_post_refs", { _post_ids: ids });
  if (error || !Array.isArray(data)) {
    if (error) console.warn("get_post_refs failed:", error.message);
    return out;
  }
  for (const row of data as Array<{
    id: string;
    author_id: string | null;
    author_name: string | null;
    author_avatar: string | null;
  }>) {
    if (!row.author_name && !row.author_avatar) continue;
    out.set(row.id, {
      id: row.author_id ?? row.id,
      display_name: row.author_name,
      avatar_url: row.author_avatar,
    });
  }
  return out;
}

// Posts in one list overwhelmingly share a handful of parent pages, and
// page_full_path is one DB round-trip per call - resolving it per POST (the
// previous sequential loop) made the ticker cost 1+N round-trips and show up
// seconds after the rest of the header. Dedupe to unique parent ids and
// resolve them in parallel: worst case one extra round-trip of latency total.
async function resolveParentPaths(
  sb: ReturnType<typeof client>,
  parentPageIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(parentPageIds.filter((id): id is string => !!id)));
  const entries = await Promise.all(
    unique.map(async (id) => {
      const { data } = await sb.rpc("page_full_path", { _page_id: id });
      return [id, typeof data === "string" ? data : ""] as const;
    }),
  );
  return new Map(entries);
}

function postHref(
  paths: Map<string, string>,
  parentPageId: string | null | undefined,
  slug: string,
): string {
  const path = parentPageId ? paths.get(parentPageId) : "";
  return path ? `/${path}/${slug}` : `/post/${slug}`;
}

// Anonymous, tenant-wide lists: keep them warm per isolate so repeat SSR
// renders (and the client HTTP calls hitting this server fn) skip Supabase
// entirely inside the TTL window. edgeTtlCache scopes every entry by the
// request host, so tenants never share a warm entry.
const TICKER_TTL_MS = 60_000;

const trendingSchema = z.object({
  days: z.number().int().min(1).max(90).default(7),
  limit: z.number().int().min(1).max(50).default(10),
});

export const getTrendingPosts = createServerFn({ method: "GET" })
  .validator((d) => trendingSchema.parse(d))
  .handler(async ({ data }): Promise<TrendingPost[]> =>
    edgeTtlCache(`trending_posts:${data.days}:${data.limit}`, TICKER_TTL_MS, async () => {
      const sb = client();
      const { data: rows, error } = await sb.rpc("trending_posts", {
        _days: data.days,
        _limit: data.limit,
      });
      if (error) {
        console.warn("trending_posts failed:", error.message);
        return [];
      }
      const [paths, authors] = await Promise.all([
        resolveParentPaths(
          sb,
          (rows ?? []).map((r) => r.parent_page_id),
        ),
        resolveAuthors(
          sb,
          (rows ?? []).map((r) => r.id),
        ),
      ]);
      return (rows ?? []).map((r) => ({
        id: r.id,
        slug: r.slug,
        title_pl: r.title_pl,
        title_en: r.title_en,
        cover_image_url: r.cover_image_url,
        published_at: r.published_at,
        parent_page_id: r.parent_page_id,
        views_count: Number(r.views_count ?? 0),
        href: postHref(paths, r.parent_page_id, r.slug),
        author_display_name: authors.get(r.id)?.display_name ?? null,
        author_avatar_url: authors.get(r.id)?.avatar_url ?? null,
      }));
    }),
  );

// Latest / pinned / selected / mixed posts for the header ticker. Reuses
// TrendingPost shape so the UI can swap sources without per-mode branching.
const tickerSchema = z.object({
  source: z.enum(["latest", "pinned", "selected", "mixed"]),
  limit: z.number().int().min(1).max(50).default(8),
  days: z.number().int().min(1).max(90).optional(),
  pinnedPostId: z.string().uuid().optional(),
  selectedPostIds: z.array(z.string().uuid()).max(3).optional(),
  mixedFill: z.enum(["trending", "latest"]).optional(),
});

type TickerRow = {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  parent_page_id: string;
};

async function toTrendingPosts(
  sb: ReturnType<typeof client>,
  rows: TickerRow[],
): Promise<TrendingPost[]> {
  const [paths, authors] = await Promise.all([
    resolveParentPaths(
      sb,
      rows.map((r) => r.parent_page_id),
    ),
    resolveAuthors(
      sb,
      rows.map((r) => r.id),
    ),
  ]);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title_pl: r.title_pl ?? "",
    title_en: r.title_en ?? "",
    cover_image_url: r.cover_image_url,
    published_at: r.published_at,
    parent_page_id: r.parent_page_id,
    views_count: 0,
    href: postHref(paths, r.parent_page_id, r.slug),
    author_display_name: authors.get(r.id)?.display_name ?? null,
    author_avatar_url: authors.get(r.id)?.avatar_url ?? null,
  }));
}

export const getTickerPosts = createServerFn({ method: "GET" })
  .validator((d) => tickerSchema.parse(d))
  .handler(async ({ data }): Promise<TrendingPost[]> =>
    edgeTtlCache(
      `ticker_posts:${data.source}:${data.limit}:${data.days ?? ""}:${data.pinnedPostId ?? ""}:${(data.selectedPostIds ?? []).join(",")}:${data.mixedFill ?? ""}`,
      TICKER_TTL_MS,
      async () => {
        const sb = client();

        if (data.source === "mixed") {
          const pinnedIds = [
            ...(data.selectedPostIds ?? []),
            ...(data.pinnedPostId ? [data.pinnedPostId] : []),
          ].filter((v, i, a) => a.indexOf(v) === i);

          let pinnedRows: TickerRow[] = [];
          if (pinnedIds.length) {
            const { data: rows, error } = await sb
              .from("posts")
              .select("id,slug,title_pl,title_en,cover_image_url,published_at,parent_page_id")
              .in("id", pinnedIds)
              .eq("status", "published")
              .is("deleted_at", null);
            if (error) {
              console.warn("getTickerPosts(mixed:pinned) failed:", error.message);
            } else {
              const order = new Map(pinnedIds.map((id, i) => [id, i]));
              pinnedRows = (rows ?? []).sort(
                (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
              );
            }
          }

          const remaining = Math.max(0, data.limit - pinnedRows.length);
          let fillRows: TickerRow[] = [];
          if (remaining > 0) {
            if ((data.mixedFill ?? "trending") === "trending") {
              const { data: rows, error } = await sb.rpc("trending_posts", {
                _days: data.days ?? 7,
                _limit: remaining + pinnedRows.length,
              });
              if (error) {
                console.warn("getTickerPosts(mixed:trending) failed:", error.message);
              } else {
                fillRows = (rows ?? [])
                  .filter((r) => !pinnedRows.some((p) => p.id === r.id))
                  .slice(0, remaining)
                  .map((r) => ({
                    id: r.id,
                    slug: r.slug,
                    title_pl: r.title_pl,
                    title_en: r.title_en,
                    cover_image_url: r.cover_image_url,
                    published_at: r.published_at,
                    parent_page_id: r.parent_page_id,
                  }));
              }
            } else {
              const { data: rows, error } = await sb
                .from("posts")
                .select("id,slug,title_pl,title_en,cover_image_url,published_at,parent_page_id")
                .eq("status", "published")
                .is("deleted_at", null)
                .order("published_at", { ascending: false })
                .limit(remaining + pinnedRows.length);
              if (error) {
                console.warn("getTickerPosts(mixed:latest) failed:", error.message);
              } else {
                fillRows = (rows ?? [])
                  .filter((r) => !pinnedRows.some((p) => p.id === r.id))
                  .slice(0, remaining);
              }
            }
          }

          return toTrendingPosts(sb, [...pinnedRows, ...fillRows]);
        }

        let q = sb
          .from("posts")
          .select("id,slug,title_pl,title_en,cover_image_url,published_at,parent_page_id")
          .eq("status", "published")
          .is("deleted_at", null);
        if (data.source === "pinned" && data.pinnedPostId) {
          q = q.eq("id", data.pinnedPostId).limit(1);
        } else if (data.source === "selected" && data.selectedPostIds?.length) {
          q = q.in("id", data.selectedPostIds).limit(data.selectedPostIds.length);
        } else {
          q = q.order("published_at", { ascending: false }).limit(data.limit);
        }
        const { data: rows, error } = await q;
        if (error) {
          console.warn("getTickerPosts failed:", error.message);
          return [];
        }
        const mapped = await toTrendingPosts(sb, (rows ?? []) as TickerRow[]);
        if (data.source === "selected" && data.selectedPostIds?.length) {
          const order = new Map(data.selectedPostIds.map((id, i) => [id, i]));
          mapped.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        }
        return mapped;
      },
    ),
  );
