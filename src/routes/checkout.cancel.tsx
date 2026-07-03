import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";
import "@/lib/i18n-profile";

export const Route = createFileRoute("/checkout/cancel")({
  validateSearch: (search: Record<string, unknown>) => ({
    order: typeof search.order === "string" ? search.order : undefined,
  }),
  component: CancelPage,
  head: () => ({
    meta: [{ title: "Płatność anulowana" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function CancelPage() {
  const { t } = useTranslation();
  return (
    <div className="container mx-auto max-w-lg py-16">
      <Card>
        <CardContent className="pt-10 pb-8 text-center space-y-4">
          <XCircle className="h-16 w-16 mx-auto text-muted-foreground" />
          <h1 className="text-2xl font-bold">{t("checkout.cancelTitle")}</h1>
          <p className="text-muted-foreground">{t("checkout.cancelBody")}</p>
          <div className="flex justify-center gap-2 pt-4">
            <Button asChild>
              <Link to="/pricing">{t("checkout.backToPricing")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
