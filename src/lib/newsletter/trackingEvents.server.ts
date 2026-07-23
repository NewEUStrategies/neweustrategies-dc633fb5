// Server-side writer for newsletter open/click events. Used by the public
// nl-open / nl-click routes. Best-effort: never throws (callers are fail-safe).
//
// tenant_id is taken from the campaign row (not the request host). The
// subscriberId is already resolved from the VERIFIED tracking token (HMAC per
// campaign+subscriber, see trackingToken.server) by the caller; here we only
// confirm it belongs to the campaign's tenant (defence in depth - an event can
// never be attributed to the wrong workspace).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordCampaignEvent(
  campaignId: string,
  subscriberId: string | null,
  kind: "open" | "click",
  url: string | null,
): Promise<void> {
  if (!UUID_RE.test(campaignId)) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: camp } = await supabaseAdmin
      .from("newsletter_campaigns")
      .select("id, tenant_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (!camp?.tenant_id) return;

    // subscriberId pochodzi ze zweryfikowanego HMAC-em tokenu; potwierdzamy, że
    // należy do tenanta tej kampanii - nieznany zapisuje się jako null (zdarzenie
    // wciąż się liczy, ale nigdy nie trafi do obcego workspace).
    let verifiedSubscriberId: string | null = null;
    if (subscriberId && UUID_RE.test(subscriberId)) {
      const { data: sub } = await supabaseAdmin
        .from("newsletter_subscribers")
        .select("id")
        .eq("tenant_id", camp.tenant_id)
        .eq("id", subscriberId)
        .maybeSingle();
      if (sub?.id) verifiedSubscriberId = sub.id;
    }

    // `newsletter_campaign_events` is created by a migration not yet reflected
    // in the generated Supabase types, so the table/payload are cast here
    // (precedent: web_vitals / client_errors ingest).
    await supabaseAdmin.from("newsletter_campaign_events" as never).insert({
      tenant_id: camp.tenant_id,
      campaign_id: camp.id,
      subscriber_id: verifiedSubscriberId,
      kind,
      url: url ? url.slice(0, 2048) : null,
    } as never);
  } catch {
    // best-effort telemetry
  }
}
