// Pobieranie kolejnego (chronologicznie wstecz) opublikowanego wpisu
// w obrębie tej samej strony nadrzędnej. Używane przez AutoLoadNextPost.
import { supabase } from "@/integrations/supabase/client";
import { fetchGatedBody } from "@/lib/queries/public";

export interface NextPostSummary {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  content_pl: string | null;
  content_en: string | null;
  published_at: string | null;
  parent_page_id: string;
  href: string;
}

// Only non-gated display columns are selected directly; the body is fetched
// through the SECURITY DEFINER get_entity_content RPC (see fetchGatedBody).
const COLS =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id";

export async function fetchNextPost(params: {
  currentPostId: string;
  parentPageId: string;
  currentPublishedAt: string | null;
}): Promise<NextPostSummary | null> {
  const { currentPostId, parentPageId, currentPublishedAt } = params;
  let q = supabase
    .from("posts")
    .select(COLS)
    .eq("status", "published")
    .is("deleted_at", null)
    .eq("parent_page_id", parentPageId)
    .neq("id", currentPostId)
    .order("published_at", { ascending: false })
    .limit(1);
  if (currentPublishedAt) {
    q = q.lt("published_at", currentPublishedAt);
  }
  const { data, error } = await q;
  if (error) throw error;
  const row = (data ?? [])[0];
  if (!row) return null;
  // The body goes through the gated RPC, never a direct column select, so a
  // members/paid "next" article is not leaked to an unentitled reader: it comes
  // back with a null body and AutoLoadNextPost renders only the headline + link.
  const [{ data: path }, body] = await Promise.all([
    supabase.rpc("page_full_path", { _page_id: row.parent_page_id }),
    fetchGatedBody("post", row.id),
  ]);
  const href = `/${typeof path === "string" ? path : "blog"}/${row.slug}`;
  return {
    ...(row as Omit<NextPostSummary, "href" | "content_pl" | "content_en">),
    content_pl: body.content_pl,
    content_en: body.content_en,
    href,
  };
}
