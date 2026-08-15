// Strona potwierdzenia po zakupie (/checkout/success).
// Źródłem prawdy dla układu jest - o ile istnieje - dokument buildera pod
// adresem /checkout-success: redakcja może zbudować całą sekcję w CMS,
// wstawiając widget "Potwierdzenie zakupu" (portal klienta + data końca
// dostępu) obok dowolnych innych widgetów. Bez takiego dokumentu trasa
// renderuje ten sam widget z ustawieniami domyślnymi - zero konfiguracji.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { AppLink } from "@/components/atoms/AppLink";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { billingKeys } from "@/lib/billing/keys";
import { finalizeCheckout } from "@/lib/billing/checkout.functions";
import { safeReturnPath } from "@/lib/billing/returnPath";
import { ensureI18n as ensureProfileI18n } from "@/lib/i18n-profile";
import { PurchaseConfirmationView } from "@/components/builder/organisms/widget-view/PurchaseConfirmationView";
import { resolvedContentQueryOptions, type PageData } from "@/lib/queries/public";
import { ContentRenderer } from "@/components/content/ContentRenderer";
import { prepareContentForRender } from "@/lib/content/prepareContent";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { hasRenderableBody } from "@/lib/access/gating";
import { FootnotesList, FootnoteTooltips } from "@/components/Footnotes";
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { withBudget } from "@/lib/asyncBudget";

// Slug dokumentu redakcyjnego. Brak strony = wbudowany widok.
const DOC_SEGMENTS = ["checkout-success"];
// Twardy budżet SSR: brak dokumentu nie może opóźnić potwierdzenia zakupu.
const DOC_BUDGET_MS = 2_000;

export const Route = createFileRoute("/checkout/success")({
  validateSearch: (search: Record<string, unknown>) => ({
    order: typeof search.order === "string" ? search.order : undefined,
    mock: search.mock === 1 || search.mock === "1" ? 1 : undefined,
  }),
  component: SuccessPage,
  loader: async ({ context }) => {
    await withBudget(
      context.queryClient
        .ensureQueryData(resolvedContentQueryOptions(DOC_SEGMENTS))
        .catch(() => null),
      DOC_BUDGET_MS,
    );
  },
  head: () => ({
    meta: [
      { title: "Potwierdzenie zakupu - New European Strategies" },
      {
        name: "description",
        content:
          "Potwierdzenie zakupu: zakres dostępu, data jego zakończenia oraz portal klienta do zarządzania płatnościami.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const RETURN_KEY = "checkout:returnTo";

function BuilderDocument({ page, lang }: { page: PageData; lang: "pl" | "en" }) {
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

function SuccessPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureProfileI18n();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const { order, mock } = Route.useSearch();
  const finalize = useServerFn(finalizeCheckout);
  const queryClient = useQueryClient();

  const docQ = useQuery({ ...resolvedContentQueryOptions(DOC_SEGMENTS), retry: false });
  const builderPage = docQ.data && docQ.data.kind === "page" ? (docQ.data.item as PageData) : null;
  const hasBuilderDoc =
    !!builderPage &&
    hasRenderableBody({
      content_pl: builderPage.content_pl,
      content_en: builderPage.content_en,
      builder_data: builderPage.builder_data,
      blocks_data: builderPage.blocks_data ?? null,
    });

  // Where the buyer was before checkout (e.g. the paywalled article they were
  // reading), captured by the Paywall so we can send them back to it instead of
  // dead-ending on the profile.
  //
  // BEZPIECZEŃSTWO: wartość pochodzi z `sessionStorage`, czyli z powierzchni,
  // którą kontroluje przeglądarka - nie serwer. Sam warunek "zaczyna się od /"
  // przepuszczał `//host` oraz `/\host`, a to adresy PROTOCOL-RELATIVE: <AppLink>
  // renderuje je jako surowy `href`, `toClientHref` odmawia przejęcia kliknięcia
  // i przeglądarka wyprowadza kupującego na obcą domenę - dokładnie w momencie,
  // w którym właśnie zapłacił i ufa stronie. Sanityzacja idzie więc przez ten sam
  // `safeReturnPath`, którym filtrujemy adresy powrotu wysyłane do operatora
  // (schematy, CR/LF, przekroczona długość, protocol-relative).
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(RETURN_KEY);
      // Klucz jest jednorazowy - czyścimy go niezależnie od wyniku walidacji.
      sessionStorage.removeItem(RETURN_KEY);
      const safe = safeReturnPath(stored, "");
      // `/checkout` i `/profile` odpadają jako cel powrotu: pierwszy zapętla
      // lejek, drugi jest już dostępny z samego widoku potwierdzenia.
      if (safe && !safe.startsWith("/checkout") && !safe.startsWith("/profile")) {
        setReturnTo(safe);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // In mock mode (no payment provider) there is no webhook, so finalise the
  // order here. In BOTH modes drop every entitlement-bearing cache: tier
  // badge/gating (current-tier), subscription + orders on the profile, and
  // resolved content bodies - the buyer must see the purchase everywhere
  // without a reload.
  useEffect(() => {
    let cancelled = false;
    const invalidateEntitlements = () => {
      void queryClient.invalidateQueries({ queryKey: ["public", "resolved"] });
      void queryClient.invalidateQueries({ queryKey: ["unlocked-body"] });
      void queryClient.invalidateQueries({ queryKey: billingKeys.mySubscriptionAll() });
      void queryClient.invalidateQueries({ queryKey: billingKeys.myStripeSubscriptionAll() });
      void queryClient.invalidateQueries({ queryKey: billingKeys.myOrdersAll() });
      void queryClient.invalidateQueries({ queryKey: billingKeys.currentTierAll() });
    };
    if (!mock || !order) {
      invalidateEntitlements();
      return;
    }
    void (async () => {
      try {
        await finalize({ data: { order_id: order } });
      } catch {
        /* surfaced on the orders page; success UI stays optimistic */
      }
      if (cancelled) return;
      invalidateEntitlements();
    })();
    return () => {
      cancelled = true;
    };
  }, [mock, order, finalize, queryClient]);

  return (
    <div className="container mx-auto max-w-3xl py-16">
      {hasBuilderDoc && builderPage ? (
        <BuilderDocument page={builderPage} lang={lang} />
      ) : (
        <PurchaseConfirmationView c={{}} lang={lang} />
      )}
      {returnTo ? (
        <div className="mt-6 flex justify-center">
          <Button asChild className="h-12 rounded-[6px]">
            <AppLink href={returnTo}>{t("checkout.continueReading")}</AppLink>
          </Button>
        </div>
      ) : (
        <div className="mt-6 flex justify-center">
          <Button asChild variant="ghost" className="h-12 rounded-[6px]">
            <Link to="/">{lang === "en" ? "Back to homepage" : "Wróć na stronę główną"}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
