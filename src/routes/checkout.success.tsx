import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { AppLink } from "@/components/atoms/AppLink";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { billingKeys } from "@/lib/billing/keys";
import { finalizeCheckout } from "@/lib/billing/checkout.functions";
import { ensureI18n as ensureProfileI18n } from "@/lib/i18n-profile";
export const Route = createFileRoute("/checkout/success")({
  validateSearch: (search: Record<string, unknown>) => ({
    order: typeof search.order === "string" ? search.order : undefined,
    mock: search.mock === 1 || search.mock === "1" ? 1 : undefined,
  }),
  component: SuccessPage,
  head: () => ({
    meta: [
      { title: "Payment success · Dziękujemy za zakup" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const RETURN_KEY = "checkout:returnTo";

function SuccessPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureProfileI18n();
  const { t } = useTranslation();
  const { order, mock } = Route.useSearch();
  const finalize = useServerFn(finalizeCheckout);
  const queryClient = useQueryClient();
  // Where the buyer was before checkout (e.g. the paywalled article they were
  // reading), captured by the Paywall so we can send them back to it instead of
  // dead-ending on the profile.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    try {
      const v = sessionStorage.getItem(RETURN_KEY);
      if (v && v.startsWith("/") && !v.startsWith("/checkout") && !v.startsWith("/profile")) {
        setReturnTo(v);
      }
      sessionStorage.removeItem(RETURN_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // In mock mode (no Stripe) there is no webhook, so finalise the order here.
  // In BOTH modes drop every entitlement-bearing cache: tier badge/gating
  // (current-tier), subscription + orders on the profile, and resolved
  // content bodies - the buyer must see the purchase everywhere without a
  // reload. The Stripe webhook additionally emits subscription.* domain
  // events (actor = buyer), so a slow webhook still live-unlocks this tab
  // the moment it lands; this eager pass covers the fast path.
  useEffect(() => {
    let cancelled = false;
    const invalidateEntitlements = () => {
      void queryClient.invalidateQueries({ queryKey: ["public", "resolved"] });
      void queryClient.invalidateQueries({ queryKey: ["unlocked-body"] });
      void queryClient.invalidateQueries({ queryKey: billingKeys.mySubscriptionAll() });
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
    <div className="container mx-auto max-w-lg py-16">
      <Card>
        <CardContent className="pt-10 pb-8 text-center space-y-4">
          <CheckCircle2 className="h-16 w-16 mx-auto text-primary" />
          <h1 className="text-2xl font-bold">{t("checkout.successTitle")}</h1>
          <p className="text-muted-foreground">{t("checkout.successBody")}</p>
          <div className="flex flex-wrap justify-center gap-2 pt-4">
            {returnTo && (
              <Button asChild>
                <AppLink href={returnTo}>{t("checkout.continueReading")}</AppLink>
              </Button>
            )}
            <Button asChild variant={returnTo ? "outline" : "default"}>
              <Link to="/profile">{t("checkout.backToProfile")}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/profile/orders">{t("profile.orders.title")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
