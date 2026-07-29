// /admin/billing - rozliczenia subskrypcji i audyt zdarzeń operatora płatności.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CreditCard } from "lucide-react";

import { AdminBillingPanel } from "@/components/admin/billing/AdminBillingPanel";

export const Route = createFileRoute("/admin/billing")({
  component: AdminBillingPage,
  head: () => ({
    meta: [
      { title: "Rozliczenia subskrypcji | Panel NES" },
      {
        name: "description",
        content:
          "Podgląd aktywnych subskrypcji, nieudanych płatności i historii zdarzeń operatora płatności.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function AdminBillingPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
          <CreditCard className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">{L("Rozliczenia", "Billing")}</h1>
          <p className="text-[0.8125rem] text-muted-foreground">
            {L(
              "Subskrypcje, miękka windykacja i historia zdarzeń od operatora płatności.",
              "Subscriptions, dunning and payment provider event history.",
            )}
          </p>
        </div>
      </header>
      <AdminBillingPanel />
    </div>
  );
}
