import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TenantAuthor {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

/**
 * Fetches profiles within the current tenant - used to populate author
 * filters and label author_id cells in admin lists.
 * Per-tenant scoped (RLS-safe: profiles has public read by design but
 * we constrain by tenant_id on the client to keep UI tenant-isolated).
 */
export function useTenantAuthors(tenantId: string | null | undefined) {
  return useQuery({
    enabled: !!tenantId,
    queryKey: ["admin-tenant-authors", tenantId],
    staleTime: 60_000,
    queryFn: async (): Promise<TenantAuthor[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, email, avatar_url")
        .eq("tenant_id", tenantId!)
        .order("display_name", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function authorLabel(a: TenantAuthor | undefined | null): string {
  if (!a) return "-";
  return a.display_name?.trim() || a.email?.trim() || "-";
}
