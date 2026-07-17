// Panel admina - sieć kontaktów: metryki tenanta (admin_network_stats) i
// kolejka zgłoszeń użytkowników (admin_list/resolve_user_reports). Wszystkie
// RPC są SECURITY DEFINER i po stronie DB wymagają is_staff() we własnym
// tenancie - te fetchery to tylko cienki transport.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];
export type NetworkStats = Fns["admin_network_stats"]["Returns"][number];
export type UserReportRow = Fns["admin_list_user_reports"]["Returns"][number];

export async function fetchNetworkStats(): Promise<NetworkStats | null> {
  const { data, error } = await supabase.rpc("admin_network_stats");
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function fetchUserReports(status: string): Promise<UserReportRow[]> {
  const { data, error } = await supabase.rpc("admin_list_user_reports", {
    p_status: status,
    p_limit: 50,
  });
  if (error) throw error;
  return data ?? [];
}

export async function resolveUserReport(
  reportId: string,
  action: "resolved" | "dismissed",
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc("admin_resolve_user_report", {
    p_report_id: reportId,
    p_action: action,
    p_note: note,
  });
  if (error) throw error;
}
