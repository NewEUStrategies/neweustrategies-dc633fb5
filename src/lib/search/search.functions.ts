// Server function: search published posts + pages by title (PL/EN) within
// the caller's tenant. Public-readable rows only; RLS handles enforcement.
// Returned shape is a small DTO consumable by the command palette.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";
import type { Database } from "@/integrations/supabase/types";
import { POST_PARENT_PAGE_EMBED, postHref, type PostParentPage } from "@/lib/routing/postHref";
import { readWithPostParentPage } from "@/lib/routing/postParentPageRead";

type SearchHitKind = "post" | "page";

export interface SearchHit {
  kind: SearchHitKind;
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  /** Public href ready for navigation. */
  href: string;
}

/** Wiersz odczytu stron-rodziców trafień: identyfikator wpisu i osadzony rodzic. */
interface PostParentRow {
  id: string;
  parent_page: PostParentPage | null;
}

/** Odczyt zapasowy: bez żadnego zapytania - trafienia RPC mają już wszystko poza rodzicem. */
const NO_PARENT_ROWS = { data: null, error: null } as const;

/**
 * Strona-rodzic każdego wpisu z trafień, po identyfikatorze wpisu - JEDNA
 * dodatkowa podróż na zapytanie palety (`search_quick` oddaje tylko slug,
 * a zmiana funkcji SQL wymagałaby migracji).
 *
 * PO CO. Bez rodzica trafienie linkuje `/post/<slug>`, które odpowiada 301 na
 * `/<strona-rodzic>/<slug>`: dodatkowy dokument i dwa odczyty bazy przy
 * wyborze trafienia. Z rodzicem najwyższego poziomu `postHref` daje adres
 * kanoniczny od razu; rodzic zagnieżdżony albo niewidoczny zostaje przy
 * `/post/<slug>`, jak w pozostałych listach (`lib/routing/postHref.ts`).
 *
 * BŁĄD NIE JEST BŁĘDEM PALETY. Wspólny `readWithPostParentPage` loguje go raz
 * na okno i wyłącza osadzenie w izolacie na `POST_PARENT_PAGE_RETRY_MS`.
 * Odczyt zapasowy nie pyta bazy: trafienia już niosą slug i tytuły, więc bez
 * rodzica wracają z adresem `/post/<slug>` - dokładnie tym, co paleta
 * pokazywała przed tą zmianą - a w oknie wyłączenia nie ma też dodatkowej
 * podróży. Tenant przypina ten sam klient co RPC (`fetchWithTenantHost`),
 * identyfikatory pochodzą z wyniku RPC, nie z ładunku wołającego.
 */
async function postParentPages(
  sb: SupabaseClient<Database>,
  postIds: readonly string[],
): Promise<Map<string, PostParentPage | null>> {
  if (postIds.length === 0) return new Map();
  const { data } = await readWithPostParentPage(
    () =>
      sb
        .from("posts")
        .select(`id, ${POST_PARENT_PAGE_EMBED}`)
        .in("id", [...postIds]),
    () => Promise.resolve(NO_PARENT_ROWS),
  );
  const rows = (data ?? []) as unknown as PostParentRow[];
  return new Map(rows.map((row) => [row.id, row.parent_page]));
}

const InputSchema = z.object({
  q: z.string().trim().min(1).max(128),
  limit: z.number().int().min(1).max(50).optional(),
});

export const globalSearch = createServerFn({ method: "GET" })
  .validator((data: z.input<typeof InputSchema>) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<{ hits: SearchHit[] }> => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return { hits: [] };
    const { createClient } = await import("@supabase/supabase-js");
    // Anon client under RLS; the tenant-host fetch pins search_quick's
    // coalesce(current_tenant_id(), public_tenant_id()) to the browsed site.
    const sb = createClient<Database>(url, key, {
      auth: { persistSession: false },
      global: { fetch: fetchWithTenantHost },
    });

    const limit = data.limit ?? 12;

    // Full-text search (ranking + unaccent + prefix) zamiast ILIKE; jeden RPC
    // zwraca posty i strony posortowane wg trafności.
    const { data: rows } = await sb.rpc("search_quick", { _q: data.q, _limit: limit });
    const found = rows ?? [];
    // Nieznany rodzaj to wpis (nigdy strona) - ta sama reguła co przy adresie.
    const parents = await postParentPages(
      sb,
      found.filter((row) => row.kind !== "page").map((row) => row.id),
    );

    const hits: SearchHit[] = found.map((row) => ({
      kind: row.kind === "page" ? "page" : "post",
      id: row.id,
      slug: row.slug,
      title_pl: row.title_pl ?? "",
      title_en: row.title_en ?? "",
      href:
        row.kind === "page"
          ? `/${row.slug}`
          : postHref({ slug: row.slug, parent_page: parents.get(row.id) }),
    }));
    return { hits };
  });
