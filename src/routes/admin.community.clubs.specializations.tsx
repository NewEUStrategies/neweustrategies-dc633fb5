// /admin/community/clubs/specializations - katalog specjalizacji klubów.
//
// Osobna trasa, a nie zakładka w konkretnym klubie: specjalizacja jest
// wspólna dla całej organizacji i to ona decyduje o tym, co widać na hubie
// i pod adresem /club/specialization/<slug>.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { ClubSpecializationsManager } from "@/components/admin/clubs/organisms/ClubSpecializationsManager";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/admin/community/clubs/specializations")({
  head: () => ({
    meta: [
      { title: "Specialisations · Clubs · Admin" },
      {
        name: "description",
        content: "Manage discussion club specialisations and their public landing pages.",
      },
    ],
  }),
  component: AdminClubSpecializationsPage,
});

function AdminClubSpecializationsPage() {
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
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <ClubSpecializationsManager />
    </div>
  );
}
