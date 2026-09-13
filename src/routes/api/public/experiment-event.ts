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
// Prefiks `node:` jest OBOWIĄZKOWY. Ten moduł jest TRASĄ, więc routeTree.gen
// importuje go zachłannie i workerd (preset `cloudflare-module`) wykonuje go
// przy pierwszym żądaniu SSR. Goły specyfikator "crypto" nie jest tam modułem
// rozwiązywalnym (nodejs_compat wystawia wbudowane wyłącznie pod `node:`):
// nierozwiązany import wywraca CAŁY graf modułów tras, a h3 serializuje to jako
// nieprzezroczyste `{"unhandled":true,"message":"HTTPError"}` 500 dla KAŻDEJ
// trasy. Pod Node bare specifier działa, więc awaria widoczna jest dopiero na
// produkcji - dokładnie ten incydent opisuje `hooks.refresh-og-image.ts`.
import { createHash } from "node:crypto";
import { clientIpFromHeaders } from "@/lib/http/rateLimit";
import { redactUrl } from "@/lib/observability/redact";
import { isPreviewHost, normalizeHost, wwwToggledHost } from "@/lib/http/host";

// visitorId: crypto.randomUUID() albo fallback base36 z getVisitorId() -
// oba mieszczą się w [a-z0-9-]{8,64}.
const BodySchema = z.object({
  experimentId: z.string().uuid(),
  variant: z.enum(["a", "b"]),
  event: z.enum(["exposure", "conversion"]),
  visitorId: z.string().regex(/^[a-z0-9-]{8,64}$/i),
  path: z.string().max(2000).optional(),
});

// Adres bierzemy z JEDYNEJ definicji „kto dzwoni" w repo (`clientIpFromHeaders`):
// pierwszy wpis `x-forwarded-for` pochodzi OD KLIENTA, więc kubełek po nim
// kluczowany rotuje się jednym nagłówkiem. Drugiej kolejności nagłówków tu nie
// powtarzamy - dwie definicje znaczyłyby dwa różne kubełki na to samo żądanie.
// UWAGA WDROŻENIOWA: klucz `viewer_hash` się ZMIENIA, więc jedno okno (5 min)
// limitu `ab.event` rusza po wdrożeniu od zera.
function viewerHashFrom(req: Request): string {
  const ip = clientIpFromHeaders(req.headers);
  const ua = req.headers.get("user-agent") ?? "";
  return createHash("sha256").update(`${ip}|${ua}`).digest("hex");
}

// Preflight beaconu: `Access-Control-Allow-Origin: *` na endpoincie ZAPISU
// pozwalał dowolnej obcej stronie wykonać POST przeglądarką swojego gościa -
// odpowiedzi nie odczyta, ale WIERSZ POWSTAJE, więc metryki testu A/B (a przez
// nie wybór „zwycięzcy" kampanii) dają się fabrykować z zewnątrz. Bramka
// `resolveTenantIdForHost` w POST tego NIE zatrzymuje: przy żądaniu
// cross-origin Host jest nadal NASZ - ona chroni przed cross-TENANT, nie przed
// cross-ORIGIN. Mikrosite'y tenantów stoją na własnych domenach, więc zamiast
// stałej listy hostów pytamy katalog tenantów; `resolveTenantIdForHost` nie
// nadaje się na tę bramkę, bo nieznany host degraduje tam do tenanta
// DOMYŚLNEGO (fail-open) i odbiłaby każdy origin. `sendBeacon` z własnej
// domeny preflightu nie wykonuje, więc główna ścieżka tego nie dotyka.
async function preflightCorsHeaders(request: Request): Promise<Record<string, string>> {
  // `Vary: Origin` zawsze - odpowiedź zależy od originu także wtedy, gdy
  // nagłówków CORS w niej nie ma, a cache pośredni nie może ich pomieszać.
  const headers: Record<string, string> = { Vary: "Origin" };
  const origin = request.headers.get("origin");
  if (!origin) return headers;
  let host: string | null = null;
  try {
    host = normalizeHost(new URL(origin).hostname);
  } catch {
    return headers;
  }
  if (!host) return headers;
  const { getTenantDirectory } = await import("@/lib/server/tenant.server");
  const directory = await getTenantDirectory();
  const known = directory.byDomain.has(host) || directory.byDomain.has(wwwToggledHost(host));
  if (!known && !isPreviewHost(host)) return headers;
  return {
    ...headers,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
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
          // `path` przez `redactUrl`, jak w /api/public/track i /vitals. Klient
          // (src/lib/builder/experiments.ts) podaje samo `location.pathname`,
          // ale schemat przyjmuje `z.string().max(2000)` od DOWOLNEGO klienta
          // na trasie bez sesji - query string z tokenem albo adresem e-mail
          // wchodziłby do tabeli w całości.
          path: redactUrl(parsed.data.path ?? null),
        });
        // Komunikat Postgresa niesie nazwy tabel, kolumn i ograniczeń - na
        // ścieżce dostępnej bez sesji to darmowa mapa schematu. Do klienta idzie
        // stały kod, do logu workera pełna treść: beacon jest fire-and-forget,
        // więc bez tego logu nikt nie zgłosi nieudanych INSERT-ów.
        if (insErr) {
          console.error("[experiment-event] insert failed", insErr.message);
          return new Response("Insert failed", { status: 500 });
        }

        return new Response("ok", { status: 202 });
      },
      // sendBeacon może w niektórych przeglądarkach wykonać preflight
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: await preflightCorsHeaders(request) }),
    },
  },
});
