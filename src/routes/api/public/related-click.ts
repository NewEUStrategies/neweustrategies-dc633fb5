// Beacon endpoint: kliknięcia w rekomendacje trafiają tutaj i zapisują wpis
// do `related_post_clicks`. Publiczny prefix `/api/public/*` pomija auth
// broker platformy, więc rate-limit + walidacja zależności musi być tutaj.
//
// - Walidacja Zod (uuid + uuid, różne).
// - Rate limit: max 30 wpisów / 5 min z tego samego `viewer_hash`.
// - Tenant rozwiązywany z kolumny `posts.tenant_id` (spójne z RLS-em tabeli).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
// Prefiks `node:` jest OBOWIĄZKOWY - ta sama przyczyna, co w
// `experiment-event.ts` i w `hooks.refresh-og-image.ts`: trasa jest importowana
// zachłannie przez routeTree.gen, a na workerd goły specyfikator "crypto" nie
// jest modułem rozwiązywalnym, przez co wywala się CAŁY graf tras (500
// `{"unhandled":true}` dla każdej trasy). Pod Node działa, więc awaria wychodzi
// dopiero na produkcji.
import { createHash } from "node:crypto";
import { clientIpFromHeaders } from "@/lib/http/rateLimit";
import { isPreviewHost, normalizeHost, wwwToggledHost } from "@/lib/http/host";

const BodySchema = z.object({
  sourcePostId: z.string().uuid(),
  targetPostId: z.string().uuid(),
});

// Adres z JEDYNEJ definicji „kto dzwoni" (`clientIpFromHeaders`) - pierwszy wpis
// `x-forwarded-for` pochodzi od klienta, więc kubełek po nim kluczowany rotuje
// się jednym nagłówkiem. UWAGA WDROŻENIOWA: klucz `viewer_hash` się ZMIENIA,
// więc jedno okno (5 min) limitu 30 kliknięć rusza po wdrożeniu od zera.
function viewerHashFrom(req: Request): string {
  const ip = clientIpFromHeaders(req.headers);
  const ua = req.headers.get("user-agent") ?? "";
  return createHash("sha256").update(`${ip}|${ua}`).digest("hex");
}

