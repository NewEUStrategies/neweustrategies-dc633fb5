// /admin/events/terms - grupy uczestników, członkostwa dodatkowe, zgody.
//
// JEDNA TRASA NA PODMODUŁ, WYDARZENIE WYBIERANE W ŚRODKU - tak jak sponsorzy,
// agenda, zapisy i giełda spotkań.
//
// BRAMKA ROLI JEST W BAZIE, TU STOI TYLKO ZDANIE. Każde RPC grup i zgód ma
// asercję roli w tenancie; komunikat istnieje po to, żeby odmowa nie wyglądała
// jak awaria.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { TermsGroupsManager } from "@/components/admin/events/organisms/TermsGroupsManager";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureTermsI18n } from "@/lib/i18n-admin-event-terms";

export const Route = createFileRoute("/admin/events/terms")({
  head: () => ({
    meta: [
      { title: "Groups and consents · Events · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content:
          "Manage attendee groups and their permissions, extra memberships and event consents with acceptance counters.",
      },
    ],
  }),
  component: AdminEventTermsPage,
});

function AdminEventTermsPage() {
  ensureAdminEventsI18n();
  ensureTermsI18n();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t("adminEventTerms.errors.forbidden")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <TermsGroupsManager />
    </div>
  );
}
