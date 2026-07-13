// Publiczny tenant_id używany przez inserty klientów (RLS wymaga równości z public_tenant_id()).
import { supabase } from "@/integrations/supabase/client";

let cached: string | null = null;

export async function getPublicTenantId(): Promise<string> {
  if (cached) return cached;
  const { data, error } = await supabase.rpc("public_tenant_id");
  if (error) throw error;
  cached = data as string;
  return cached;
}
