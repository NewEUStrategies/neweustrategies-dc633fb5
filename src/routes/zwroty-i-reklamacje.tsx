// Publiczna strona prawna. Treść bazowa żyje w @/lib/legal/content, a
// opublikowana wersja z panelu (/admin/versions) ma pierwszeństwo.
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
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { LEGAL_ENTITY } from "@/lib/legal/entity";
import { REFUNDS_CONTENT } from "@/lib/legal/content/refunds";
import { REFUNDS_META } from "@/lib/legal/meta";
import { useLegalDocumentCopy } from "@/lib/legal/useLegalDocument";

const COPY = REFUNDS_CONTENT;

export const Route = createFileRoute("/zwroty-i-reklamacje")({
  component: RefundPolicyPage,
  loader: async ({ context }) => {
    // Krótki termin (F10): to wyłącznie nadpisania SEO z /admin/pages - treść
    // strony żyje w kodzie, więc brak wiersza nie jest warunkiem renderu.
    const seo = await loadResilient(
      context.queryClient,
      staticPageSeoQueryOptions("zwroty-i-reklamacje"),
      NO_STATIC_SEO,
      { deadlineAt: Date.now() + LEGAL_SSR_BUDGET_MS, label: "legal-seo:zwroty-i-reklamacje" },
    );
    setCacheControlHeader(resilientCacheControl(seo.degraded));
    return { seo: seo.data };
  },
  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/zwroty-i-reklamacje";
    const lang = activeLang(url);
    // Meta z lekkiego modułu lib/legal/meta.ts - NIE z COPY: stała wspólna dla
    // head() i komponentu ląduje w module ?tsr-shared, czyli w chunku wejściowym
    // każdej strony, razem z pełną treścią dokumentu.
    const c = REFUNDS_META[lang];
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

function RefundPolicyPage() {
  const url = typeof window !== "undefined" ? window.location.pathname : "/zwroty-i-reklamacje";
  const c = useLegalDocumentCopy("refunds", COPY, activeLang(url));
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
