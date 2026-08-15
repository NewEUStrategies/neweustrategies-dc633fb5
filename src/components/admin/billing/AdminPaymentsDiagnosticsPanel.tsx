// Ekran diagnostyczny płatności: stan bramki, odbiornik zdarzeń, katalog cen,
// kondycja dziennika, odwzorowanie kuponów B2B na rabaty u operatora oraz
// kontrolowany test checkoutu/subskrypcji na własnym koncie.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-billing";
import { toast } from "sonner";
import {
  CheckCircle2,
  CircleAlert,
  CircleX,
  PlayCircle,
  RefreshCcw,
  Stethoscope,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { getStripeEnvironmentSafe } from "@/lib/stripe";
import { useCheckout } from "@/hooks/useCheckout";
import { LazyEmbeddedCheckoutDialog } from "@/components/checkout/LazyEmbeddedCheckoutDialog";
import { supabase } from "@/integrations/supabase/client";
import { BILLING_CATALOG } from "@/lib/billing/catalog";
import { getPaymentsDiagnostics, syncCouponsToProvider } from "@/lib/billing/diagnostics.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { uiLocale } from "@/lib/i18n/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Identyfikatory kontroli przychodzą z serwera (`diagnostics.functions`), więc
// mapowanie id -> klucz słownika zostaje jawne. Nieznane id renderujemy surowo:
// nowa kontrola po stronie serwera ma pokazać swoją nazwę techniczną, a nie
// zniknąć z listy dlatego, że nikt nie dopisał tłumaczenia.
const CHECK_LABEL_KEYS: Record<string, string> = {
  gateway_configured: "adminBilling.checks.gateway",
  webhook_endpoint: "adminBilling.checks.endpoint",
  catalog: "adminBilling.checks.catalog",
  webhook_failures: "adminBilling.checks.failures",
  webhook_traffic: "adminBilling.checks.traffic",
};

function StateIcon({ state }: { state: "ok" | "warn" | "error" }) {
  if (state === "ok")
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />;
  if (state === "warn")
    return <CircleAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />;
  return <CircleX className="h-4 w-4 text-destructive" aria-hidden="true" />;
}

export function AdminPaymentsDiagnosticsPanel() {
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const { user } = useAuth();

  const clientEnv = getStripeEnvironmentSafe();
  const [env, setEnv] = useState<"sandbox" | "live">(clientEnv);
  // Test uruchamiamy na realnym planie z bazy - Stripe potrzebuje `planId`,
  // a cenę katalogową dobieramy po parze (tier_key, interval).
  const [testPlanId, setTestPlanId] = useState("");
  const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null);
  const plansQ = useQuery({
    queryKey: ["admin", "billing", "test-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("access_plans")
        .select("id, name_pl, name_en, tier_key, interval")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const load = useServerFn(getPaymentsDiagnostics);
  const diagQ = useQuery({
    queryKey: ["admin", "billing", "diagnostics", env],
    queryFn: () => load({ data: { environment: env } }),
    staleTime: 30_000,
  });

  const syncFn = useServerFn(syncCouponsToProvider);
  const syncM = useMutation({
    mutationFn: () => syncFn({ data: { environment: env } }),
    onSuccess: (r) => {
      toast.success(
        t("adminBilling.couponsSynced", {
          created: r.created,
          existing: r.existing,
          failed: r.failed,
        }),
      );
      void diagQ.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { openPlanCheckout, loading: checkoutLoading } = useCheckout();
  const runTestCheckout = async () => {
    if (!user?.id) {
      toast.error(t("adminBilling.signRunTest"));
      return;
    }
    if (env !== clientEnv) {
      toast.error(t("adminBilling.checkoutOverlayRunsBuildS"));
      return;
    }
    try {
      const plan = (plansQ.data ?? []).find((row) => row.id === testPlanId);
      if (!plan) {
        toast.error(t("adminBilling.pickPlanTest"));
        return;
      }
      const entry = BILLING_CATALOG.find(
        (e) => e.tierKey === plan.tier_key && e.interval === plan.interval,
      );
      if (!entry) {
        toast.error(t("adminBilling.matchingStripePriceCatalog"));
        return;
      }
      const res = await openPlanCheckout({
        planId: plan.id,
        priceId: entry.priceId,
        returnUrl: `${window.location.origin}/checkout/success`,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setCheckoutSecret(res.session.clientSecret);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const diag = diagQ.data;
  const missingPrices = useMemo(
    () => (diag?.catalog ?? []).filter((c) => !c.providerPriceId),
    [diag?.catalog],
  );

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(uiLocale(lang)) : "-";

  return (
    <div className="space-y-4">
      <LazyEmbeddedCheckoutDialog
        clientSecret={checkoutSecret}
        onOpenChange={(open) => {
          if (!open) setCheckoutSecret(null);
        }}
      />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
            <Stethoscope className="h-4 w-4" aria-hidden="true" />
            {t("adminBilling.paymentsDiagnostics")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={env} onValueChange={(v) => setEnv(v === "live" ? "live" : "sandbox")}>
              <SelectTrigger className="h-9 w-44 rounded-[6px] text-[0.8125rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">{t("adminBilling.testEnvironment")}</SelectItem>
                <SelectItem value="live">{t("adminBilling.liveEnvironment")}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-[6px]"
              onClick={() => void diagQ.refetch()}
              disabled={diagQ.isFetching}
            >
              <RefreshCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t("adminBilling.reRunChecks")}
            </Button>
          </div>

          {diagQ.isLoading && (
            <p className="text-[0.8125rem] text-muted-foreground">
              {t("adminBilling.runningChecks")}
            </p>
          )}
          {diagQ.isError && (
            <p className="text-[0.8125rem] text-destructive">
              {t("adminBilling.couldLoadDiagnostics")}
            </p>
          )}

          {diag && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {diag.checks.map((c) => (
                <li
                  key={c.id}
                  className="flex items-start gap-2 rounded-[6px] border border-border/60 px-3 py-2 text-[0.8125rem]"
                >
                  <StateIcon state={c.state} />
                  <span>
                    <span className="font-medium">
                      {CHECK_LABEL_KEYS[c.id] ? t(CHECK_LABEL_KEYS[c.id]) : c.id}
                    </span>
                    <span className="block break-all text-xs text-muted-foreground">
                      {c.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {diag && (
            <p className="text-[0.8125rem] text-muted-foreground">
              {t("adminBilling.webhookSummary", {
                total: diag.webhooks.total,
                failed: diag.webhooks.failed,
                last: fmtDate(diag.webhooks.lastEventAt),
                avgMs: diag.webhooks.avgDurationMs ?? "-",
              })}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[0.8125rem] font-medium text-muted-foreground">
            {t("adminBilling.checkoutSubscriptionTest")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[0.8125rem] text-muted-foreground">
            {t("adminBilling.opensRealStripeCheckoutForm")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={testPlanId} onValueChange={setTestPlanId}>
              <SelectTrigger className="h-9 w-60 rounded-[6px] text-[0.8125rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(plansQ.data ?? []).map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    {lang === "pl" ? plan.name_pl : plan.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              className="h-9 rounded-[6px]"
              onClick={() => void runTestCheckout()}
              disabled={checkoutLoading || !testPlanId}
            >
              <PlayCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t("adminBilling.runTest")}
            </Button>
            {missingPrices.length > 0 && (
              <span className="text-[0.8125rem] text-destructive">
                {t("adminBilling.missingProviderPrices", { count: missingPrices.length })}
              </span>
            )}
          </div>

          {diag && diag.catalog.length > 0 && (
            <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {diag.catalog.map((c) => (
                <li key={c.priceId} className="flex items-center gap-2">
                  <StateIcon state={c.providerPriceId ? "ok" : "error"} />
                  <span className="font-mono">{c.priceId}</span>
                  <span className="truncate">{c.providerPriceId ?? t("adminBilling.missing")}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[0.8125rem] font-medium text-muted-foreground">
            {t("adminBilling.b2bCouponsVsProviderDiscounts")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[0.8125rem] text-muted-foreground">
            {t("adminBilling.couponsLiveDatabaseProviderDiscount")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-[6px]"
            onClick={() => syncM.mutate()}
            disabled={syncM.isPending}
          >
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t("adminBilling.syncCoupons")}
          </Button>

          {diag && diag.coupons.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border/60">
              <table className="w-full text-left text-[0.8125rem]">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("adminBilling.code")}</th>
                    <th className="px-3 py-2 font-medium">{t("adminBilling.discount")}</th>
                    <th className="px-3 py-2 font-medium">{t("adminBilling.validUntil")}</th>
                    <th className="px-3 py-2 font-medium">{t("adminBilling.redemptions")}</th>
                    <th className="px-3 py-2 font-medium">{t("adminBilling.grantsAccess")}</th>
                    <th className="px-3 py-2 font-medium">{t("adminBilling.provider")}</th>
                  </tr>
                </thead>
                <tbody>
                  {diag.coupons.map((c) => (
                    <tr key={c.code} className="border-t border-border/60">
                      <td className="px-3 py-2 font-mono">{c.code}</td>
                      <td className="px-3 py-2">
                        {c.discountKind === "percent"
                          ? `${c.discountPercent ?? 0}%`
                          : `${((c.discountCents ?? 0) / 100).toFixed(2)} ${(c.currency ?? "PLN").toUpperCase()}`}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(c.validUntil)}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {c.timesRedeemed}
                        {c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {c.grantsTierKey
                          ? `${c.grantsTierKey}${c.grantsDurationDays ? ` · ${c.grantsDurationDays} ${t("adminBilling.days")}` : ""}`
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {c.providerDiscountId ? (
                          <Badge
                            variant="outline"
                            className="border-0 bg-emerald-500/12 text-[0.75rem] text-emerald-700 dark:text-emerald-300"
                          >
                            {t("adminBilling.synced")}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-0 bg-muted text-[0.75rem] text-muted-foreground"
                          >
                            {c.active ? t("adminBilling.firstUse") : t("adminBilling.inactive")}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
