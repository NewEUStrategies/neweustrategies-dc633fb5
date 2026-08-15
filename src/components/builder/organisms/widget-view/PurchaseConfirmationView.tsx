// Widget "purchase-confirmation" - sekcja potwierdzenia po zakupie.
// Pokazuje status zakupu, datę końca dostępu (lub datę odnowienia) oraz
// przycisk do portalu klienta operatora płatności (metoda płatności, faktury,
// anulowanie). Dane pochodzą z tabeli subskrypcji (filtr środowiska) i
// zamówień użytkownika; w builderze renderuje się deterministyczny podgląd,
// żeby redakcja widziała układ bez własnego zakupu.
// i18n PL/EN, tokeny motywu (dark/light), 6px rounding, SSR-safe.
import { useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  FileText,
  RefreshCw,
  ShieldCheck,
} from "@/lib/lucide-shim";
import type { WidgetContent } from "@/lib/builder/types";
import { useBuilderMode } from "@/lib/content-model/editorCanvas";
import { useAuth } from "@/hooks/useAuth";
import { billingKeys } from "@/lib/billing/keys";
import { fetchMyStripeSubscription } from "@/lib/billing/subscriptionQueries";
import { fetchMyOrders } from "@/lib/billing/queries";
import {
  buildPurchaseSummary,
  daysLeft,
  formatAccessDate,
  type PurchaseSummary,
} from "@/lib/billing/purchaseConfirmation";
import { formatMoney } from "@/lib/billing/types";
import { getStripeEnvironmentSafe } from "@/lib/stripe";
import { createStripePortalSession } from "@/utils/payments.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppLink } from "@/components/atoms/AppLink";
import { safeUrl } from "@/lib/sanitize";
import { getBool, getStr, type Lang } from "./frame";

const COPY = {
  pl: {
    heading: "Dziękujemy za zakup",
    body: "Dostęp jest już aktywny na Twoim koncie. Potwierdzenie wysłaliśmy również e-mailem.",
    accessTitle: "Dostęp",
    renewsOn: "Odnawia się",
    endsOn: "Dostęp do",
    lifetime: "Dostęp bezterminowy",
    daysLeft: (n: number) => (n === 1 ? "pozostał 1 dzień" : `pozostało ${n} dni`),
    expired: "Okres dostępu dobiegł końca",
    pendingTitle: "Potwierdzamy płatność",
    pendingBody:
      "Operator płatności przetwarza transakcję. Dostęp pojawi się tu automatycznie - zwykle w kilkanaście sekund.",
    portal: "Portal klienta",
    portalHint: "Metoda płatności, faktury i anulowanie - w panelu operatora płatności.",
    portalError: "Nie udało się otworzyć portalu klienta. Spróbuj ponownie.",
    orders: "Historia zamówień",
    profile: "Moje konto",
    continue: "Wróć do czytania",
    reference: "Numer transakcji",
    secure: "Płatność obsługuje certyfikowany operator - nie przechowujemy danych karty.",
    subscription: "Subskrypcja",
    oneTime: "Zakup jednorazowy",
    signIn: "Zaloguj się, aby zobaczyć szczegóły dostępu.",
  },
  en: {
    heading: "Thank you for your purchase",
    body: "Your access is already active. We have also sent a confirmation by e-mail.",
    accessTitle: "Access",
    renewsOn: "Renews on",
    endsOn: "Access until",
    lifetime: "Lifetime access",
    daysLeft: (n: number) => (n === 1 ? "1 day left" : `${n} days left`),
    expired: "The access period has ended",
    pendingTitle: "Confirming your payment",
    pendingBody:
      "The payment provider is processing the transaction. Access will appear here automatically, usually within seconds.",
    portal: "Customer portal",
    portalHint: "Payment method, invoices and cancellation - in the payment provider portal.",
    portalError: "Could not open the customer portal. Please try again.",
    orders: "Order history",
    profile: "My account",
    continue: "Back to reading",
    reference: "Transaction ID",
    secure: "Payments are handled by a certified provider - we never store card data.",
    subscription: "Subscription",
    oneTime: "One-time purchase",
    signIn: "Sign in to see your access details.",
  },
} as const;

const DEMO: PurchaseSummary = {
  kind: "subscription",
  status: "active",
  accessEndsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  renews: true,
  expired: false,
  portalAvailable: true,
  reference: "sub_demo_0000",
  amountCents: null,
  currency: null,
};

function locStr(c: WidgetContent, base: string, lang: Lang): string {
  return getStr(c, `${base}_${lang}`) || getStr(c, `${base}_pl`) || getStr(c, `${base}_en`);
}

