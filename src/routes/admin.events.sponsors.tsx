// /admin/events/sponsors - poziomy sponsorskie, przypięcia firm z CRM, materiały.
//
// JEDNA TRASA NA PODMODUŁ, WYDARZENIE WYBIERANE W ŚRODKU - tak jak agenda,
// zapisy i giełda spotkań.
//
// BRAMKA ROLI JEST W BAZIE, TU STOI TYLKO ZDANIE. Każde RPC sponsorów ma
// asercję roli w tenancie; komunikat istnieje po to, żeby odmowa nie wyglądała
// jak awaria.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { SponsorsManager } from "@/components/admin/events/organisms/SponsorsManager";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureSponsorsI18n } from "@/lib/i18n-admin-event-sponsors";

export const Route = createFileRoute("/admin/events/sponsors")({
  head: () => ({
    meta: [
      { title: "Sponsors and partners · Events · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content:
          "Manage sponsor tiers, pin CRM companies to an event and curate public sponsor materials.",
      },
    ],
  }),
  component: AdminEventSponsorsPage,
});

function AdminEventSponsorsPage() {
  ensureAdminEventsI18n();
  ensureSponsorsI18n();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t("adminEventSponsors.errors.forbidden")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <SponsorsManager />
    </div>
  );
}
