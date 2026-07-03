// Authoritative user -> tenant lookup for server functions (server-only).
//
// Staff server functions that must read via the service role (e.g. columns
// the C1 hardening revoked from the authenticated role: content_pl/en,
// builder_data, blocks_data) MUST first pin the caller's tenant from
// public.profiles and scope every service-role query with it - the service
// role bypasses RLS, so this explicit filter IS the tenant boundary there.
// Shared by media usage lookup and the posts -> blocks migration.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Tenant id of a user, read from profiles (never from client input). Works
 * with the service-role client (RLS bypass) and with a user-scoped client
 * (profiles self-select policy). Throws when the user has no tenant - staff
 * flows must fail closed rather than run unscoped.
 */
export async function resolveUserTenantId(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data?.tenant_id) throw new Error("No tenant for current user");
  return data.tenant_id;
}