export function PurchaseConfirmationView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const copy = COPY[lang];
  const inBuilder = useBuilderMode() !== null;
  const { session } = useAuth();
  const uid = session?.user?.id;
  const environment = getStripeEnvironmentSafe();
  const [portalPending, setPortalPending] = useState(false);

  const showAccessEnd = getBool(c, "showAccessEnd", true);
  const showPortalLink = getBool(c, "showPortalLink", true);
  const showOrdersLink = getBool(c, "showOrdersLink", true);
  const showReference = getBool(c, "showReference", true);
  const showSecureNote = getBool(c, "showSecureNote", true);
  const accent = getStr(c, "accentColor");
  const extraHref = safeUrl(getStr(c, "href"));
  const extraLabel = locStr(c, "ctaLabel", lang);

  const subQ = useQuery({
    queryKey: billingKeys.myStripeSubscription(uid, environment),
    queryFn: fetchMyStripeSubscription,
    enabled: !inBuilder && !!session,
  });
  const ordersQ = useQuery({
    queryKey: billingKeys.myOrders(uid),
    queryFn: fetchMyOrders,
    enabled: !inBuilder && !!session,
  });

  const summary = useMemo<PurchaseSummary>(() => {
    if (inBuilder) return DEMO;
    return buildPurchaseSummary({
      subscription: subQ.data ?? null,
      order: (ordersQ.data ?? [])[0] ?? null,
    });
  }, [inBuilder, subQ.data, ordersQ.data]);

  const openPortal = async () => {
    setPortalPending(true);
    try {
      const result = await createStripePortalSession({
        data: {
          environment,
          returnPath:
            typeof window !== "undefined"
              ? `${window.location.pathname}${window.location.search}`
              : undefined,
        },
      });
      if ("error" in result && result.error) {
        toast.error(copy.portalError);
        return;
      }
      // Operator zwraca albo `overviewUrl` (deep link), albo samo `url`.
      const url =
        ("overviewUrl" in result ? result.overviewUrl : null) ??
        ("url" in result ? result.url : null);

      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error(copy.portalError);
    } finally {
      setPortalPending(false);
    }
  };

  const heading = locStr(c, "heading", lang) || copy.heading;
  const body = locStr(c, "body", lang) || copy.body;
  const accentStyle: CSSProperties = accent ? { color: accent } : {};
  const endsLabel = formatAccessDate(summary.accessEndsAt, lang);
  const left = daysLeft(summary.accessEndsAt);
  const loading = !inBuilder && !!session && (subQ.isLoading || ordersQ.isLoading);
  const pending = !loading && summary.kind === "none" && !!session;

  return (
    <section
      className="rounded-[6px] border border-border/60 bg-card/80 p-6 shadow-sm sm:p-8"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"
          style={accentStyle}
        >
          <CheckCircle2 className="h-8 w-8" aria-hidden />
        </span>
        <h2 className="font-display text-2xl font-bold text-foreground">{heading}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{body}</p>
        {!inBuilder && !session ? (
          <p className="text-sm text-muted-foreground">{copy.signIn}</p>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        </div>
      ) : null}

      {pending ? (
        <div className="mt-6 rounded-[6px] border border-border/60 bg-muted/30 p-4 text-center">
          <p className="text-sm font-medium text-foreground">{copy.pendingTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">{copy.pendingBody}</p>
        </div>
      ) : null}

      {showAccessEnd && summary.kind !== "none" && !loading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[6px] border border-border/60 bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
              {copy.accessTitle}
            </div>
            <p className="mt-2 text-base font-semibold text-foreground">
              {summary.expired
                ? copy.expired
                : endsLabel
                  ? `${summary.renews ? copy.renewsOn : copy.endsOn} ${endsLabel}`
                  : copy.lifetime}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-[6px]">
                {summary.kind === "subscription" ? copy.subscription : copy.oneTime}
              </Badge>
              {summary.renews ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <RefreshCw className="h-3 w-3" aria-hidden />
                  {left !== null ? copy.daysLeft(left) : null}
                </span>
              ) : left !== null && !summary.expired ? (
                <span className="text-xs text-muted-foreground">{copy.daysLeft(left)}</span>
              ) : null}
            </div>
          </div>

          <div className="rounded-[6px] border border-border/60 bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <FileText className="h-3.5 w-3.5" aria-hidden />
              {copy.reference}
            </div>
            <p className="mt-2 break-all font-mono text-sm text-foreground">
              {showReference ? (summary.reference ?? "-") : "-"}
            </p>
            {summary.amountCents !== null && summary.currency ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {formatMoney(summary.amountCents, summary.currency, lang)}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {showPortalLink && (summary.portalAvailable || inBuilder) ? (
          <Button
            type="button"
            onClick={inBuilder ? undefined : openPortal}
            disabled={portalPending}
            className="h-12 rounded-[6px]"
          >
            {portalPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <CreditCard className="mr-2 h-4 w-4" aria-hidden />
            )}
            {copy.portal}
            <ExternalLink className="ml-2 h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : null}
        {extraHref && extraLabel ? (
          <Button asChild variant="outline" className="h-12 rounded-[6px]">
            <AppLink href={extraHref}>
              {extraLabel}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </AppLink>
          </Button>
        ) : null}
        {showOrdersLink ? (
          <Button asChild variant="outline" className="h-12 rounded-[6px]">
            {/* Zamówienia i historia płatności to od 06.08 jedna strona (§11). */}
            <Link to="/profile/payments">{copy.orders}</Link>
          </Button>
        ) : null}
        <Button asChild variant="ghost" className="h-12 rounded-[6px]">
          <Link to="/profile">{copy.profile}</Link>
        </Button>
      </div>

      {showSecureNote ? (
        <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {showPortalLink ? `${copy.portalHint} ${copy.secure}` : copy.secure}
        </p>
      ) : null}
    </section>
  );
}
