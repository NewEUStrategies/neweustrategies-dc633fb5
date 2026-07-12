// Newsletter open-tracking pixel. GET /api/public/nl-open?c=<campaignId>&s=<token>
// Always returns a 1x1 transparent GIF (fail-safe); best-effort records an
// `open` event. `s` is the subscriber's existing unsubscribe token (reused).
import { createFileRoute } from "@tanstack/react-router";
import { createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";
import { isValidTrackingToken } from "@/lib/newsletter/tracking";
import { recordCampaignEvent } from "@/lib/newsletter/trackingEvents.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A mail client may re-request the pixel a few times; generous burst, light
// sustained rate per IP just to blunt a flood.
const limiter = createRateLimiter({ capacity: 120, refillPerSec: 2 });

// 43-byte fully-transparent 1x1 GIF89a.
const GIF = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

function pixel(): Response {
  return new Response(GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(GIF.byteLength),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  });
}

export const Route = createFileRoute("/api/public/nl-open")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          if (limiter.check(clientIpFromHeaders(request.headers), Date.now())) {
            const url = new URL(request.url);
            const c = url.searchParams.get("c");
            const s = url.searchParams.get("s");
            if (c && UUID_RE.test(c) && isValidTrackingToken(s)) {
              await recordCampaignEvent(c, s, "open", null);
            }
          }
        } catch {
          // Tracking is best-effort - always serve the pixel.
        }
        return pixel();
      },
    },
  },
});
