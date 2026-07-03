// Server function: search published posts + pages by title (PL/EN) within
// the caller's tenant. Public-readable rows only; RLS handles enforcement.
// Returned shape is a small DTO consumable by the command palette.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";
import type { Database } from "@/integrations/supabase/types";

export type SearchHitKind = "post" | "page";

export interface SearchHit {
  kind: SearchHitKind;
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  /** Public href ready for navigation. */
  href: string;
}

const InputSchema = z.object({
  q: z.string().trim().min(1).max(128),
  limit: z.number().int().min(1).max(50).optional(),
});

export const globalSearch = createServerFn({ method: "GET" })
  .inputValidator((data: z.input<typeof InputSchema>) => InputSchema.parse(data))
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

    const hits: SearchHit[] = (rows ?? []).map((row) => ({
      kind: row.kind === "page" ? "page" : "post",
      id: row.id,
      slug: row.slug,
      title_pl: row.title_pl ?? "",
      title_en: row.title_en ?? "",
      href: row.kind === "page" ? `/${row.slug}` : `/post/${row.slug}`,
    }));
    return { hits };
  });
