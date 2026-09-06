import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { readPagedRows } from "./pagedRows.server";

/** Published parent paths shared by sitemap and feed readers. Tenant scope is
 * enforced before the batched RPC; noindex parents may still contain public
 * posts, so their paths remain available separately from the noindex set.
 */
export async function readPublishedPagePaths(admin: SupabaseClient<Database>, tenantId: string) {
  const { data: pages } = await readPagedRows((from, to) =>
    admin
      .from("pages")
      .select("id, seo_noindex", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const noindex = new Set(pages.filter((page) => page.seo_noindex).map((page) => page.id));
  const paths = new Map<string, string>();
  for (let offset = 0; offset < pages.length; offset += 500) {
    const ids = pages.slice(offset, offset + 500).map((page) => page.id);
    const allowed = new Set(ids);
    const { data, error } = await admin.rpc("page_full_paths", { _page_ids: ids });
    if (error) throw error;
    for (const row of data ?? []) {
      if (allowed.has(row.page_id) && typeof row.full_path === "string" && row.full_path.trim()) {
        paths.set(row.page_id, row.full_path);
      }
    }
  }
  return { paths, noindex };
}
