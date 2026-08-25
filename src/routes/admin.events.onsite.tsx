// /admin/events/onsite - odprawa na miejscu: stanowisko, dziennik, statystyki,
// punkty kontrolne, urządzenia skanujące, identyfikatory i leady sponsorów.
//
// JEDNA TRASA NA PODMODUŁ, WYDARZENIE WYBIERANE W ŚRODKU - tak jak agenda,
// zapisy i sponsorzy.
//
// BRAMKA ROLI JEST W BAZIE, TU STOI TYLKO ZDANIE. Każde RPC modułu ma asercję
// roli w tenancie, więc redaktor bez uprawnień dostanie odmowę niezależnie od
// tego, co pokaże ekran; komunikat istnieje po to, żeby odmowa nie wyglądała jak
// awaria.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { OnsiteManager } from "@/components/admin/events/organisms/OnsiteManager";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureOnsiteI18n } from "@/lib/i18n-admin-event-onsite";

export const Route = createFileRoute("/admin/events/onsite")({
  head: () => ({
    meta: [
      { title: "On-site check-in · Events · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content:
          "Run the event on site: check-in desk, log, checkpoints, scanner devices, badges and sponsor leads.",
      },
    ],
  }),
  component: AdminEventOnsitePage,
});

function AdminEventOnsitePage() {
  ensureAdminEventsI18n();
  ensureOnsiteI18n();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t("adminEventOnsite.errors.forbidden")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <OnsiteManager />
    </div>
  );
}
