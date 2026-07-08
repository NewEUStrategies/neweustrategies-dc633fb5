// Anon Supabase client for the /mcp tools. A bare createClient() sends no
// `x-tenant-host` header, so public_tenant_id() always falls back to the
// default tenant and the tools serve the wrong site on a multi-tenant
// deployment. Tag the client with the browsed host (null-tolerant: outside a
// request scope the header is simply omitted, i.e. today's behavior).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { currentTenantHost } from "@/lib/http/requestHost";

export async function mcpSupabase(): Promise<SupabaseClient | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const host = await currentTenantHost();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: host ? { headers: { "x-tenant-host": host } } : {},
  });
}
