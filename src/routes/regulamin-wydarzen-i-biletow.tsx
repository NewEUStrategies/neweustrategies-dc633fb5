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
import { staticPageSeoQueryOptions, pickStaticSeo } from "@/lib/queries/staticPageSeo";
import { LEGAL_ENTITY } from "@/lib/legal/entity";
import { EVENTS_CONTENT } from "@/lib/legal/content/events";
import { EVENTS_META } from "@/lib/legal/meta";
import { legalDocumentQueryOptions, useLegalDocumentCopy } from "@/lib/legal/useLegalDocument";

const COPY = EVENTS_CONTENT;

export const Route = createFileRoute("/regulamin-wydarzen-i-biletow")({
  component: EventTermsPage,
  loader: async ({ context }) => {
    const [seo] = await Promise.all([
      context.queryClient
        .ensureQueryData(staticPageSeoQueryOptions("regulamin-wydarzen-i-biletow"))
        .catch(() => null),
      context.queryClient.ensureQueryData(legalDocumentQueryOptions("events")).catch(() => null),
    ]);
    return { seo };
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
