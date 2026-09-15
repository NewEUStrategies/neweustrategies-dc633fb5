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
import { COMMUNICATIONS_CONTENT } from "@/lib/legal/content/communications";
import { COMMUNICATIONS_META } from "@/lib/legal/meta";
import { legalDocumentQueryOptions, useLegalDocumentCopy } from "@/lib/legal/useLegalDocument";

const COPY = COMMUNICATIONS_CONTENT;

export const Route = createFileRoute("/komunikacja-i-marketing")({
  component: CommunicationsPage,
  loader: async ({ context }) => {
    const [seo] = await Promise.all([
      context.queryClient
        .ensureQueryData(staticPageSeoQueryOptions("komunikacja-i-marketing"))
        .catch(() => null),
      context.queryClient
        .ensureQueryData(legalDocumentQueryOptions("communications"))
        .catch(() => null),
    ]);
    return { seo };
  },
  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/komunikacja-i-marketing";
    const lang = activeLang(url);
    // Meta z lekkiego modułu lib/legal/meta.ts - NIE z COPY: stała wspólna dla
    // head() i komponentu ląduje w module ?tsr-shared, czyli w chunku wejściowym
    // każdej strony, razem z pełną treścią dokumentu.
    const c = COMMUNICATIONS_META[lang];
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

function CommunicationsPage() {
  const url = typeof window !== "undefined" ? window.location.pathname : "/komunikacja-i-marketing";
  const c = useLegalDocumentCopy("communications", COPY, activeLang(url));
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