// Preflight beaconu - reguła i uzasadnienie jak w `experiment-event.ts`:
// `Access-Control-Allow-Origin: *` na endpoincie ZAPISU pozwalał obcej stronie
// wykonać POST przeglądarką swojego gościa (odpowiedzi nie odczyta, ale wiersz
// w `related_post_clicks` POWSTAJE - razem z `viewer_hash` liczonym z adresu i
// user-agenta OFIARY). Gate tenanta w POST tego nie łapie, bo przy żądaniu
// cross-origin Host jest nadal nasz. Origin odbijamy więc tylko dla domen
// zarejestrowanych w katalogu tenantów (mikrosite'y stoją na własnych domenach)
// albo hostów podglądu; `resolveTenantIdForHost` na tę bramkę się NIE nadaje,
// bo nieznany host degraduje tam do tenanta domyślnego i przepuściłby każdy.
async function preflightCorsHeaders(request: Request): Promise<Record<string, string>> {
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

export const Route = createFileRoute("/api/public/related-click")({
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
        if (parsed.data.sourcePostId === parsed.data.targetPostId) {
          return new Response("Self-reference", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const viewer = viewerHashFrom(request);

        // KOLEJNOŚĆ JEST TU CZĘŚCIĄ NAPRAWY, NIE PORZĄDKAMI.
        //
        // Do 2026-09-14 licznik rate-limitu stał PRZED rozwiązaniem najemcy
        // i pytał wyłącznie o `viewer_hash`. Dawało to dwa osobne defekty:
        //
        //  1. LICZNIK SUMOWAŁ RUCH WSZYSTKICH NAJEMCÓW. Aktywny najemca
        //     wyczerpywał limit czytelnikom cudzego serwisu - i był to defekt
        //     izolacji, nie wydajności.
        //
        //     CO TEGO PILNUJE, A CO NIE. Zawężenie trzymają DWA przypadki
        //     w `-related-click.test.ts`: „30 klików tego samego widza w oknie
        //     5 min kończy się 429" oraz „kliki tego samego widza u INNEGO
        //     najemcy nie wyczerpują limitu". I tyle. Bramka
        //     `check:sql-tenant-scope` tej ścieżki NIE widzi: czyta wyłącznie
        //     ciała funkcji SECURITY DEFINER z `supabase/migrations/`
        //     (`MIGRATIONS_DIR` w `scripts/lib/sqlMigrations.ts`), więc
        //     zapytania PostgREST w TypeScripcie są poza jej zasięgiem - tak
        //     samo jak poza zasięgiem pozostałych bramek `check:sql-*`.
        //     Usunięcie `.eq("tenant_id", ...)` niżej przejdzie KAŻDĄ bramkę
        //     statyczną w tym repozytorium; zatrzymać je ma wyłącznie ten test.
        //  2. ZAPYTANIE NIE MIAŁO PASUJĄCEGO INDEKSU. Wszystkie trzy indeksy
        //     `related_post_clicks` prowadzą `tenant_id` jako pierwszą kolumnę,
        //     więc predykat po samym `viewer_hash` schodził do przeglądu całej,
        //     stale rosnącej tabeli klików - na gorącej ścieżce czytelniczej.
        //
        // Żeby zawęzić licznik do najemcy, trzeba najemcę najpierw znać, więc
        // odczyt wpisu źródłowego wędruje przed limiter. To NIE pogarsza
        // odporności na nadużycie: przed limiterem stoi teraz jeden odczyt po
        // kluczu głównym `posts`, a nie - jak dotąd - nieindeksowane zliczanie
        // całej tabeli klików. Odczyt wpisu DOCELOWEGO zostaje za limiterem,
        // więc żądanie odrzucone limitem nadal kosztuje dokładnie jeden odczyt.
        const { data: srcPost, error: srcErr } = await supabaseAdmin
          .from("posts")
          .select("tenant_id")
          .eq("id", parsed.data.sourcePostId)
          .maybeSingle();
        if (srcErr || !srcPost) return new Response("Source not found", { status: 404 });

        // Rate-limit: 30 klik / 5 min z jednego `viewer_hash` W OBRĘBIE NAJEMCY.
        // Predykat `(tenant_id, viewer_hash, clicked_at)` odpowiada indeksowi
        // `related_post_clicks_tenant_viewer_window_idx` (migracja 20260914230000).
        const since = new Date(Date.now() - 5 * 60_000).toISOString();
        const { count } = await supabaseAdmin
          .from("related_post_clicks")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", srcPost.tenant_id)
          .eq("viewer_hash", viewer)
          .gte("clicked_at", since);
        if ((count ?? 0) >= 30) {
          return new Response("Too many requests", { status: 429 });
        }

        // Wpis docelowy musi należeć do tego samego najemcy co źródłowy.
        const { data: tgtPost, error: tgtErr } = await supabaseAdmin
          .from("posts")
          .select("tenant_id")
          .eq("id", parsed.data.targetPostId)
          .maybeSingle();
        if (tgtErr || !tgtPost) return new Response("Target not found", { status: 404 });
        if (tgtPost.tenant_id !== srcPost.tenant_id) {
          return new Response("Cross-tenant blocked", { status: 400 });
        }

        const { error: insErr } = await supabaseAdmin.from("related_post_clicks").insert({
          tenant_id: srcPost.tenant_id,
          source_post_id: parsed.data.sourcePostId,
          target_post_id: parsed.data.targetPostId,
          viewer_hash: viewer,
        });
        // Komunikat Postgresa niesie nazwy tabel, kolumn i ograniczeń - na
        // ścieżce bez sesji to darmowa mapa schematu. Klient dostaje stały kod,
        // log workera pełną treść (beacon jest fire-and-forget, więc bez logu
        // nieudany INSERT nie zgłosi się nigdzie).
        if (insErr) {
          console.error("[related-click] insert failed", insErr.message);
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
