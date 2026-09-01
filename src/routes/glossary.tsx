// Publiczny słowniczek pojęć (A7): /glossary - lista alfabetyczna z
// definicjami PL/EN + JSON-LD DefinedTermSet/DefinedTerm (long-tail SEO).
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import { glossaryTermsQueryOptions } from "@/lib/queries/glossary";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead, SITE_NAME } from "@/lib/seo/meta";
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import type { GlossaryTerm } from "@/lib/queries/glossary";

const COPY = {
  pl: {
    title: "Słowniczek pojęć",
    subtitle: "Kluczowe terminy polityki europejskiej używane w naszych analizach.",
    empty: "Słowniczek jest w przygotowaniu.",
  },
  en: {
    title: "Glossary",
    subtitle: "Key European policy terms used across our analyses.",
    empty: "The glossary is being prepared.",
  },
} as const;

/** Fallback zdegradowanego renderu (patrz lib/ssr/resilientLoad). */
const NO_TERMS: GlossaryTerm[] = [];

export const Route = createFileRoute("/glossary")({
  // LOADER, KTÓREGO TA TRASA NIE MIAŁA. Bez niego SSR nie zawierał ani jednego
  // terminu, a węzeł JSON-LD `DefinedTermSet` był z konstrukcji `null`
  // (`if (!terms || terms.length === 0) return null`). Cała wartość tej strony
  // to long-tail SEO, więc brak węzła strukturalnego kasował jej sens - a HTML
  // bez terminów wchodził do NES Edge Cache na do 24 h.
  //
  // Ta trasa NIE ma tu `notFound()`: pusty słowniczek jest legalnym stanem
  // (redakcja go dopiero uzupełnia) i ma własny, dwujęzyczny komunikat.
  loader: async ({ context }) => {
    const { degraded } = await loadResilient(
      context.queryClient,
      glossaryTermsQueryOptions(),
      NO_TERMS,
    );
    setCacheControlHeader(resilientCacheControl(degraded));
    return { degraded };
  },
  head: () => {
    const url = getRequestUrl() || "/glossary";
    const lang = activeLang(url);
    const c = COPY[lang];
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: `${c.title} - ${SITE_NAME}`,
      description: c.subtitle,
    });
  },
  component: GlossaryPage,
});

function GlossaryPage() {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const c = COPY[lang];
  // Loader rozgrzał ten klucz, więc terminy i węzeł JSON-LD schodzą z SERWERA.
  const { data: terms } = useSuspenseQuery(glossaryTermsQueryOptions());

  const groups = useMemo(() => {
    const map = new Map<string, typeof terms>();
    for (const term of terms ?? []) {
      const label = lang === "en" ? term.term_en || term.term_pl : term.term_pl;
      const letter = (label[0] ?? "#").toLocaleUpperCase(lang === "en" ? "en" : "pl");
      const list = map.get(letter) ?? [];
      list.push(term);
      map.set(letter, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, lang));
  }, [terms, lang]);

  // DefinedTermSet dla wyszukiwarek - definicje są danymi publicznymi.
  const jsonLd = useMemo(() => {
    if (!terms || terms.length === 0) return null;
    return JSON.stringify({
      "@context": "https://schema.org",
      "@type": "DefinedTermSet",
      name: `${c.title} - ${SITE_NAME}`,
      hasDefinedTerm: terms.slice(0, 200).map((term) => ({
        "@type": "DefinedTerm",
        name: lang === "en" ? term.term_en || term.term_pl : term.term_pl,
        description: lang === "en" ? term.definition_en || term.definition_pl : term.definition_pl,
      })),
    }).replace(/</g, "\\u003c");
  }, [terms, lang, c.title]);

  return (
    <div className="flex-1 bg-background text-foreground">
      <div className="container mx-auto max-w-3xl px-4 py-10 lg:py-14">
        <header className="mb-10">
          <h1 className="font-display text-3xl lg:text-4xl">{c.title}</h1>
          <p className="mt-2 text-muted-foreground">{c.subtitle}</p>
        </header>
        {(terms ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{c.empty}</p>
        ) : (
          <dl className="space-y-8">
            {groups.map(([letter, items]) => (
              <section key={letter} aria-label={letter}>
                <h2 className="font-display text-lg text-brand mb-3">{letter}</h2>
                <div className="space-y-4">
                  {(items ?? []).map((term) => (
                    <div key={term.id} id={term.slug}>
                      <dt className="font-semibold">
                        {lang === "en" ? term.term_en || term.term_pl : term.term_pl}
                      </dt>
                      <dd className="text-sm text-muted-foreground mt-0.5">
                        {lang === "en"
                          ? term.definition_en || term.definition_pl
                          : term.definition_pl}
                      </dd>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </dl>
        )}
      </div>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />}
    </div>
  );
}
