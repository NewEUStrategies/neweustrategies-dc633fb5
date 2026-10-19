// /admin/billing - rozliczenia subskrypcji i audyt zdarzeń operatora płatności.
//
// ADRES (SPEC §2.6): `?tab=subscriptions|orders|tickets|events|diagnostics&status=`.
// Trasa waliduje adres liściem bez importów (`billingTabs.ts` - powłoka trasy
// jedzie w chunku wejściowym), więc link z huba „Przychód i lejek" nie kończy
// się stroną błędu. Zakładki renderuje `AdminBillingPanel` (wycinek S2), który
// dziś trzyma je w stanie; podpięcie `tab`/`onTabChange`/`statusFilter` to
// kontrakt z S2 (PLAN S1 §3.3) - do tego czasu link ląduje na zakładce domyślnej.
//
// NAGŁÓWEK SEKCYJNY (`adminPageHead`, AGENTS.md) zamiast ręcznie składanego
// `meta` - ten sam format tytułu i te same znaczniki `noindex` co w całym panelu.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CreditCard } from "lucide-react";

import { AdminBillingPanel } from "@/components/admin/billing/AdminBillingPanel";
import { adminPageHead } from "@/lib/adminPageHead";
import { parseBillingSearch } from "@/lib/admin/billingTabs";

export const Route = createFileRoute("/admin/billing")({
  validateSearch: parseBillingSearch,
  component: AdminBillingPage,
  head: () =>
    adminPageHead(
      "Rozliczenia subskrypcji",
      "Podgląd aktywnych subskrypcji, zamówień, nieudanych płatności i historii zdarzeń operatora płatności.",
    ),
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
