// „Płatności i faktury" - JEDNO miejsce na całą historię pieniędzy użytkownika
// (§11 audytu IA finansów).
//
// Do 06.08 ta sama treść była rozdana na dwie pozycje nawigacji:
//   * /profile/orders   - tabela zamówień + rejestr dokumentów + wyszukiwarka faktur,
//   * /profile/payments - scalona historia płatności + TA SAMA wyszukiwarka faktur.
// Użytkownik szukający faktury musiał zgadnąć, która z dwóch pozycji ją ma
// (odpowiedź brzmiała „obie, inaczej"). Trasa zamówień jest teraz
// przekierowaniem, a jej karty mieszkają tutaj - nic nie zniknęło.
//
// Kolejność jest celowa: od tego, czego szuka się najczęściej (ile i kiedy
// zapłaciłem), przez dowody (zamówienia, dokumenty), po odzyskanie faktury i
// wyjaśnienie zasad.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PaymentHistoryCard } from "@/components/billing/organisms/PaymentHistoryCard";
import { OrdersTableCard } from "@/components/billing/organisms/OrdersTableCard";
import { BillingDocumentsCard } from "@/components/billing/organisms/BillingDocumentsCard";
import { InvoiceLookupCard } from "@/components/billing/molecules/InvoiceLookupCard";
import { HowPaymentsWorkCard } from "@/components/billing/molecules/HowPaymentsWorkCard";

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
      {/* Rejestr zamówień (przeniesiony z /profile/orders). */}
      <OrdersTableCard />
      {/* Dokumenty rozliczeniowe z odnowień - zasilane webhookiem operatora. */}
      <BillingDocumentsCard />
      {/* Odzyskanie faktury po numerze transakcji + mail z linkiem do portalu. */}
      <InvoiceLookupCard />
      <HowPaymentsWorkCard />
    </div>
  );
}
