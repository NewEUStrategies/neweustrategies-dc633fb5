// Wspólne queryOptions dla list użytkowników w panelu administracyjnym.
// Ten sam klucz cache używany przez /admin/users i /admin/authors gwarantuje,
// że oba widoki pozostają zsynchronizowane (import zespołu, zaproszenia,
// zmiany ról odświeżają obie strony jednocześnie).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AdminRole = "super_admin" | "admin" | "editor" | "author" | "user";

export interface AdminUserRow {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  slug: string | null;
  bio: string | null;
  bio_pl: string | null;
  bio_en: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
  website_url: string | null;
  created_at: string;
  updated_at: string | null;
  roles: AdminRole[];
}

export const adminUsersQueryKey = (tenantId: string) =>
  ["admin", "all-users", tenantId] as const;

export const adminUsersQueryOptions = (tenantId: string) =>
  queryOptions({
    queryKey: adminUsersQueryKey(tenantId),
    queryFn: async (): Promise<AdminUserRow[]> => {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        roles: (r.roles ?? []) as AdminRole[],
      }));
    },
    staleTime: 30_000,
  });
