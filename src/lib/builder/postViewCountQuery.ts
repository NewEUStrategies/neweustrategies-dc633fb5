// Licznik odsłon pojedynczego wpisu dla widgetu `post-meta`.
//
// Tabela `post_views` nie ma publicznej polityki SELECT (patrz migracje
// 20260625160054 i 20260626162717), więc odczyt idzie przez tenant-scoped
// funkcję SECURITY DEFINER `public.post_view_count(_post_id)` z migracji
// 20260802170000_public_post_view_count.sql. Funkcja zwraca sam licznik,
// wymusza `public_tenant_id()` + status 'published' + brak soft-delete i nie
// wystawia żadnej kolumny identyfikującej widza.
//
// Zapytanie jest LENIWE: strzela wyłącznie wtedy, gdy redaktor włączył opcję
// "Pokaż liczbę odsłon" (`enabled` po stronie widgetu). Strony bez licznika nie
// płacą ani jednego dodatkowego round-tripu.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";

/** Licznik zmienia się ciągle, ale nie jest treścią krytyczną - 5 minut. */
const VIEW_COUNT_TTL_MS = 5 * 60_000;

/** `bigint` z PostgREST bywa liczbą albo stringiem - obie formy są poprawne. */
function toCount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function fetchPostViewCount(postId: string): Promise<number | null> {
  // Rzutowanie nazwy RPC przez `unknown`: wygenerowane typy Supabase wyprzedza
  // migracja `post_view_count` (ten sam idiom co `popular_post_ids`
  // w postListQuery.ts). Zero `any`.
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: { _post_id: string },
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  )("post_view_count", { _post_id: postId });
  if (error) {
    if (typeof console !== "undefined") {
      console.warn("[post-meta] post_view_count RPC unavailable:", error.message);
    }
    return null;
  }
  // Funkcja skalarna zwraca wartość wprost; tolerujemy też kształt tablicowy.
  if (Array.isArray(data)) {
    const first = data[0];
    if (first !== null && typeof first === "object" && "post_view_count" in first) {
      return toCount((first as Record<string, unknown>).post_view_count);
    }
    return toCount(first);
  }
  return toCount(data);
}

export const postViewCountQueryOptions = (postId: string) =>
  queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.postViewCount, postId] as const,
    queryFn: (): Promise<number | null> =>
      postId ? fetchPostViewCount(postId) : Promise.resolve(null),
    staleTime: VIEW_COUNT_TTL_MS,
  });
