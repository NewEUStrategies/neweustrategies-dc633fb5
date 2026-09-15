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
import { DATA_PROCESSING_CONTENT } from "@/lib/legal/content/dataProcessing";
import { DATA_PROCESSING_META } from "@/lib/legal/meta";
import { legalDocumentQueryOptions, useLegalDocumentCopy } from "@/lib/legal/useLegalDocument";

const COPY = DATA_PROCESSING_CONTENT;

export const Route = createFileRoute("/polityka-przetwarzania-danych")({
  component: DataProcessingPage,
  loader: async ({ context }) => {
    const [seo] = await Promise.all([
      context.queryClient
        .ensureQueryData(staticPageSeoQueryOptions("polityka-przetwarzania-danych"))
        .catch(() => null),
      context.queryClient
        .ensureQueryData(legalDocumentQueryOptions("data_processing"))
        .catch(() => null),
    ]);
    return { seo };
  },
  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/polityka-przetwarzania-danych";
    const lang = activeLang(url);
    // Meta z lekkiego modułu lib/legal/meta.ts - NIE z COPY: stała wspólna dla
    // head() i komponentu ląduje w module ?tsr-shared, czyli w chunku wejściowym
    // każdej strony, razem z pełną treścią dokumentu.
    const c = DATA_PROCESSING_META[lang];
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

function DataProcessingPage() {
  const url =
    typeof window !== "undefined" ? window.location.pathname : "/polityka-przetwarzania-danych";
  const c = useLegalDocumentCopy("data_processing", COPY, activeLang(url));
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
