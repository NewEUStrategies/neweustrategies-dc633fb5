// Strona podziękowania po powrocie z nakładki płatności darowizny.
// URL: /support/thank-you?txn=txn_...  (identyfikator transakcji dokładamy do
// successUrl już przy jej tworzeniu, więc nie zależymy od parametrów, które
// operator dokleja po swojej stronie - `_ptxn` / `transaction_id` są jednak
// akceptowane jako zapasowe źródło).
//
// Status czytamy z API operatora przez `getDonationTransactionStatus` (tylko
// status/kwota/waluta - bez PII). Zaksięgowanie darowizny i mail robi webhook,
// więc ta strona jest wyłącznie informacyjna i bezpieczna do odświeżania.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Clock, HandHeart, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDonationTransactionStatus } from "@/lib/billing/donations.functions";
import { getPaddleEnvironment } from "@/lib/paddle";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { ensureI18n as ensureSupportI18n } from "@/lib/i18n-support";

function readTxn(search: Record<string, unknown>): string | undefined {
  for (const key of ["txn", "_ptxn", "transaction_id"]) {
    const value = search[key];
    if (typeof value === "string" && /^txn_[a-zA-Z0-9]+$/.test(value)) return value;
  }
  return undefined;
}

export const Route = createFileRoute("/support/thank-you")({
  validateSearch: (search: Record<string, unknown>) => ({ txn: readTxn(search) }),
  component: DonationThankYouPage,
  head: () => {
    const lang = activeLang(getRequestUrl() || "/support/thank-you");
    const title =
      lang === "en"
        ? "Thank you for your donation - New European Strategies"
        : "Dziękujemy za darowiznę - New European Strategies";
    return {
      meta: [
        { title },
        // Strona potwierdzenia nigdy nie powinna trafić do indeksu.
        { name: "robots", content: "noindex, nofollow" },
        { property: "og:title", content: title },
        { property: "og:type", content: "website" },
      ],
    };
  },
});

/** Grupy statusów operatora sprowadzone do trzech stanów interfejsu. */
type UiState = "paid" | "pending" | "failed" | "unknown";

function uiStateFor(status: string | null): UiState {
  switch (status) {
    case "paid":
    case "completed":
      return "paid";
    case "ready":
    case "billed":
    case "draft":
      return "pending";
    case "canceled":
    case "past_due":
      return "failed";
    default:
      return "unknown";
  }
}

function DonationThankYouPage() {
  ensureSupportI18n();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const { txn } = Route.useSearch();
  const fetchStatus = useServerFn(getDonationTransactionStatus);

  const statusQ = useQuery({
    queryKey: ["donations", "transaction-status", txn],
    enabled: Boolean(txn),
    queryFn: () =>
      fetchStatus({
        data: { transaction_id: txn as string, environment: getPaddleEnvironment() },
      }),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    // Rozliczenie u operatora bywa asynchroniczne - dopytujemy, dopóki
    // transakcja nie jest opłacona (max ~2 min dzięki oknu odświeżania).
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data?.ok) return false;
      return uiStateFor(data.status) === "pending" ? 5_000 : false;
    },
  });

  const providerStatus = statusQ.data?.ok ? statusQ.data.status : null;
  const state: UiState = txn ? uiStateFor(providerStatus) : "unknown";
  const amountCents = statusQ.data?.ok ? statusQ.data.amountCents : null;
  const currency = (statusQ.data?.ok ? statusQ.data.currency : null) ?? (lang === "en" ? "EUR" : "PLN");

  const amountLabel =
    typeof amountCents === "number"
      ? new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-GB", {
          style: "currency",
          currency,
        }).format(amountCents / 100)
      : null;

  const statusLabel = providerStatus
    ? t(`support.thanks.statuses.${providerStatus}`, { defaultValue: providerStatus })
    : null;

  const titleKey =
    state === "paid"
      ? "support.thanks.title"
      : state === "pending"
        ? "support.thanks.pendingTitle"
        : state === "failed"
          ? "support.thanks.failedTitle"
          : "support.thanks.unknownTitle";
  const bodyKey =
    state === "paid"
      ? "support.thanks.paidBody"
      : state === "pending"
        ? "support.thanks.pendingBody"
        : state === "failed"
          ? "support.thanks.failedBody"
          : "support.thanks.unknownBody";

  const Icon =
    state === "paid" ? CheckCircle2 : state === "pending" ? Clock : state === "failed" ? XCircle : HandHeart;

  return (
    <div className="container mx-auto max-w-xl px-4 py-16">
      <Card>
        <CardContent className="space-y-5 pt-10 pb-8 text-center">
          <Icon
            className={
              state === "failed" ? "mx-auto h-12 w-12 text-muted-foreground" : "mx-auto h-12 w-12 text-primary"
            }
            aria-hidden="true"
          />
          <h1 className="text-2xl font-bold">{t(titleKey)}</h1>
          <p className="text-muted-foreground">{t(bodyKey)}</p>

          {statusQ.isLoading && (
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t("support.thanks.checking")}
            </p>
          )}

          {(statusLabel || amountLabel || txn) && (
            <dl className="mx-auto max-w-sm space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-4 text-left text-[0.8125rem]">
              {statusLabel && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t("support.thanks.statusLabel")}</dt>
                  <dd className="font-medium">{statusLabel}</dd>
                </div>
              )}
              {amountLabel && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t("support.thanks.amountLabel")}</dt>
                  <dd className="font-medium tabular-nums">{amountLabel}</dd>
                </div>
              )}
              {txn && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t("support.thanks.transactionLabel")}</dt>
                  <dd className="truncate font-mono text-xs">{txn}</dd>
                </div>
              )}
            </dl>
          )}

          {state === "paid" && (
            <p className="text-xs text-muted-foreground">{t("support.thanks.messageNote")}</p>
          )}

          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {txn && state !== "paid" && (
              <Button variant="outline" onClick={() => void statusQ.refetch()} disabled={statusQ.isFetching}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {t("support.thanks.refresh")}
              </Button>
            )}
            <Button asChild variant="outline">
              <Link to="/">{t("support.backHome")}</Link>
            </Button>
            <Button asChild>
              <Link to="/support" search={{ status: undefined }}>
                {t("support.another")}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
