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
import { AI_TRANSPARENCY_CONTENT } from "@/lib/legal/content/aiTransparency";
import { AI_TRANSPARENCY_META } from "@/lib/legal/meta";
import { legalDocumentQueryOptions, useLegalDocumentCopy } from "@/lib/legal/useLegalDocument";

const COPY = AI_TRANSPARENCY_CONTENT;

export const Route = createFileRoute("/przejrzystosc-ai")({
  component: AiTransparencyPage,
  loader: async ({ context }) => {
    const [seo] = await Promise.all([
      context.queryClient
        .ensureQueryData(staticPageSeoQueryOptions("przejrzystosc-ai"))
        .catch(() => null),
      context.queryClient
        .ensureQueryData(legalDocumentQueryOptions("ai_transparency"))
        .catch(() => null),
    ]);
    return { seo };
  },
  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/przejrzystosc-ai";
    const lang = activeLang(url);
    // Meta z lekkiego modułu lib/legal/meta.ts - NIE z COPY: stała wspólna dla
    // head() i komponentu ląduje w module ?tsr-shared, czyli w chunku wejściowym
    // każdej strony, razem z pełną treścią dokumentu.
    const c = AI_TRANSPARENCY_META[lang];
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

function AiTransparencyPage() {
  const url = typeof window !== "undefined" ? window.location.pathname : "/przejrzystosc-ai";
  const c = useLegalDocumentCopy("ai_transparency", COPY, activeLang(url));
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
