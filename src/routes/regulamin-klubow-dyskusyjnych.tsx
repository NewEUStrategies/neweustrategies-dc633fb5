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
import { anyDegraded, loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { LEGAL_ENTITY } from "@/lib/legal/entity";
import { CLUBS_CONTENT } from "@/lib/legal/content/clubs";
import { CLUBS_META } from "@/lib/legal/meta";
import {
  legalDocumentQueryOptions,
  useLegalDocumentCopy,
  NO_LEGAL_DOCUMENT,
} from "@/lib/legal/useLegalDocument";

const COPY = CLUBS_CONTENT;

export const Route = createFileRoute("/regulamin-klubow-dyskusyjnych")({
  component: ClubRulesPage,
  loader: async ({ context }) => {
    // Oba odczyty pod JEDNYM krótkim terminem (F10): to nadpisania SEO i wersja
    // dokumentu, nie warunek renderu - treść bazowa żyje w kodzie.
    const deadlineAt = Date.now() + LEGAL_SSR_BUDGET_MS;
    const [seo, document] = await Promise.all([
      loadResilient(
        context.queryClient,
        staticPageSeoQueryOptions("regulamin-klubow-dyskusyjnych"),
        NO_STATIC_SEO,
        {
          deadlineAt,
          label: "legal-seo:regulamin-klubow-dyskusyjnych",
        },
      ),
      loadResilient(context.queryClient, legalDocumentQueryOptions("clubs"), NO_LEGAL_DOCUMENT, {
        deadlineAt,
        label: "legal-doc:clubs",
      }),
    ]);
    // Render zdegradowany (treść bazowa zamiast opublikowanej wersji) nie może
    // zamarznąć na brzegu jako wariant wszystkich czytelników.
    setCacheControlHeader(resilientCacheControl(anyDegraded(seo, document)));
    return { seo: seo.data };
  },
  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/regulamin-klubow-dyskusyjnych";
    const lang = activeLang(url);
    // Meta z lekkiego modułu lib/legal/meta.ts - NIE z COPY: stała wspólna dla
    // head() i komponentu ląduje w module ?tsr-shared, czyli w chunku wejściowym
    // każdej strony, razem z pełną treścią dokumentu.
    const c = CLUBS_META[lang];
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

function ClubRulesPage() {
  const url =
    typeof window !== "undefined" ? window.location.pathname : "/regulamin-klubow-dyskusyjnych";
  const c = useLegalDocumentCopy("clubs", COPY, activeLang(url));
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
