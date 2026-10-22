// /admin/newsletter/email-content - edycja treści maili karencji i końca dostępu (PL/EN)
// oraz (I9d-Y1) prośby o potwierdzenie subskrypcji przy wygaszaniu nieaktywnych
// subskrybentów - jedno miejsce edytowalnych maili newslettera. Edytor prośby
// wchodzi leniwie przez `NewsletterSunsetCopySection` (widok tylko dla ról,
// które jego funkcje serwerowe dopuszczają; dostępu do trasy pilnuje layout).
// I9d-Y2: treść jednorazowej prośby o zgodę na pomiar otwarć i kliknięć -
// ten sam edytor, wejście `NewsletterMeasurementCopySection`.
import { createFileRoute } from "@tanstack/react-router";
import { adminPageHead } from "@/lib/adminPageHead";
import { TxEmailContentPanel } from "@/components/admin/newsletter/system-emails/TxEmailContentPanel";
import { NewsletterSunsetCopySection } from "@/components/admin/settings/dataRetention/NewsletterSunsetCopySection";
import { NewsletterMeasurementCopySection } from "@/components/admin/newsletter/measurement/NewsletterMeasurementCopySection";

export const Route = createFileRoute("/admin/newsletter/email-content")({
  // Sekcyjny tytuł zamiast ogólnego tytułu panelu (I9d-Y2: strona ma już trzy
  // edytory maili, w tym prośbę o zgodę na pomiar).
  head: () =>
    adminPageHead(
      "Newsletter - treści maili - Ustawienia",
      "Treści maili karencji i końca dostępu, prośby o potwierdzenie subskrypcji i prośby o zgodę na pomiar otwarć i kliknięć (PL/EN).",
    ),
  component: EmailContentPage,
});

function EmailContentPage() {
  return (
    <div className="space-y-8">
      <TxEmailContentPanel />
      <NewsletterSunsetCopySection />
      <NewsletterMeasurementCopySection />
    </div>
  );
}
