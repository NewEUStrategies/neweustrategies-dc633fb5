// /admin/community/clubs/topics - katalog obszarów tematycznych klubów.
//
// Osobna trasa, a nie zakładka w konkretnym klubie: taksonomia jest wspólna
// dla całej organizacji i decyduje o tym, co widać w kreatorze klubu, w
// formularzu wątku i w filtrach na hubie.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { ClubTopicsManager } from "@/components/admin/clubs/organisms/ClubTopicsManager";
import { ensureClubI18n } from "@/lib/i18n-club";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export const Route = createFileRoute("/admin/community/clubs/topics")({
  head: () => ({
    meta: [
      { title: "Policy areas · Clubs · Admin" },
      {
        name: "description",
        content: "Manage the discussion club topic taxonomy for your organisation.",
      },
    ],
  }),
  component: AdminClubTopicsPage,
});

function AdminClubTopicsPage() {
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

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <ClubTopicsManager />
    </div>
  );
}
