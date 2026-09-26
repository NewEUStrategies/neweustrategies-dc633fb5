// Logika odczytu raportu dla sponsora po tokenie (server-only).
//
// KOLEJNOŚĆ ŚCIAN:
//   1. limit prób po IP w bazie (`rate_limit_hit`) - FAIL-CLOSED: przy awarii
//      licznika odmawiamy, zamiast zdjąć ochronę przed zgadywaniem tokenów;
//   2. najemca z zaufanego hosta; bez niego token nie ma w czym szukać;
//   3. RPC service role, które samo sprawdza skrót, odwołanie i wygaśnięcie.
// Każda odmowa ma ten sam kształt co odpowiedź bazy (`{ok:false, reason}`),
// więc strona rysuje jeden zestaw komunikatów. Token nie trafia do logów.
import { getRequest } from "@tanstack/react-start/server";

import { rateLimitIpSubject } from "@/lib/http/rateLimit";
import { currentTenantHost } from "@/lib/http/requestHost";
import { rateLimit } from "@/lib/server/rate-limit.server";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";

/** Prób na IP w oknie - sponsor otwiera raport kilka razy, zgadujący tysiące. */
export const SPONSOR_REPORT_RATE_LIMIT = { max: 30, windowMinutes: 10 } as const;

function refusal(reason: "rate_limited" | "not_found" | "error"): { json: string } {
  return { json: JSON.stringify({ ok: false, reason }) };
}

export async function loadSponsorReportByToken(token: string): Promise<{ json: string }> {
  const request = getRequest();
  const allowed = await rateLimit({
    scope: "event.sponsor_report",
    subjectId: rateLimitIpSubject(request.headers),
    max: SPONSOR_REPORT_RATE_LIMIT.max,
    windowMinutes: SPONSOR_REPORT_RATE_LIMIT.windowMinutes,
    failClosed: true,
  });
  if (!allowed) return refusal("rate_limited");

  let tenantId: string | null = null;
  try {
    tenantId = await resolveTenantIdForHost(await currentTenantHost());
  } catch {
    tenantId = null;
  }
  if (!tenantId) return refusal("not_found");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("event_sponsor_report_for_token", {
    p_tenant: tenantId,
    p_token: token,
  });
  if (error) return refusal("error");
  return { json: JSON.stringify(data) };
}
