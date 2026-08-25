// /admin/events/registrations - bilety i formularz zapisu wydarzenia.
//
// JEDNA TRASA NA PODMODUŁ, WYDARZENIE WYBIERANE W ŚRODKU - tak jak giełda
// spotkań. Bilety i pola formularza to dwa widoki tego samego kontekstu.
//
// BRAMKA ROLI JEST W BAZIE, TU STOI TYLKO ZDANIE. Każde RPC panelu zapisów ma
// asercję roli w tenancie, więc redaktor bez uprawnień dostanie odmowę
// niezależnie od tego, co pokaże ekran; komunikat istnieje po to, żeby odmowa nie
// wyglądała jak awaria.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { RegistrationsManager } from "@/components/admin/events/organisms/RegistrationsManager";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureI18n as ensureRegistrationI18n } from "@/lib/i18n-admin-event-registration";

export const Route = createFileRoute("/admin/events/registrations")({
  head: () => ({
    meta: [
      { title: "Registrations and tickets · Events · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Configure event tickets, seat quotas and the registration form fields.",
      },
    ],
  }),
  component: AdminEventRegistrationsPage,
});

function AdminEventRegistrationsPage() {
  ensureAdminEventsI18n();
  ensureRegistrationI18n();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t("adminEventRegistration.errors.forbidden")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <RegistrationsManager />
    </div>
  );
}
