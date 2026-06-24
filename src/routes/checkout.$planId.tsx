import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { AuthGate } from "@/components/profile/AuthGate";
import { fetchMyBillingProfile, fetchPlanById } from "@/lib/billing/queries";
import { formatMoney, planDescription, planName } from "@/lib/billing/types";
import { createCheckoutOrder } from "@/lib/billing/checkout.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import "@/lib/i18n-profile";

export const Route = createFileRoute("/checkout/$planId")({
  component: CheckoutPage,
  head: () => ({
    meta: [
      { title: "Checkout" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function CheckoutPage() {
  const { planId } = Route.useParams();
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const checkout = useServerFn(createCheckoutOrder);

  const plan = useQuery({
    queryKey: ["plan", planId],
    queryFn: () => fetchPlanById(planId),
  });

  const billing = useQuery({
    queryKey: ["my-billing"],
    queryFn: fetchMyBillingProfile,
    enabled: !!session,
  });

  useEffect(() => {
    if (plan.isSuccess && !plan.data) {
      toast.error(t("checkout.notFound"));
    }
  }, [plan.isSuccess, plan.data, t]);

  const hasBilling = !!billing.data?.address_line1 && !!billing.data?.city;

  const submit = async () => {
    if (!plan.data) return;
    if (!hasBilling) {
      toast.error(t("checkout.fillBilling"));
      void navigate({ to: "/profile/billing" });
      return;
    }
    setBusy(true);
    try {
      const res = await checkout({
        data: {
          kind: plan.data.interval === "once" ? "one_time" : "subscription",
          plan_id: plan.data.id,
          success_path: "/checkout/success",
          cancel_path: "/checkout/cancel",
        },
      });
      if (!res.ok) {
        toast.error(t("checkout.stripeNotConfigured"));
        setBusy(false);
        return;
      }
      if (res.mode === "stripe") {
        window.location.href = res.url;
      } else {
        // Mock mode - go to internal success page
        void navigate({ to: "/checkout/success", search: { order: res.orderId, mock: 1 } });
      }
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
      setBusy(false);
    }
  };

  return (
    <AuthGate fallbackBody={t("checkout.loginRequired")}>
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
                    {billing.data?.tax_id && <div className="text-muted-foreground">NIP: {billing.data.tax_id}</div>}
                    <div>{billing.data?.address_line1}</div>
                    {billing.data?.address_line2 && <div>{billing.data.address_line2}</div>}
                    <div>{billing.data?.postal_code} {billing.data?.city}</div>
                    <div>{billing.data?.country_code}</div>
                    <Button asChild variant="link" className="p-0 h-auto">
                      <Link to="/profile/billing">{t("profile.billing.title")}</Link>
                    </Button>
                  </div>
                ) : (
                  <Alert>
                    <AlertDescription className="flex items-center justify-between gap-4">
                      <span>{t("checkout.fillBilling")}</span>
                      <Button asChild size="sm">
                        <Link to="/profile/billing">{t("profile.billing.title")}</Link>
                      </Button>
                    </AlertDescription>
                  </Alert>
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
                      <div className="text-xs uppercase text-muted-foreground">{t("checkout.item")}</div>
                      <div className="font-semibold">{planName(plan.data, i18n.language)}</div>
                      {planDescription(plan.data, i18n.language) && (
                        <p className="text-sm text-muted-foreground">
                          {planDescription(plan.data, i18n.language)}
                        </p>
                      )}
                    </div>
                    <div className="border-t pt-4 flex items-center justify-between">
                      <span className="font-medium">{t("checkout.total")}</span>
                      <span className="text-2xl font-bold">
                        {formatMoney(plan.data.price_cents, plan.data.currency, i18n.language)}
                      </span>
                    </div>
                    <Button
                      className="w-full"
                      size="lg"
                      disabled={busy || !hasBilling}
                      onClick={submit}
                    >
                      {busy ? (
                        t("checkout.processing")
                      ) : (
                        <>
                          <Lock className="mr-2 h-4 w-4" />
                          {t("checkout.payNow", {
                            amount: formatMoney(plan.data.price_cents, plan.data.currency, i18n.language),
                          })}
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">{t("checkout.terms")}</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("checkout.notFound")}</p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </AuthGate>
  );
}
