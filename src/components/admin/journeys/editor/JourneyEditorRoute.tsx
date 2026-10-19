// Edytor ścieżki komunikacji (`/admin/revenue/journeys/$journeyId`) - ZAŚLEPKA
// wycinka I0; właściciel po scaleniu: S8 (kanwa, lista kroków, wyniki,
// publikacja; wymóg aal2 przez `MfaRequiredNotice` z S6).
//
// WŁASNE `ensureI18n()` I WŁASNA BRAMKA ROLI. Trasa edytora jest WYPIĘTA
// z układu huba (`admin.revenue_.journeys…` - kanwa potrzebuje całej
// szerokości, bez nagłówka i paska zakładek), więc nie dziedziczy ani
// rejestracji słownika, ani sprawdzenia roli z `RevenueHubLayout`. Warunek jest
// ten sam co w układzie: wiersz `admin` albo `editor`, nie `isAdmin` (ten liczy
// też `super_admin`, którego polityki ścieżek nie wpuszczają - edytor byłby
// pusty). Autorytetem pozostaje baza.
//
// `journeyId` i `search` przychodzą z powłoki trasy (`Route.useParams()`,
// `Route.useSearch()` po `parseJourneyEditorSearch`), a nie z hooków routera
// tutaj: komponent nie zna swojej trasy, więc da się go zamontować w teście
// i w podglądzie bez routera.
import { useHydrated } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n } from "@/lib/i18n-admin-revenue";
import type { JourneyEditorSearch } from "@/lib/journeys/editorSearch";

export function JourneyEditorRoute({
  journeyId,
  search,
}: {
  journeyId: string;
  search: JourneyEditorSearch;
}) {
  ensureI18n();
  const { t } = useTranslation();
  const hydrated = useHydrated();
  const { roles } = useAuth();

  if (!hydrated) return <RevenueTabPending />;

  if (!(roles.includes("admin") || roles.includes("editor"))) {
    return (
      <p role="status" data-testid="revenue-role-gate" className="text-sm text-muted-foreground">
        {t("adminRevenue.common.roleGate")}
      </p>
    );
  }

  return (
    <section
      data-testid="journey-editor"
      data-journey-id={journeyId}
      data-view={search.view ?? "canvas"}
      className="space-y-2"
    >
      <h1 className="text-2xl font-semibold">{t("adminRevenue.tab.journeys")}</h1>
      <p className="text-sm text-muted-foreground">{t("adminRevenue.common.pending")}</p>
    </section>
  );
}
