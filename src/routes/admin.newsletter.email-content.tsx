// /admin/newsletter/email-content - edycja treści maili karencji i końca dostępu (PL/EN)
// oraz (I9d-Y1) prośby o potwierdzenie subskrypcji przy wygaszaniu nieaktywnych
// subskrybentów - jedno miejsce edytowalnych maili newslettera. Edytor prośby
// wchodzi leniwie przez `NewsletterSunsetCopySection` (widok tylko dla ról,
// które jego funkcje serwerowe dopuszczają; dostępu do trasy pilnuje layout).
import { createFileRoute } from "@tanstack/react-router";
import { TxEmailContentPanel } from "@/components/admin/newsletter/system-emails/TxEmailContentPanel";
import { NewsletterSunsetCopySection } from "@/components/admin/settings/dataRetention/NewsletterSunsetCopySection";

export const Route = createFileRoute("/admin/newsletter/email-content")({
  component: EmailContentPage,
});

function EmailContentPage() {
  return (
    <div className="space-y-8">
      <TxEmailContentPanel />
      <NewsletterSunsetCopySection />
    </div>
  );
}
