import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { fetchMyBillingProfile, fetchPlanById } from "@/lib/billing/queries";
import { formatMoney, planDescription, planName } from "@/lib/billing/types";
import {
  convertToDisplayCurrency,
  displayCurrencyForLang,
  formatDisplayMoney,
} from "@/lib/billing/displayCurrency";

import { useCheckoutSettings } from "@/hooks/useCheckoutSettings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GuestCheckoutGate } from "@/components/checkout/GuestCheckoutGate";
import { CheckoutAssurances } from "@/components/checkout/CheckoutAssurances";
import { BillingProfileForm } from "@/components/billing/BillingProfileForm";
import { CouponInput } from "@/components/checkout/CouponInput";
import { FxRateNotice } from "@/components/checkout/FxRateNotice";
import { Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { ensureI18n as ensureProfileI18n } from "@/lib/i18n-profile";
import { catalogPriceForPlan } from "@/lib/billing/catalog";
import { useCheckout } from "@/hooks/useCheckout";
// Ramka operatora wchodzi przez granicę `React.lazy` (patrz nagłówek
// EmbeddedCheckoutFrame) - trasa checkoutu nie może być drugim statycznym
// importerem `@stripe/react-stripe-js`, bo wspólny przodek dwóch takich
// importerów to chunk entry, który pobiera każdy czytelnik.
import { EmbeddedCheckoutFrame } from "@/components/checkout/EmbeddedCheckoutFrame";
import { checkoutIntentHandlers } from "@/components/checkout/checkoutIntent";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
export const Route = createFileRoute("/checkout/$planId")({
  component: CheckoutPage,
  head: () => ({
    meta: [
      { title: "Checkout · Finalizacja zamówienia" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function CheckoutPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureProfileI18n();
  const { planId } = Route.useParams();
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [coupon, setCoupon] = useState<{ code: string; discountCents: number } | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  // Po utworzeniu sesji przewijamy do ramki - inaczej na mobile formularz
  // płatności ląduje poza ekranem i wygląda, jakby przycisk nic nie zrobił.
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (clientSecret) frameRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [clientSecret]);
  const { openPlanCheckout } = useCheckout();

  const plan = useQuery({
    queryKey: ["plan", planId],
    queryFn: () => fetchPlanById(planId),
  });

  const billing = useQuery({
    queryKey: ["my-billing"],
    queryFn: fetchMyBillingProfile,
    enabled: !!session,
  });

  const { data: checkoutSettings } = useCheckoutSettings();

  useEffect(() => {
    if (plan.isSuccess && !plan.data) {
      toast.error(t("checkout.notFound"));
    }
  }, [plan.isSuccess, plan.data, t]);

  const hasBilling = !!billing.data?.address_line1 && !!billing.data?.city;
  // Tryb sesji u operatora wynika z cyklu planu - plan jednorazowy jedzie jako
  // `payment`, każdy cykliczny jako `subscription` (patrz `catalog.ts`).
  const checkoutMode: "payment" | "subscription" =
    plan.data?.interval === "one_time" ? "payment" : "subscription";
  const displayCurrency = displayCurrencyForLang(i18n.language);
  const planCurrency = plan.data?.currency ?? "PLN";
  // Kwoty do wyświetlenia po konwersji (parytet z /pricing i /support).
  const originalDisplay = convertToDisplayCurrency(
    plan.data?.price_cents ?? 0,
    planCurrency,
    displayCurrency,
  );
  const discountDisplay = convertToDisplayCurrency(
    coupon?.discountCents ?? 0,
    planCurrency,
    displayCurrency,
  );
  const finalCentsDisplay = Math.max(originalDisplay.cents - discountDisplay.cents, 0);

  const submit = async () => {
    if (!plan.data || !hasBilling) return;
    setBusy(true);
    try {
      const price = catalogPriceForPlan(plan.data);
      if (!price) {
        toast.error(t("checkout.paymentsNotConfigured"));
        setBusy(false);
        return;
      }
      const result = await openPlanCheckout({
        planId: plan.data.id,
        priceId: price.priceId,
        couponCode: coupon?.code,
        returnUrl: `${window.location.origin}/checkout/success`,
      });
      if (!result.ok) {
        if (result.error === "not_found" || result.error === "limit_reached") {
          toast.error(t("checkout.applyFailed"));
        } else {
          toast.error(t("checkout.paymentsNotConfigured"));
        }
        setBusy(false);
        return;
      }
      setClientSecret(result.session.clientSecret);
      setBusy(false);
    } catch {
      // Never surface a raw backend error string to the visitor.
      toast.error(t("checkout.paymentsNotConfigured"));
      setBusy(false);
    }
  };

  return (
    <GuestCheckoutGate>
      <div className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold mb-8">{t("checkout.title")}</h1>
        <div className="grid gap-8 md:grid-cols-[1fr_360px]">
          <section className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t("checkout.billingDetails")}</CardTitle>
              </CardHeader>
              <CardContent>
                {hasBilling ? (
                  <div className="space-y-1 text-sm">
                    <div className="font-medium">
                      {billing.data?.is_company ? billing.data?.company : billing.data?.full_name}
                    </div>
                    {billing.data?.tax_id && (
                      <div className="text-muted-foreground">NIP: {billing.data.tax_id}</div>
                    )}
                    <div>{billing.data?.address_line1}</div>
                    {billing.data?.address_line2 && <div>{billing.data.address_line2}</div>}
                    <div>
                      {billing.data?.postal_code} {billing.data?.city}
                    </div>
                    <div>{billing.data?.country_code}</div>
                    <Button asChild variant="link" className="p-0 h-auto">
                      <Link to="/profile/billing">{t("profile.billing.title")}</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">{t("checkout.fillBilling")}</p>
                    {/* Capture billing inline - no ejecting out of the funnel. On
                        save the my-billing query invalidates, hasBilling flips and
                        the pay button enables in place. */}
                    <BillingProfileForm submitLabel={t("checkout.saveBillingContinue")} />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("checkout.paymentMethod")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <span>{t("checkout.secured")}</span>
                </div>
              </CardContent>
            </Card>
          </section>

          <aside>
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle>{t("checkout.summary")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {plan.data ? (
                  <>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">
                        {t("checkout.item")}
                      </div>
                      <div className="font-semibold">{planName(plan.data, i18n.language)}</div>
                      {planDescription(plan.data, i18n.language) && (
                        <p className="text-sm text-muted-foreground">
                          {planDescription(plan.data, i18n.language)}
                        </p>
                      )}
                    </div>
                    {plan.data.trial_days > 0 && plan.data.interval !== "one_time" && (
                      <p className="rounded-md bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
                        {t("checkout.trialLine", { days: plan.data.trial_days })}
                      </p>
                    )}
                    <CouponInput
                      planId={plan.data.id}
                      amountCents={plan.data.price_cents}
                      currency={plan.data.currency}
                      onChange={(payload) =>
                        setCoupon(
                          payload
                            ? {
                                code: payload.code,
                                discountCents: payload.result.discount_cents,
                              }
                            : null,
                        )
                      }
                    />
                    <FxRateNotice displayCurrency={displayCurrency} />
                    <div className="border-t pt-4 space-y-1">
                      {coupon && coupon.discountCents > 0 && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{t("checkout.subtotal")}</span>
                          <span className="line-through">
                            {formatDisplayMoney(plan.data.price_cents, planCurrency, i18n.language)}
                          </span>
                        </div>
                      )}
                      {coupon && coupon.discountCents > 0 && (
                        <div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400">
                          <span>{t("coupon.discount")}</span>
                          <span>
                            -{formatDisplayMoney(coupon.discountCents, planCurrency, i18n.language)}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <span className="font-medium">{t("checkout.total")}</span>
                        <span className="text-2xl font-bold">
                          {formatMoney(finalCentsDisplay, originalDisplay.currency, i18n.language)}
                        </span>
                      </div>
                    </div>
                    <Button
                      className="w-full"
                      size="lg"
                      disabled={busy || !hasBilling}
                      onClick={submit}
                      {...checkoutIntentHandlers}
                    >
                      {busy ? (
                        t("checkout.processing")
                      ) : (
                        <>
                          <Lock className="mr-2 h-4 w-4" />
                          {t("checkout.payNow", {
                            amount: formatMoney(
                              finalCentsDisplay,
                              originalDisplay.currency,
                              i18n.language,
                            ),
                          })}
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                      {t("checkout.terms")}
                    </p>
                    {/* Wskazówki liczone tą samą czystą funkcją, którą serwer
                        rozwija w parametrach sesji Stripe - obietnica nie może
                        rozjechać się z tym, co zobaczy kupujący w formularzu. */}
                    <CheckoutAssurances
                      settings={checkoutSettings}
                      mode={checkoutMode}
                      hasDiscount={!!coupon && coupon.discountCents > 0}
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("checkout.notFound")}</p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>

        {/* Formularz operatora dostaje pełną szerokość kontenera - w kolumnie
            360 px ramka Stripe zwijała się do jednokolumnowego widoku i pola
            karty wychodziły poza kartę podsumowania. */}
        {clientSecret && (
          <div ref={frameRef} className="mt-10 space-y-3">
            <PaymentTestModeBanner />
            <EmbeddedCheckoutFrame clientSecret={clientSecret} />
          </div>
        )}
      </div>
    </GuestCheckoutGate>
  );
}
