// Publiczna strona prawna. Treść bazowa żyje w @/lib/legal/content, a
// opublikowana wersja z panelu (/admin/versions) ma pierwszeństwo.
import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/LegalPage";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import { staticPageSeoQueryOptions, pickStaticSeo } from "@/lib/queries/staticPageSeo";
import { LEGAL_ENTITY } from "@/lib/legal/entity";
import { TERMS_CONTENT } from "@/lib/legal/content/terms";
import { TERMS_META } from "@/lib/legal/meta";
import { useLegalDocumentCopy } from "@/lib/legal/useLegalDocument";

const COPY = TERMS_CONTENT;

export const Route = createFileRoute("/regulamin")({
  component: TermsPage,
  loader: async ({ context }) => {
    const seo = await context.queryClient
      .ensureQueryData(staticPageSeoQueryOptions("regulamin"))
      .catch(() => null);
    return { seo };
  },
  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/regulamin";
    const lang = activeLang(url);
    // Meta z lekkiego modułu lib/legal/meta.ts - NIE z COPY: stała wspólna dla
    // head() i komponentu ląduje w module ?tsr-shared, czyli w chunku wejściowym
    // każdej strony, razem z pełną treścią dokumentu.
    const c = TERMS_META[lang];
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

function TermsPage() {
  const url = typeof window !== "undefined" ? window.location.pathname : "/regulamin";
  const c = useLegalDocumentCopy("terms", COPY, activeLang(url));
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
