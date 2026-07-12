// Newsletter click-tracking redirect.
// GET /api/public/nl-click?c=<campaignId>&s=<token>&u=<encoded absolute url>
// Records a `click` event (best-effort) then 302s to the target. The target is
// validated as an absolute http/https URL before redirecting (no open redirect);
// anything else falls back to the site origin. Always redirects (fail-safe).
import { createFileRoute } from "@tanstack/react-router";
import { createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";
import { isSafeHttpUrl, isValidTrackingToken } from "@/lib/newsletter/tracking";
import { recordCampaignEvent } from "@/lib/newsletter/trackingEvents.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limiter = createRateLimiter({ capacity: 60, refillPerSec: 1 });

export const Route = createFileRoute("/api/public/nl-click")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = url.searchParams.get("u");
        // Scheme-validated destination or safe fallback to the site origin.
        const dest = isSafeHttpUrl(target) ? target : url.origin;
        try {
          if (limiter.check(clientIpFromHeaders(request.headers), Date.now())) {
            const c = url.searchParams.get("c");
            const s = url.searchParams.get("s");
            if (c && UUID_RE.test(c) && isValidTrackingToken(s) && isSafeHttpUrl(target)) {
              await recordCampaignEvent(c, s, "click", target);
            }
          }
        } catch {
          // Tracking is best-effort - always redirect.
        }
        return Response.redirect(dest, 302);
      },
    },
  },
});
