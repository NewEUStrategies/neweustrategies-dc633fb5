// Publiczna strona darowizn / mecenatu obywatelskiego. URL: /support
// Darowizna nie nadaje uprawnień (to nie zakup) - patrz donations.functions.ts.
// Stan ?status=cancelled wraca z nakładki płatności; sukces prowadzi do /support/thank-you.
import { useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, HandHeart, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createDonationCheckout } from "@/lib/billing/donations.functions";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";
import { getPaddleEnvironment } from "@/lib/paddle";
import {
  DONATION_MAX_CENTS,
  DONATION_MIN_CENTS,
  DONATION_PRESETS_CENTS,
  DONATION_PRESETS_CENTS_EUR,
  type DonationCurrency,
} from "@/lib/billing/donations.schema";
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

// Dokument buildera dla /support jest opcjonalny: gdy redakcja opublikuje
// stronę o tym adresie, jest ona ŹRÓDŁEM PRAWDY dla całego widoku (włącznie
// z widżetem darowizn wstawionym w panelu). Bez takiej strony trasa renderuje
// wbudowany formularz - żaden krok konfiguracji nie jest wymagany do zbierania
// wpłat.
const SUPPORT_SEGMENTS = ["support"];
// Twardy budżet SSR: brak dokumentu nie może opóźnić formularza darowizn.
const SUPPORT_DOC_BUDGET_MS = 2_500;
export const Route = createFileRoute("/support")({
  validateSearch: (search: Record<string, unknown>) => ({
    status:
      search.status === "success" || search.status === "cancelled"
        ? (search.status as "success" | "cancelled")
        : undefined,
  }),
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

function formatAmount(cents: number, lang: "pl" | "en", currency: DonationCurrency): string {
  return new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Widok strony zbudowanej w panelu (builder / bloki / HTML). Zwraca `null`,
 * gdy dokumentu nie ma albo jest pusty - wtedy trasa pokazuje formularz.
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
    rawHtml: (lang === "en" ? page.content_en || page.content_pl : page.content_pl || page.content_en) ?? "",
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

function SupportPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureSupportI18n();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const currency: DonationCurrency = lang === "en" ? "EUR" : "PLN";
  const presets = lang === "en" ? DONATION_PRESETS_CENTS_EUR : DONATION_PRESETS_CENTS;
  const { status } = Route.useSearch();
  const donate = useServerFn(createDonationCheckout);
  const { openCheckout } = usePaddleCheckout();

  // Dokument z panelu wygrywa z wbudowanym formularzem - patrz komentarz przy
  // SUPPORT_SEGMENTS. Zwykłe useQuery (nie suspense): brak dokumentu lub błąd
  // sieci degraduje się do formularza zamiast wywracać stronę.
  const docQ = useQuery({
    ...resolvedContentQueryOptions(SUPPORT_SEGMENTS),
    retry: false,
  });
  const builderPage =
    docQ.data && docQ.data.kind === "page" ? (docQ.data.item as PageData) : null;
  const hasBuilderDoc =
    !!builderPage &&
    hasRenderableBody({
      content_pl: builderPage.content_pl,
      content_en: builderPage.content_en,
      builder_data: builderPage.builder_data,
      blocks_data: builderPage.blocks_data ?? null,
    });

  const [selectedCents, setSelectedCents] = useState<number>(presets[1]);
  const [customAmount, setCustomAmount] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const effectiveCents = customAmount.trim()
    ? Math.round(Number(customAmount.replace(",", ".")) * 100)
    : selectedCents;
  const amountValid =
    Number.isFinite(effectiveCents) &&
    effectiveCents >= DONATION_MIN_CENTS &&
    effectiveCents <= DONATION_MAX_CENTS;

  const submit = async () => {
    if (!amountValid) {
      toast.error(t("support.amountError"));
      return;
    }
    setPending(true);
    try {
      const result = await donate({
        data: {
          amount_cents: effectiveCents,
          currency,
          message: message.trim() || undefined,
          lang,
          environment: getPaddleEnvironment(),
        },
      });
      if (result.ok) {
        if (result.mode === "paddle") {
          // Nakładka operatora: kwota i dane darowizny są już w transakcji,
          // klient przekazuje wyłącznie jej identyfikator.
          await openCheckout({
            transactionId: result.transactionId,
            // Strona podziękowania sama dopyta operatora o status transakcji.
            successPath: `/support/thank-you?txn=${encodeURIComponent(result.transactionId)}`,
          });
          return;
        }
        window.location.assign(result.url);
        return;
      }
      toast.error(t("support.genericError"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(
        msg.includes("rate_limited") ? t("support.rateLimited") : t("support.genericError"),
      );
    } finally {
      setPending(false);
    }
  };

  if (status === "success" || status === "cancelled") {
    const ok = status === "success";
    return (
      <div className="container mx-auto max-w-xl px-4 py-16 text-center">
        {ok ? (
          <CheckCircle2 className="mx-auto h-12 w-12 text-primary" aria-hidden="true" />
        ) : (
          <XCircle className="mx-auto h-12 w-12 text-muted-foreground" aria-hidden="true" />
        )}
        <h1 className="mt-4 text-2xl font-bold">
          {ok ? t("support.successTitle") : t("support.cancelledTitle")}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {ok ? t("support.successBody") : t("support.cancelledBody")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild variant="outline">
            <Link to="/">{t("support.backHome")}</Link>
          </Button>
          <Button asChild>
            <Link to="/support" search={{ status: undefined }}>
              {t("support.another")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

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

      <Card className="mt-8">
        <CardContent className="space-y-5 pt-6">
          <fieldset>
            <legend className="text-sm font-medium">{t("support.presetsLabel")}</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {presets.map((cents) => {
                const active = !customAmount.trim() && selectedCents === cents;
                return (
                  <Button
                    key={cents}
                    type="button"
                    variant={active ? "default" : "outline"}
                    aria-pressed={active}
                    onClick={() => {
                      setSelectedCents(cents);
                      setCustomAmount("");
                    }}
                  >
                    {formatAmount(cents, lang, currency)}
                  </Button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <Label htmlFor="donation-custom" className="text-sm font-medium">
              {t("support.customLabel", { currency })}
            </Label>
            <Input
              id="donation-custom"
              inputMode="decimal"
              className="mt-1"
              placeholder={t("support.customPlaceholder")}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              aria-invalid={customAmount.trim() !== "" && !amountValid}
            />
            {customAmount.trim() !== "" && !amountValid && (
              <p className="mt-1 text-xs text-destructive">{t("support.amountError")}</p>
            )}
          </div>

          <div>
            <Label htmlFor="donation-message" className="text-sm font-medium">
              {t("support.messageLabel")}
            </Label>
            <Textarea
              id="donation-message"
              className="mt-1"
              rows={2}
              maxLength={500}
              placeholder={t("support.messagePlaceholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          <Button className="w-full" size="lg" disabled={pending || !amountValid} onClick={submit}>
            {pending
              ? t("support.submitting")
              : `${t("support.submit")} - ${amountValid ? formatAmount(effectiveCents, lang, currency) : "…"}`}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t("support.secureNote")}
          </p>
        </CardContent>
      </Card>

      <section className="mt-10" aria-labelledby="support-why">
        <h2 id="support-why" className="text-lg font-semibold">
          {t("support.whyTitle")}
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {(t("support.whyItems", { returnObjects: true }) as unknown as string[]).map((item) => (
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
