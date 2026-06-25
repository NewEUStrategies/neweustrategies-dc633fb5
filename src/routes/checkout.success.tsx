import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { finalizeCheckout } from "@/lib/billing/checkout.functions";
import "@/lib/i18n-profile";

export const Route = createFileRoute("/checkout/success")({
  validateSearch: (search: Record<string, unknown>) => ({
    order: typeof search.order === "string" ? search.order : undefined,
    mock: search.mock === 1 || search.mock === "1" ? 1 : undefined,
  }),
  component: SuccessPage,
  head: () => ({
    meta: [
      { title: "Dziękujemy za zakup" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function SuccessPage() {
  const { t } = useTranslation();
  const { order, mock } = Route.useSearch();
  const finalize = useServerFn(finalizeCheckout);
  const queryClient = useQueryClient();

  // In mock mode (no Stripe) there is no webhook, so finalise the order here and
  // then drop cached access/content so the just-purchased content unlocks.
  useEffect(() => {
    if (!mock || !order) return;
    let cancelled = false;
    void (async () => {
      try {
        await finalize({ data: { order_id: order } });
      } catch {
        /* surfaced on the orders page; success UI stays optimistic */
      }
      if (cancelled) return;
      void queryClient.invalidateQueries({ queryKey: ["public", "resolved"] });
      void queryClient.invalidateQueries({ queryKey: ["unlocked-body"] });
      void queryClient.invalidateQueries({ queryKey: ["my-subscription"] });
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
          <div className="flex justify-center gap-2 pt-4">
            <Button asChild>
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
