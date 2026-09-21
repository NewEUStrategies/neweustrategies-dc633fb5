// AMP-owy wariant web story (/web-stories/$slug/amp). Kanoniczny viewer jest
// Reactowym slideshow - poprawny dla ludzi, ale niekwalifikujący się do
// prezentacji Web Stories w Google. Ten dokument <amp-story> powstaje z tych
// samych danych i jest podlinkowany z kanonicznej strony przez rel=amphtml.
// Service role => odczyt jawnie zawężony do tenanta hosta, FAIL-CLOSED.
//
// KONTRAKT BRAKU TENANTA 2026-09-02 (N2 audytu pokrycia): jednoczłonowy
// warunek jest tu POPRAWNY i jest decyzją. Powierzchnia adresowana SLUGIEM nie
// ma stanu zdegradowanego - bez tenanta `fetchPublishedWebStoryBySlug` nie ma
// czego znaleźć, więc każda droga kończy się 404. Dodatkowo AMP wymaga
// ABSOLUTNEGO `origin` (kanoniczny link, publisher, poster), a bez zaufanego
// hosta origin jest pusty - dokument z relatywnymi adresami nie przeszedłby
// walidacji Google, więc `!origin` też musi być 404, nie „wariantem uboższym".
// Kanał, który degraduje do pustki, to wyłącznie kanał adresowany samym
// hostem: `/rss.xml`, `/podcast/rss.xml`, `/tracker/rss.xml`, `/live/rss.xml`.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { SITE_NAME } from "@/lib/seo/meta";
import { buildAmpStoryHtml, canBuildAmpStory, type AmpStoryInput } from "@/lib/seo/ampStory";
import { parseSeoSettings } from "@/lib/seo/settings";
import { safeParsePages } from "@/lib/web-stories/types";
import {
  fetchPublishedWebStoryBySlug,
  fetchSeoSettingsValue,
} from "@/lib/server/publishedContent.server";
import { resolveCrawlerTenantIdForHost } from "@/lib/server/tenant.server";

export const Route = createFileRoute("/web-stories/$slug/amp")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const req = getRequest();
        const proto = req.headers.get("x-forwarded-proto") ?? "https";
        const host = (await trustedPublicHost(req)) ?? "";
        const origin = host ? `${proto}://${host}` : "";
        const tenantId = await resolveCrawlerTenantIdForHost(host);
        if (!tenantId || !origin) {
          return new Response("Unknown host", { status: 404 });
        }

        const story = await fetchPublishedWebStoryBySlug(tenantId, params.slug);
        if (!story) return new Response("Not found", { status: 404 });

        const lang: "pl" | "en" = "pl";
        const seo = parseSeoSettings(await fetchSeoSettingsValue(tenantId));
        const input: AmpStoryInput = {
          story: { ...story, pages: safeParsePages(story.pages) },
          lang,
          origin,
          publisherName: SITE_NAME,
          publisherLogoUrl: seo.publisher_logo_url,
        };
        // Bez postera nie da się wyemitować WAŻNEGO AMP - lepszy brak wariantu
        // niż wariant, który Google odrzuci przy walidacji.
        if (!canBuildAmpStory(input)) return new Response("Not found", { status: 404 });

        return new Response(buildAmpStoryHtml(input), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
          },
        });
      },
    },
  },
});
