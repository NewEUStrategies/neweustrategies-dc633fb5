// Publiczna strona prawna. Treść bazowa żyje w @/lib/legal/content, a
// opublikowana wersja z panelu (/admin/versions) ma pierwszeństwo.
import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/LegalPage";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import { staticPageSeoQueryOptions, pickStaticSeo } from "@/lib/queries/staticPageSeo";
import { LEGAL_ENTITY } from "@/lib/legal/entity";
import { PRIVACY_CONTENT } from "@/lib/legal/content/privacy";
import { useLegalDocumentCopy } from "@/lib/legal/useLegalDocument";

const COPY = PRIVACY_CONTENT;

export const Route = createFileRoute("/polityka-prywatnosci")({
  component: PrivacyPolicyPage,
  loader: async ({ context }) => {
    const seo = await context.queryClient
      .ensureQueryData(staticPageSeoQueryOptions("polityka-prywatnosci"))
      .catch(() => null);
    return { seo };
  },
  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/polityka-prywatnosci";
    const lang = activeLang(url);
    const c = COPY[lang];
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

function PrivacyPolicyPage() {
  const url = typeof window !== "undefined" ? window.location.pathname : "/polityka-prywatnosci";
  const c = useLegalDocumentCopy("privacy", COPY, activeLang(url));
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
