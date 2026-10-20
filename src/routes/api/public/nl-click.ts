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
//
// Ścieżki komunikacji (S5): `?m=<token wiadomości>&i=<numer linku>&u=…&k=…`.
// Ta sama ochrona przed otwartym przekierowaniem: cel przechodzi WYŁĄCZNIE
// z ważnym tokenem wiadomości i podpisem `k`, który wiąże adres i numer
// linku z tą wiadomością (`jm:`). Gałąź `m` ma pierwszeństwo przed `c`/`s` -
// link ścieżki nigdy nie niesie kampanii.
import { createFileRoute } from "@tanstack/react-router";
import { createRateLimiter, rateLimitIpSubject } from "@/lib/http/rateLimit";
import { isSafeHttpUrl } from "@/lib/newsletter/tracking";
import {
  verifyJourneyLink,
  verifyJourneyMessageToken,
  verifyTrackingToken,
  verifyTrackingLink,
} from "@/lib/newsletter/trackingToken.server";
import { recordCampaignEvent } from "@/lib/newsletter/trackingEvents.server";
import { recordJourneyMessageEvent } from "@/lib/journeys/tracking.server";

/** Numer linku 0-999 albo `null` (podpis i tak go wiąże - to tylko kształt). */
function linkIndex(raw: string | null): number | null {
  if (!raw || !/^\d{1,3}$/.test(raw)) return null;
  return Number(raw);
}

const limiter = createRateLimiter({ capacity: 60, refillPerSec: 1 });

export const Route = createFileRoute("/api/public/nl-click")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = url.searchParams.get("u");
        const journeyToken = url.searchParams.get("m");
        if (journeyToken !== null) {
          const messageId = verifyJourneyMessageToken(journeyToken);
          const index = linkIndex(url.searchParams.get("i"));
          const journeyTrusted =
            isSafeHttpUrl(target) &&
            messageId !== null &&
            index !== null &&
            verifyJourneyLink(messageId, target, url.searchParams.get("k"), index);
          if (
            journeyTrusted &&
            messageId &&
            target &&
            limiter.check(rateLimitIpSubject(request.headers), Date.now())
          ) {
            await recordJourneyMessageEvent({
              messageId,
              kind: "click",
              linkIndex: index ?? 0,
              url: target,
            });
          }
          return Response.redirect(journeyTrusted && target ? target : url.origin, 302);
        }
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
            limiter.check(rateLimitIpSubject(request.headers), Date.now())
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
