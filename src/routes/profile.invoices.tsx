// Panel faktur członka: rejestr dokumentów z pobieraniem PDF + most do CRM.
//
// Dokumenty przeniosły się tu z /profile/payments celowo: tamta strona
// odpowiada na pytanie „ile i kiedy zapłaciłem", ta na „gdzie jest moja
// faktura". Rozdzielenie zamyka temat zgadywania, która zakładka ma plik.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { InvoiceLedgerCard } from "@/components/billing/organisms/InvoiceLedgerCard";
import { InvoiceCrmSyncCard } from "@/components/billing/organisms/InvoiceCrmSyncCard";
import { InvoiceLookupCard } from "@/components/billing/molecules/InvoiceLookupCard";
import { ensureI18n } from "@/lib/i18n-invoices";

export const Route = createFileRoute("/profile/invoices")({
  component: InvoicesPage,
  head: () => ({
    meta: [
      { title: "Faktury i rozliczenia - New European Strategies" },
      {
        name: "description",
        content:
          "Pobierz faktury PDF za członkostwo i zakupy oraz zsynchronizuj dane nabywcy z kartoteką firmy.",
      },
      { property: "og:title", content: "Faktury i rozliczenia - New European Strategies" },
      {
        property: "og:description",
        content: "Dokumenty rozliczeniowe, pobieranie PDF i dane nabywcy zsynchronizowane z CRM.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function InvoicesPage() {
  ensureI18n();
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-bold">{t("invoices.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("invoices.pageHint")}</p>
      </header>
      <InvoiceLedgerCard />
      <InvoiceCrmSyncCard />
      {/* Odzyskanie faktury po numerze transakcji (np. płatność bez konta). */}
      <InvoiceLookupCard />
    </div>
  );
}
