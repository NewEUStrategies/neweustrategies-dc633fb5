// /admin/community/clubs/applications - skrzynka zgloszen do klubow.
//
// Osobna trasa zamiast zakladki w konkretnym klubie: zgloszenie powstaje na
// poziomie specjalizacji (kandydat czesto nie wskazuje klubu), a decyzje
// podejmuje redakcja przekrojowo.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { ClubApplicationsInbox } from "@/components/admin/clubs/organisms/ClubApplicationsInbox";
import { ensureClubI18n } from "@/lib/i18n-club";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export const Route = createFileRoute("/admin/community/clubs/applications")({
  head: () => ({
    meta: [
      { title: "Club applications · Clubs · Admin" },
      {
        name: "description",
        content: "Review discussion club membership applications and sync them with the CRM.",
      },
      { property: "og:title", content: "Club applications · Admin" },
      {
        property: "og:description",
        content: "Review discussion club membership applications and sync them with the CRM.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminClubApplicationsPage,
});

function AdminClubApplicationsPage() {
  ensureAdminClubsI18n();
  ensureClubI18n();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t("adminClubs.topics.adminOnly")}
        </CardContent>
      </Card>
    );
  }

  return <ClubApplicationsInbox />;
}
