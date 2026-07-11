import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BillingProfileForm } from "@/components/billing/BillingProfileForm";

export const Route = createFileRoute("/profile/billing")({
  component: BillingPage,
});

function BillingPage() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.billing.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("profile.billing.subtitle")}</p>
      </CardHeader>
      <CardContent>
        <BillingProfileForm />
      </CardContent>
    </Card>
  );
}
