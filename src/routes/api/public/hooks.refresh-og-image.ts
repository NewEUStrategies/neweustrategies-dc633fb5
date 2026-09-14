// Publiczny webhook do wymuszenia regeneracji og:image dla /author/$slug.
// Do wywołania przez CI / integracje zewnętrzne / cron. Bumpuje
// `profiles.updated_at` co przekłada się na nową wersję `?v=` doklejaną
// przez `withOgVersion` w head() - scrapery uznają zasób za zmieniony.
//
// Autoryzacja: HMAC-SHA256 z sekretu `OG_REFRESH_SECRET` nad `${timestamp}.${slug}`.
// Nagłówki: `x-og-signature: <hex>` + `x-og-timestamp: <unix seconds>`.
// Bez sekretu w env → 501 (opt-in).
// Autor SPA używa server function `refreshAuthorOgImage` (JWT), nie tego endpointu.
//
// PO CO ZNACZNIK CZASU. Podpis obejmujący SAM slug jest WIECZNYM tokenem zapisu
// do `profiles.updated_at` dla tego sluga: raz podejrzany (logi proxy CI,
// historia poleceń, konfiguracja integracji) daje bezterminowe prawo do
// unicestwiania cache og:image u scraperów, a unieważnić go można wyłącznie
// rotacją OG_REFRESH_SECRET dla WSZYSTKICH slugów naraz. Okno tolerancji jest
// wspólne z weryfikacją webhooków Resend (WEBHOOK_TOLERANCE_SECONDS, 300 s) -
// druga stała oznaczałaby dwa różne kontrakty anty-replay w jednym repo.
//
// WDROŻENIE DWUFAZOWE (faza 1 - TU JESTEŚMY). Zewnętrzni wołający (CI, cron,
// integracje) podpisują dziś sam slug, więc podpis bez `x-og-timestamp` jest
// nadal przyjmowany i logowany jako `legacy signature`. FAZA 2: gdy w logach
// zniknie ruch legacy, usuń gałąź bez znacznika czasu. Bez tego okna
// odświeżanie og:image autorów przestałoby działać CICHO - objawiłoby się
// dopiero starymi miniaturami w podglądach linków, tygodnie później.
import { createFileRoute } from "@tanstack/react-router";
// MUST use the `node:` prefix. This module is a ROUTE, so it is eagerly imported
// by routeTree.gen and evaluated during the framework's getEntries() on the first
// SSR request. On the Cloudflare Worker (workerd) runtime a bare "crypto"
// specifier is not a resolvable module (nodejs_compat exposes builtins only under
// the `node:` prefix); the unresolved import throws at module-init, rejects the
// whole route-module graph, and h3 serializes it as the opaque, self-poisoning
// `{"unhandled":true,"message":"HTTPError"}` 500 for EVERY route (Node resolves
// the bare specifier, so it only ever failed on workerd).
//
// KOREKTA (2026-09): zdanie „every other route here already uses node:crypto;
// this was the lone inconsistency" było NIEPRAWDZIWE - `experiment-event.ts`
// i `related-click.ts` łamały tę regułę dalej, obie ładowane zachłannie przez
// routeTree.gen, czyli nawrót dokładnie tego incydentu. Poprawione razem z tym
// komentarzem; reguły nie pilnuje dziś ŻADNA bramka CI, więc do czasu dodania
// skanera na `from "crypto"` (i pozostałe wbudowane bez prefiksu `node:`) ten
// komentarz jest jedynym egzekwowaniem.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { WEBHOOK_TOLERANCE_SECONDS } from "@/lib/email/webhookSignature.server";

const Body = z.object({
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/i),
});

// Porównanie w STAŁYM CZASIE: `===` na heksie wycieka pozycję pierwszej
// różnicy, a to pozwala dobierać podpis bajt po bajcie. `equalsConstantTime`
// z `webhookSignature.server.ts` nie jest eksportowane, więc zostaje ta wersja -
// dekoduje heks i odrzuca długości niezgodne ORAZ puste, żeby brak nagłówka nie
// porównywał się „równo" z pustym oczekiwanym buforem.
function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

export const Route = createFileRoute("/api/public/hooks/refresh-og-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.OG_REFRESH_SECRET;
        if (!secret) {
          return new Response(JSON.stringify({ error: "OG_REFRESH_SECRET not configured" }), {
            status: 501,
            headers: { "Content-Type": "application/json" },
          });
        }
        const raw = await request.text();
        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(JSON.parse(raw));
        } catch {
          return new Response(JSON.stringify({ error: "Invalid body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const sig = request.headers.get("x-og-signature") ?? "";
        const rawTs = request.headers.get("x-og-timestamp")?.trim() ?? "";
        const unauthorized = (error: string) =>
          new Response(JSON.stringify({ error }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });

        if (rawTs) {
          const ts = Number(rawTs);
          if (!Number.isFinite(ts) || ts <= 0) return unauthorized("Invalid timestamp");
          // Okno w OBIE strony - zegar wołającego bywa do przodu.
          if (Math.abs(Math.floor(Date.now() / 1000) - ts) > WEBHOOK_TOLERANCE_SECONDS) {
            return unauthorized("Expired signature");
          }
          const expected = createHmac("sha256", secret)
            .update(`${rawTs}.${parsed.slug}`)
            .digest("hex");
          if (!safeEq(sig, expected)) return unauthorized("Invalid signature");
        } else {
          // FAZA 1 wdrożenia: stary kontrakt (podpis nad samym slugiem).
          const legacyExpected = createHmac("sha256", secret).update(parsed.slug).digest("hex");
          if (!safeEq(sig, legacyExpected)) return unauthorized("Invalid signature");
          console.warn("[og-refresh] legacy signature", parsed.slug);
        }

        // Limit per slug: podpis ważny przez okno tolerancji można w tym oknie
        // powtórzyć, a każde trafienie unieważnia cache og:image u scraperów.
        // FAIL-CLOSED - awaria licznika nie może otwierać darmowego powtarzania.
        const { rateLimit } = await import("@/lib/server/rate-limit.server");
        const allowed = await rateLimit({
          scope: "og-refresh",
          subjectId: parsed.slug,
          max: 10,
          windowMinutes: 60,
          failClosed: true,
        });
        if (!allowed) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
            status: 429,
            headers: { "Content-Type": "application/json", "Retry-After": "3600" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const nowIso = new Date().toISOString();
        const { data, error } = await supabaseAdmin
          .from("profiles")
          .update({ updated_at: nowIso })
          .eq("slug", parsed.slug)
          .select("id, slug, updated_at")
          .maybeSingle();
        // Komunikat Postgresa niesie nazwy tabel, kolumn i ograniczeń. Ta
        // ścieżka jest za HMAC, więc waga niższa, ale kontrakt publicznych tras
        // ma być JEDEN: do klienta stały kod, do logu workera pełna treść.
        if (error) {
          console.error("[og-refresh] update failed", error.message);
          return new Response(JSON.stringify({ error: "update_failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (!data) {
          return new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        const row = data as { id: string; slug: string; updated_at: string | null };
        return Response.json({
          ok: true,
          slug: row.slug,
          version: row.updated_at ? Date.parse(row.updated_at) : Date.now(),
        });
      },
    },
  },
});
