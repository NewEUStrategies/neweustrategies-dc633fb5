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

/**
 * Filtry skrzynki w adresie (br. 04 D7): link „zgłoszenia czekające w
 * specjalizacji X” z huba i historia przeglądarki odtwarzają ten sam widok.
 * Pola opcjonalne, żeby istniejące linki do trasy nie musiały podawać `search`.
 */
interface ClubApplicationsSearch {
  spec?: string;
  status?: string;
  q?: string;
}

/**
 * Lustro `APPLICATION_STATUSES` (`lib/clubs/adminApplicationsInbox.ts`).
 * Walidator adresu jedzie w konfiguracji trasy (chunk wejściowy), więc nie
 * importuje modułu skrzynki - parytet pilnuje `adminClubRoutes.test.tsx`.
 */
const CLUB_APPLICATIONS_SEARCH_STATUSES = [
  "pending",
  "review",
  "accepted",
  "rejected",
  "needs_info",
] as const;

function parseClubApplicationsSearch(search: Record<string, unknown>): ClubApplicationsSearch {
  const status = search.status;
  return {
    spec:
      typeof search.spec === "string" && search.spec.length > 0 && search.spec.length < 80
        ? search.spec
        : undefined,
    status: CLUB_APPLICATIONS_SEARCH_STATUSES.find((s) => s === status),
    q:
      typeof search.q === "string" && search.q.length > 0 && search.q.length < 200
        ? search.q
        : undefined,
  };
}

export const Route = createFileRoute("/admin/community/clubs/applications")({
  validateSearch: parseClubApplicationsSearch,
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

  return <ClubApplicationsInboxFromUrl />;
}

/** Skrzynka sterowana adresem: filtr zmienia wpis historii bez nowego kroku. */
function ClubApplicationsInboxFromUrl() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ClubApplicationsInbox
      filters={{ spec: search.spec ?? "", status: search.status ?? "", search: search.q ?? "" }}
      onFiltersChange={(next) =>
        void navigate({
          search: {
            spec: next.spec || undefined,
            status: next.status || undefined,
            q: next.search || undefined,
          },
          replace: true,
        })
      }
    />
  );
}
