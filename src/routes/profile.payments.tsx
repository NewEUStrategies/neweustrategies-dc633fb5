// Pełna historia płatności i faktur użytkownika - jedna lista scalona z
// zamówień i dokumentów operatora, z eksportem do CSV i PDF. Skrót tej samej
// listy pokazuje /profile/plan.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PaymentHistoryCard } from "@/components/billing/PaymentHistoryCard";
import { InvoiceLookupCard } from "@/components/billing/InvoiceLookupCard";
import { HowPaymentsWorkCard } from "@/components/billing/HowPaymentsWorkCard";


export const Route = createFileRoute("/profile/payments")({
  component: PaymentsHistoryPage,
});

function PaymentsHistoryPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-bold">{t("profile.planPage.history.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("profile.planPage.history.pageHint")}</p>
      </header>
      <PaymentHistoryCard showExport />
      <InvoiceLookupCard />
    </div>
  );
}
