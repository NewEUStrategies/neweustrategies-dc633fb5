// Client-side tenant helpers.
//
// RLS already enforces tenant isolation on the server (every policy checks
// tenant_id = current_tenant_id()). These helpers add a second, client-side
// guard so admin queries explicitly scope by tenant - defense in depth and
// also a smaller payload over the wire.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useCurrentTenantId(): string | null {
  const { user } = useAuth();
  const { data } = useQuery({
    enabled: !!user?.id,
    queryKey: ["current_tenant_id", user?.id],
    queryFn: async (): Promise<string | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data?.tenant_id ?? null;
    },
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });
  return data ?? null;
}
