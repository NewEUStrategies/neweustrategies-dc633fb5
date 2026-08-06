// Dynamic robots.txt.
// - On canonical hosts (brand domain or a tenant's own domain): allow indexing,
//   apply the editorial AI-crawler policy and advertise every sitemap surface.
// - On non-canonical hosts of this deployment (hosting-layer aliases, legacy
//   domains from `LEGACY_HOST_SUFFIXES`, editor/local previews): fully disallow,
//   so search engines drop cached alias URLs instead of keeping a duplicate of
//   the site.
// - On hosts no tenant has claimed: safe default of full disallow.
//
// Klasyfikacja hosta jest JEDNA dla całego SEO (`lib/http/host.ts`), wspólna
// z przekierowaniem kanonicznym i powierzchniami sitemapy - host nie może być
// jednocześnie kanonizowany 301 i ogłaszany jako indeksowalny - a origin, na
// którym ogłaszamy mapy, liczy ta sama funkcja co dla samych map
// (`crawlerPublishOrigin`).
//
// UWAGA WDROŻENIOWA: ta trasa działa TYLKO dopóki w `public/` nie ma pliku
// `robots.txt`. Statyczny asset z `.output/public/` wygrywa z workerem, więc
// zacommitowany `public/robots.txt` czynił całą tę logikę nieosiągalną na
// produkcji (finding 2026-08-06). Pilnuje tego bramka CI
// `src/lib/ci/__tests__/staticAssetShadowing.test.ts` plus test e2e sprawdzający,
// że odpowiedź pochodzi z trasy (nagłówek `X-Robots-Tag`).
//
// Do 2026-08-03 deklarowana była JEDNA sitemapa (/sitemap.xml), więc
// /news-sitemap.xml - trasa istniejąca i wymagana przez Google News - nie był
// odkrywalny ŻADNYM kanałem: ani z robots.txt, ani z indeksu (indeksu nie było).
// Teraz robots.txt ogłasza indeks + news sitemap, a treść składa czysty builder
// (@/lib/seo/robots), objęty testem kontraktu.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { buildRobotsTxt } from "@/lib/seo/robots";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const req = getRequest();
        const host = (await trustedPublicHost(req)) ?? "";
        const proto = req.headers.get("x-forwarded-proto") ?? "https";

        // Import dynamiczny: graf serwerowy (katalog tenantów, klient admina
        // Supabase) nie może wejść do bundle'a klienta przez drzewo tras.
        const { resolveRobotsPolicy } = await import("@/lib/server/robotsPolicy.server");
        const policy = await resolveRobotsPolicy(host, proto);
        const canonical = policy.mode === "canonical";

        return new Response(buildRobotsTxt(policy), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            // Nagłówek jest JEDNOCZEŚNIE sygnałem dla crawlera i znacznikiem
            // pochodzenia odpowiedzi: statyczny plik z `public/` nigdy go nie
            // wystawi, więc test e2e wykrywa nim przesłonięcie trasy.
            "X-Robots-Tag": canonical ? "all" : "noindex, nofollow",
          },
        });
      },
    },
  },
});
