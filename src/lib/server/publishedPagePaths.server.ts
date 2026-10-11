import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { HomepageCandidatePage } from "@/lib/seo/homepagePage";
import { readPagedRows } from "./pagedRows.server";

/**
 * Najgłębsza ścieżka, jaką składa `page_full_paths` - lustro `c.depth < 50`
 * w członie rekurencyjnym funkcji (migracja 20260831214637). Strona głębiej
 * dostałaby z RPC ścieżkę UCIĘTĄ od góry, czyli adres, pod którym `resolve_path`
 * niczego nie znajdzie - więc taka strona nie dostaje ścieżki wcale.
 */
export const PAGE_PATH_MAX_DEPTH = 50;

/**
 * Strony osiągalne publicznie: CAŁY łańcuch przodków jest w zbiorze stron
 * opublikowanych i nieusuniętych. `parentOf` to mapa id -> `parent_id` stron
 * z tego zbioru (pusty rodzic = strona najwyższego poziomu).
 *
 * PO CO (2026-10 audyt GSC). `page_full_paths` składa ścieżkę po `parent_id`
 * BEZ względu na status przodków, a publiczny `resolve_path` schodzi od korzenia
 * segment po segmencie i wymaga `status = 'published' AND deleted_at IS NULL`
 * na KAŻDYM poziomie. Pięć opublikowanych stron `test-*` pod nieopublikowanym
 * rodzicem dostawało więc ścieżkę `test/test-*` i trafiało do
 * `sitemaps/pages.xml` (PL+EN = 10 adresów), choć każdy z tych adresów to 404.
 *
 * Wynik to głębokość (liczba segmentów ścieżki) - zapamiętana per strona, więc
 * każdy łańcuch przechodzimy raz. Cykl w `parent_id` (baza go nie blokuje)
 * i łańcuch dłuższy niż `PAGE_PATH_MAX_DEPTH` dają stronę nieosiągalną, a nie
 * pętlę bez końca.
 */
export function reachablePageIds(parentOf: ReadonlyMap<string, string | null>): Set<string> {
  // > 0 = głębokość strony osiągalnej, 0 = strona nieosiągalna.
  const depth = new Map<string, number>();
  for (const start of parentOf.keys()) {
    if (depth.has(start)) continue;
    const chain: string[] = [];
    let current: string | null | undefined = start;
    // Głębokość węzła, na którym marsz w górę się zatrzymał (0 = korzeń
    // przekroczony, więc łańcuch zaczyna się od zera); `null` = nieosiągalna.
    let base: number | null = null;
    for (;;) {
      if (!current) {
        base = 0;
        break;
      }
      const known = depth.get(current);
      if (known !== undefined) {
        base = known > 0 ? known : null;
        break;
      }
      // Przodek spoza zbioru opublikowanych (szkic, kosz, inny najemca) albo
      // powrót do węzła z tego samego marszu (cykl) - łańcuch się urywa.
      if (!parentOf.has(current) || chain.includes(current)) break;
      if (chain.length >= PAGE_PATH_MAX_DEPTH) {
        // Za głęboko dla `start`; o węzłach pośrednich ten marsz nic nie
        // przesądza - każdy policzy się we własnym.
        chain.length = 1;
        break;
      }
      chain.push(current);
      current = parentOf.get(current);
    }
    for (let i = chain.length - 1, step = 1; i >= 0; i -= 1, step += 1) {
      const d = base === null ? 0 : base + step;
      depth.set(chain[i], d > PAGE_PATH_MAX_DEPTH ? 0 : d);
    }
  }
  const out = new Set<string>();
  for (const [id, d] of depth) if (d > 0) out.add(id);
  return out;
}

/**
 * Ścieżki opublikowanych stron, wspólne dla sitemapy i czytników feedów.
 * Zakres najemcy stoi przed wsadowym RPC; strony z `seo_noindex` nadal mogą
 * być rodzicami publicznych wpisów, więc ich ścieżki zostają, a sam zbiór
 * noindex jedzie osobno. `updatedAt` zasila `<lastmod>` sekcji `pages`.
 *
 * Ścieżkę dostaje WYŁĄCZNIE strona osiągalna publicznie (`reachablePageIds`):
 * RPC woła się tylko dla nich, więc dziecko nieopublikowanego rodzica - a za
 * nim wpisy pod tym dzieckiem - wypada z sitemapy i z feedów razem z adresem,
 * który i tak kończy się 404.
 *
 * `pages` to WSZYSTKIE opublikowane strony (także nieosiągalne), w kształcie
 * wejścia `configuredHomepagePageId` - zapytanie o stronę główną (`/`) wybiera
 * ją po id spośród opublikowanych, bez sprawdzania łańcucha przodków.
 */
export async function readPublishedPagePaths(admin: SupabaseClient<Database>, tenantId: string) {
  const { data: rows } = await readPagedRows((from, to) =>
    admin
      .from("pages")
      .select("id, slug, parent_id, seo_noindex, updated_at", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const pages: HomepageCandidatePage[] = rows.map((page) => ({
    id: page.id,
    slug: page.slug,
    parent_id: page.parent_id ?? null,
  }));
  const noindex = new Set(rows.filter((page) => page.seo_noindex).map((page) => page.id));
  const updatedAt = new Map<string, string>();
  for (const page of rows) if (page.updated_at) updatedAt.set(page.id, page.updated_at);
  const reachable = reachablePageIds(
    new Map<string, string | null>(pages.map((page) => [page.id, page.parent_id])),
  );
  const resolvable = pages.filter((page) => reachable.has(page.id)).map((page) => page.id);
  const paths = new Map<string, string>();
  for (let offset = 0; offset < resolvable.length; offset += 500) {
    const ids = resolvable.slice(offset, offset + 500);
    const allowed = new Set(ids);
    const { data, error } = await admin.rpc("page_full_paths", { _page_ids: ids });
    if (error) throw error;
    for (const row of data ?? []) {
      if (allowed.has(row.page_id) && typeof row.full_path === "string" && row.full_path.trim()) {
        paths.set(row.page_id, row.full_path);
      }
    }
  }
  return { paths, noindex, updatedAt, pages };
}
