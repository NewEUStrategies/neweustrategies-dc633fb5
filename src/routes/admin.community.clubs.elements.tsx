// /admin/community/clubs/elements - katalog elementów Klubu dyskusyjnego.
//
// Powierzchnia operacyjna, nie publiczna: pokazuje słowniki bazy, macierz
// uprawnień i kody odmów, czyli materiał do pisania SQL-a i odpowiadania na
// zgłoszenia. Dlatego mieszka w panelu (bramka `isStaff` z admin.tsx +
// własna `isAdmin`, tak jak lista klubów), a stara trasa /club/elements
// przekierowuje tutaj.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClubElementsCatalog } from "@/components/admin/clubs/organisms/ClubElementsCatalog";
import { ensureClubI18n } from "@/lib/i18n-club";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";
import { ensureClubElementsI18n } from "@/lib/i18n-club-elements";

export const Route = createFileRoute("/admin/community/clubs/elements")({
  head: () => ({
    meta: [
      { title: "Klub - katalog elementów · Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminClubElementsPage,
});

function AdminClubElementsPage() {
  ensureAdminClubsI18n();
  ensureClubI18n();
  ensureClubElementsI18n();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <ShieldAlert className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">{t("adminClubs.noPermissionTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t("adminClubs.noPermissionBody")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{t("clubElements.title")}</h1>
            <Badge variant="outline">{t("clubElements.ui.sandbox")}</Badge>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">{t("clubElements.subtitle")}</p>
          <p className="text-xs text-muted-foreground/80">{t("clubElements.note")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/community/clubs">{t("clubElements.routes.admin")}</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/club" target="_blank">
              {t("clubElements.routes.index")}
              <ExternalLink className="size-3.5" />
            </Link>
          </Button>
        </div>
      </header>

      <ClubElementsCatalog />
    </div>
  );
}
