// Beacon endpoint: zdarzenia eksperymentów A/B (ekspozycje/konwersje) trafiają
// tutaj i zapisują wpis do `builder_experiment_events`. Publiczny prefix
// `/api/public/*` pomija auth broker platformy, więc rate-limit + walidacja
// zależności musi być tutaj - bezpośredni INSERT jest zablokowany (migracja
// 20260730140000), bo sesja zalogowana mogła zalewać tabelę sfabrykowanymi
// zdarzeniami i dowolnie ustawiać "zwycięzcę" testu A/B. Insert service_role
// przywraca przy okazji zliczanie gości anonimowych - ich bezpośrednie
// INSERT-y padały od 20260703052115 na braku SELECT do builder_experiments
// w subquery polityki (cichy ubytek danych, błąd logowany tylko w DEV).
//
// - Walidacja Zod (uuid, variant a|b, event exposure|conversion, visitorId).
// - Rate limit: max 60 zdarzeń / 5 min z tego samego `viewer_hash` (wspólny
//   licznik rate_limit_hit; strona może mieć kilka eksperymentów naraz).
// - Eksperyment musi istnieć i mieć status `running` - przywrócony warunek z
//   pierwotnej polityki (is_experiment_running), zgubiony przy jej kolejnych
//   wersjach - oraz należeć do tenanta przeglądanego hosta (odpowiednik
//   public_tenant_id() ze zdjętej polityki RLS).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createHash } from "crypto";

// visitorId: crypto.randomUUID() albo fallback base36 z getVisitorId() -
// oba mieszczą się w [a-z0-9-]{8,64}.
const BodySchema = z.object({
  experimentId: z.string().uuid(),
  variant: z.enum(["a", "b"]),
  event: z.enum(["exposure", "conversion"]),
  visitorId: z.string().regex(/^[a-z0-9-]{8,64}$/i),
  path: z.string().max(2000).optional(),
});

function viewerHashFrom(req: Request): string {
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "0.0.0.0";
  const ua = req.headers.get("user-agent") ?? "";
  return createHash("sha256").update(`${ip}|${ua}`).digest("hex");
}

export const Route = createFileRoute("/api/public/experiment-event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const parsed = BodySchema.safeParse(payload);
        if (!parsed.success) {
          return new Response("Invalid body", { status: 400 });
        }

        const viewer = viewerHashFrom(request);
        const { rateLimit } = await import("@/lib/server/rate-limit.server");
        const allowed = await rateLimit({
          scope: "ab.event",
          subjectId: viewer,
          max: 60,
          windowMinutes: 5,
        });
        if (!allowed) return new Response("Too many requests", { status: 429 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: exp, error: expErr } = await supabaseAdmin
          .from("builder_experiments")
          .select("id, status, tenant_id")
          .eq("id", parsed.data.experimentId)
          .maybeSingle();
        if (expErr || !exp || exp.status !== "running") {
          return new Response("Experiment not found", { status: 404 });
        }

        const { resolveTenantIdForHost, resolveTrustedRequestHost } =
          await import("@/lib/server/tenant.server");
        const hostTenantId = await resolveTenantIdForHost(await resolveTrustedRequestHost(request));
        if (!hostTenantId || exp.tenant_id !== hostTenantId) {
          return new Response("Cross-tenant blocked", { status: 400 });
        }

        const { error: insErr } = await supabaseAdmin.from("builder_experiment_events").insert({
          experiment_id: parsed.data.experimentId,
          variant: parsed.data.variant,
          event: parsed.data.event,
          visitor_id: parsed.data.visitorId,
          path: parsed.data.path ?? null,
        });
        if (insErr) return new Response(insErr.message, { status: 500 });

        return new Response("ok", { status: 202 });
      },
      // sendBeacon może w niektórych przeglądarkach wykonać preflight
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "content-type",
          },
        }),
    },
  },
});
