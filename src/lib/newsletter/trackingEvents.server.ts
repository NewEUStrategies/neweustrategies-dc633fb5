// Server-side writer for newsletter open/click events. Used by the public
// nl-open / nl-click routes. Best-effort: never throws (callers are fail-safe).
//
// tenant_id is taken from the campaign row (not the request host), and the
// subscriber is resolved from the reused unsubscribe token, scoped to that
// tenant so a token can never attribute an event to the wrong workspace.
import { isValidTrackingToken } from "./tracking";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordCampaignEvent(
  campaignId: string,
  token: string,
  kind: "open" | "click",
  url: string | null,
): Promise<void> {
  if (!UUID_RE.test(campaignId) || !isValidTrackingToken(token)) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: camp } = await supabaseAdmin
      .from("newsletter_campaigns")
      .select("id, tenant_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (!camp?.tenant_id) return;

    let subscriberId: string | null = null;
    const { data: sub } = await supabaseAdmin
      .from("newsletter_subscribers")
      .select("id")
      .eq("tenant_id", camp.tenant_id)
      .eq("unsubscribe_token", token)
      .maybeSingle();
    if (sub?.id) subscriberId = sub.id;

    // `newsletter_campaign_events` is created by a migration not yet reflected
    // in the generated Supabase types, so the table/payload are cast here
    // (precedent: web_vitals / client_errors ingest).
    await supabaseAdmin.from("newsletter_campaign_events" as never).insert({
      tenant_id: camp.tenant_id,
      campaign_id: camp.id,
      subscriber_id: subscriberId,
      kind,
      url: url ? url.slice(0, 2048) : null,
    } as never);
  } catch {
    // best-effort telemetry
  }
}
