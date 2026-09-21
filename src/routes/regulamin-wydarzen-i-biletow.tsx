// Publiczna strona prawna. Treść bazowa żyje w @/lib/legal/content, a
// opublikowana wersja z panelu (/admin/versions) ma pierwszeństwo.
//
// LOADER GRZEJE OBA KLUCZE - SEO i TREŚĆ. Rozgrzanie samego SEO oddawałoby
// w SSR treść bazową z kodu, a opublikowaną wersję podmieniało dopiero po
// hydracji. Fabryka `legalDocumentQueryOptions` jest ta sama, którą czyta
// `useLegalDocumentCopy`, więc dokument jedzie w pierwszym renderze.
import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/LegalPage";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import {
  staticPageSeoQueryOptions,
  pickStaticSeo,
  LEGAL_SSR_BUDGET_MS,
  NO_STATIC_SEO,
} from "@/lib/queries/staticPageSeo";
import { anyDegraded, loadResilient } from "@/lib/ssr/resilientLoad";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { staticFallbackCacheControl } from "@/lib/http/cachePolicy";
import { LEGAL_ENTITY } from "@/lib/legal/entity";
import { EVENTS_CONTENT } from "@/lib/legal/content/events";
import { EVENTS_META } from "@/lib/legal/meta";
import {
  legalDocumentQueryOptions,
  useLegalDocumentCopy,
  NO_LEGAL_DOCUMENT,
} from "@/lib/legal/useLegalDocument";

const COPY = EVENTS_CONTENT;

export const Route = createFileRoute("/regulamin-wydarzen-i-biletow")({
  component: EventTermsPage,
  loader: async ({ context }) => {
    // Oba odczyty pod JEDNYM krótkim terminem (F10): to nadpisania SEO i wersja
    // dokumentu, nie warunek renderu - treść bazowa żyje w kodzie.
    const deadlineAt = Date.now() + LEGAL_SSR_BUDGET_MS;
    const [seo, document] = await Promise.all([
      loadResilient(
        context.queryClient,
        staticPageSeoQueryOptions("regulamin-wydarzen-i-biletow"),
        NO_STATIC_SEO,
        {
          deadlineAt,
          label: "legal-seo:regulamin-wydarzen-i-biletow",
        },
      ),
      loadResilient(context.queryClient, legalDocumentQueryOptions("events"), NO_LEGAL_DOCUMENT, {
        deadlineAt,
        label: "legal-doc:events",
      }),
    ]);
    // Treść bazowa zamiast opublikowanej wersji to dokument KOMPLETNY dla
    // czytelnika, tylko niekanoniczny dla brzegu - stąd krótka świeżość
    // z rewalidacją zamiast `no-store` (różnica wobec `resilientCacheControl`:
    // docblock helpera).
    setCacheControlHeader(staticFallbackCacheControl(anyDegraded(seo, document)));
    return { seo: seo.data };
  },
  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/regulamin-wydarzen-i-biletow";
    const lang = activeLang(url);
    // Meta z lekkiego modułu lib/legal/meta.ts - NIE z COPY: stała wspólna dla
    // head() i komponentu ląduje w module ?tsr-shared, czyli w chunku wejściowym
    // każdej strony, razem z pełną treścią dokumentu.
    const c = EVENTS_META[lang];
    const seo = pickStaticSeo(loaderData?.seo ?? null, lang, {
      title: `${c.title} - ${LEGAL_ENTITY}`,
      description: c.lead,
    });
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: seo.title,
      description: seo.description,
      image: seo.image ?? undefined,
      robots: seo.noindex ? "noindex,nofollow" : undefined,
      canonicalOverride: seo.canonical ?? undefined,
    });
  },
});

function EventTermsPage() {
  const url =
    typeof window !== "undefined" ? window.location.pathname : "/regulamin-wydarzen-i-biletow";
  const c = useLegalDocumentCopy("events", COPY, activeLang(url));
  return (
    <LegalPage
      eyebrow={c.eyebrow}
      title={c.title}
      lead={c.lead}
      updatedLabel={c.updated}
      sections={c.sections}
      footnote={c.footnote}
    />
  );
}
