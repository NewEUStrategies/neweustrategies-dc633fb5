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
  const tenantId = await readUserTenantId(supabase, userId).catch(() => null);
  if (!tenantId) throw new Error("No tenant for current user");
  return tenantId;
}

/**
 * Same lookup for service-role writers that must tell "no profile" apart from
 * a failed read: `null` when the user has no profile (closed account), throws
 * when the query itself fails, so a webhook answers 5xx and the provider
 * retries instead of writing a row under the column's fallback tenant.
 */
export async function readUserTenantId(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`profile tenant lookup failed: ${error.message}`);
  return data?.tenant_id ?? null;
}
