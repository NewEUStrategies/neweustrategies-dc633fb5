// Publiczna strona darowizn / mecenatu obywatelskiego. URL: /support
// Strona informuje o mecenacie i kieruje do wpłaty. DOKĄD - rozstrzyga
// konfiguracja modułu (`site_settings.donations`): własna kasa `/donate`
// (domyślnie) albo zbiórka zewnętrzna w trybie awaryjnym. Podstawa modelu:
// docs/WDROZENIE_DAROWIZNY_WLASNY_CHECKOUT_2026-08-06.md.
import { useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CheckCircle2, ExternalLink, HandHeart, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDonationTarget } from "@/lib/billing/donationsConfigQuery";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { ensureI18n as ensureSupportI18n } from "@/lib/i18n-support";
import { resolvedContentQueryOptions, type PageData } from "@/lib/queries/public";
import { ContentRenderer } from "@/components/content/ContentRenderer";
import { prepareContentForRender } from "@/lib/content/prepareContent";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { hasRenderableBody } from "@/lib/access/gating";
import { FootnotesList, FootnoteTooltips } from "@/components/Footnotes";
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { withBudget } from "@/lib/asyncBudget";
import { SUPPORT_DOC_BUDGET_MS, SUPPORT_SEGMENTS } from "@/lib/supportRouteConfig";

// Dokument buildera dla /support jest opcjonalny: gdy redakcja opublikuje
// stronę o tym adresie, jest ona ŹRÓDŁEM PRAWDY dla całego widoku. Bez takiej
// strony trasa renderuje wbudowaną sekcję mecenatu z linkiem do zbiórki.
export const Route = createFileRoute("/support")({
  component: SupportPage,
  loader: async ({ context }) => {
    await withBudget(
      context.queryClient
        .ensureQueryData(resolvedContentQueryOptions(SUPPORT_SEGMENTS))
        .catch(() => null),
      SUPPORT_DOC_BUDGET_MS,
    );
  },
  head: () => {
    const url = getRequestUrl() || "/support";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title:
        lang === "en"
          ? "Support us - New European Strategies"
          : "Wesprzyj nas - New European Strategies",
      description:
        lang === "en"
          ? "Citizen patronage funds our independent analysis: the EU legislative tracker, reports and debates."
          : "Mecenat obywatelski finansuje naszą niezależną analizę: tracker legislacyjny UE, raporty i debaty.",
    });
  },
});

/**
 * Widok strony zbudowanej w panelu (builder / bloki / HTML). Zwraca `null`,
 * gdy dokumentu nie ma albo jest pusty - wtedy trasa pokazuje sekcję wbudowaną.
 */
function SupportBuilderDocument({ page, lang }: { page: PageData; lang: "pl" | "en" }) {
  const blocksData = (page.blocks_data as LocalizedBlocks | null) ?? null;
  const blocksDoc: BlocksDoc | null = blocksData
    ? (blocksData[lang] ?? blocksData.pl ?? blocksData.en ?? null)
    : null;
  const prepared = prepareContentForRender({
    editor: page.editor,
    builderDoc: parseBuilderDoc(page.builder_data),
    blocksDoc,
    rawHtml:
      (lang === "en" ? page.content_en || page.content_pl : page.content_pl || page.content_en) ??
      "",
    lang,
  });

  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={contentRef} data-cms-content>
      <FootnoteTooltips notes={prepared.footnotes} containerRef={contentRef} />
      <ContentRenderer
        editor={page.editor}
        builderDoc={prepared.builderDoc}
        blocksDoc={prepared.blocksDoc}
        html={prepared.html}
        lang={lang}
        stream
      />
      <FootnotesList notes={prepared.footnotes} lang={lang} />
    </div>
  );
}

/**
 * Karta wpłaty. Dokąd prowadzi przycisk, decyduje konfiguracja modułu
 * (`resolveDonationTarget`), nie ta trasa: nasza kasa `/donate`, zbiórka
 * zewnętrzna w nowej karcie albo komunikat o wstrzymanej zbiórce. Dzięki temu
 * strona wsparcia, CTA widgetu i formularz mówią zawsze to samo.
 */
function SupportGiftCard() {
  const { t } = useTranslation();
  const target = useDonationTarget();

  if (target.kind === "disabled") {
    return (
      <Card className="mt-8">
        <CardContent className="pt-6 text-center text-sm text-muted-foreground">
          {t("support.closed")}
        </CardContent>
      </Card>
    );
  }

  const external = target.kind === "external";
  return (
    <Card className="mt-8">
      <CardContent className="space-y-4 pt-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t(external ? "support.externalLead" : "support.ctaLead")}
        </p>
        <Button asChild className="w-full" size="lg">
          {external ? (
            <a href={target.href} target="_blank" rel="noopener noreferrer">
              <HandHeart className="h-4 w-4" aria-hidden="true" />
              {t("support.externalCta")}
              <ExternalLink className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
            </a>
          ) : (
            <Link to={target.href}>
              <HandHeart className="h-4 w-4" aria-hidden="true" />
              {t("support.cta")}
            </Link>
          )}
        </Button>
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {t(external ? "support.externalNote" : "support.ctaNote")}
        </p>
      </CardContent>
    </Card>
  );
}

function SupportPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureSupportI18n();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";

  // Dokument z panelu wygrywa z sekcją wbudowaną - patrz komentarz przy
  // SUPPORT_SEGMENTS. Zwykłe useQuery (nie suspense): brak dokumentu lub błąd
  // sieci degraduje się do sekcji wbudowanej zamiast wywracać stronę.
  const docQ = useQuery({
    ...resolvedContentQueryOptions(SUPPORT_SEGMENTS),
    retry: false,
  });
  const builderPage = docQ.data && docQ.data.kind === "page" ? (docQ.data.item as PageData) : null;
  const hasBuilderDoc =
    !!builderPage &&
    hasRenderableBody({
      content_pl: builderPage.content_pl,
      content_en: builderPage.content_en,
      builder_data: builderPage.builder_data,
      blocks_data: builderPage.blocks_data ?? null,
    });

  if (hasBuilderDoc && builderPage) {
    return <SupportBuilderDocument page={builderPage} lang={lang} />;
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12">
      <Button
        asChild
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 rounded-md px-3 text-xs font-medium"
      >
        <Link to="/pricing">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {t("support.backToPricing")}
        </Link>
      </Button>

      <h1 className="mt-6 flex items-start gap-2 text-3xl font-bold">
        <HandHeart className="mt-1 h-7 w-7 shrink-0 text-primary" aria-hidden="true" />
        {t("support.title")}
      </h1>
      <p className="mt-3 text-muted-foreground">{t("support.intro")}</p>

      <SupportGiftCard />

      <section className="mt-10" aria-labelledby="support-why">
        <h2 id="support-why" className="text-lg font-semibold">
          {t("support.whyTitle")}
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {/* Punkty czytane per klucz, nie jedną tablicą przez `returnObjects`:
              bramka rozjazdu kod <-> słownik widzi jako wpis tylko liść
              tekstowy, więc tablica pod kluczem uchodziła za klucz
              nieistniejący w obu językach. */}
          {[
            t("support.whyItems.policy"),
            t("support.whyItems.openAccess"),
            t("support.whyItems.community"),
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
