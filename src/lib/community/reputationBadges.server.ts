import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface ReputationBadgeReconciliationResult {
  scannedLimit: number;
  granted: number;
}

/**
 * Naprawcza partia automatycznych odznak. Triggery nadają je bezpośrednio po
 * aktywności, a ten przebieg domyka zdarzenia zależne od czasu i importy.
 */
export async function reconcileReputationBadges(
  limit = 250,
): Promise<ReputationBadgeReconciliationResult> {
  const scannedLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
  const { data, error } = await supabaseAdmin.rpc("reconcile_due_profile_badges", {
    p_limit: scannedLimit,
  });
  if (error) throw error;
  return { scannedLimit, granted: data ?? 0 };
}
