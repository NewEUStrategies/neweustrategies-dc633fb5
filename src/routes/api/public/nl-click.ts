// Newsletter click-tracking redirect.
// GET /api/public/nl-click?c=<campaignId>&s=<token>&u=<encoded absolute url>&k=<link sig>
// Records a `click` event (best-effort) then 302s to the target.
//
// OPEN REDIRECT GUARD: the destination is honoured ONLY when the signed
// tracking token (`s`, HMAC per campaign+subscriber) verifies AND the
// per-link signature (`k`, HMAC over campaign+subscriber+target) matches that
// exact URL - i.e. the link really was produced by our send pipeline. Anything
// else (missing/forged token, tampered `u`, hand-crafted link) falls back to
// the site origin, so the endpoint can never launder an attacker-supplied URL
// through our trusted domain. Always redirects (fail-safe).
import { createFileRoute } from "@tanstack/react-router";
import { createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";
import { isSafeHttpUrl } from "@/lib/newsletter/tracking";
import { verifyTrackingToken, verifyTrackingLink } from "@/lib/newsletter/trackingToken.server";
import { recordCampaignEvent } from "@/lib/newsletter/trackingEvents.server";

const limiter = createRateLimiter({ capacity: 60, refillPerSec: 1 });

export const Route = createFileRoute("/api/public/nl-click")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = url.searchParams.get("u");
        const campaignId = url.searchParams.get("c");
        const subscriberId = campaignId
          ? verifyTrackingToken(campaignId, url.searchParams.get("s"))
          : null;
        // Destination is trusted only when it carries our own per-link HMAC.
        const trusted =
          isSafeHttpUrl(target) &&
          !!campaignId &&
          !!subscriberId &&
          verifyTrackingLink(campaignId, subscriberId, target, url.searchParams.get("k"));
        const dest = trusted && target ? target : url.origin;
        try {
          if (
            trusted &&
            campaignId &&
            subscriberId &&
            target &&
            limiter.check(clientIpFromHeaders(request.headers), Date.now())
          ) {
            // `first_party` = nasze przekierowanie. Patrz nl-open: pisze
            // wyłącznie źródło prawdy, żeby jedno kliknięcie było jednym wierszem.
            await recordCampaignEvent({
              campaignId,
              subscriberId,
              kind: "click",
              url: target,
              source: "first_party",
            });
          }
        } catch {
          // Tracking is best-effort - always redirect.
        }
        return Response.redirect(dest, 302);
      },
    },
  },
});
