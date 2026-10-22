// /admin/newsletter/email-content - edycja treści maili karencji i końca dostępu (PL/EN)
// oraz (I9d-Y1) prośby o potwierdzenie subskrypcji przy wygaszaniu nieaktywnych
// subskrybentów - jedno miejsce edytowalnych maili newslettera.
//
// Edytor prośby ładuje się LENIWIE (`lazy`): słownik retencji, zapytania i zod
// nie trafiają do chunku sekcji. Widzi go wyłącznie administrator (te same
// role co bramka `requireAdmin` funkcji serwerowych: admin, super_admin) -
// redaktor newslettera dostałby tylko odmowę. Bez najemcy sesji (render
// serwera, test sklejenia trasy) edytora nie ma.
import { lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TxEmailContentPanel } from "@/components/admin/newsletter/system-emails/TxEmailContentPanel";
import { useAuth } from "@/hooks/useAuth";

const NewsletterSunsetCopyEditor = lazy(
  () => import("@/components/admin/settings/dataRetention/NewsletterSunsetCopyEditor"),
);

export const Route = createFileRoute("/admin/newsletter/email-content")({
  component: EmailContentPage,
});

function EmailContentPage() {
  const { tenantId, isAdmin } = useAuth();
  return (
    <div className="space-y-8">
      <TxEmailContentPanel />
      {tenantId && isAdmin ? (
        <Suspense fallback={null}>
          <NewsletterSunsetCopyEditor tenantId={tenantId} />
        </Suspense>
      ) : null}
    </div>
  );
}
