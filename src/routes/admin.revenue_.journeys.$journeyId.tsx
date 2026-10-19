// /admin/revenue/journeys/$journeyId - edytor ścieżki komunikacji.
//
// PODKREŚLNIK W `revenue_` WYPINA EDYTOR Z UKŁADU HUBA (wzór:
// `admin.events_.$eventId.tsx`). Kanwa grafu potrzebuje całej szerokości:
// nagłówek huba i pasek zakładek nad nią odbierałyby miejsce, a pasek boczny
// panelu startuje tu zwinięty (`isCompactSidebarRoute`). Przez to edytor nie
// dziedziczy też walidatora huba - ma własny kontrakt adresu
// (`parseJourneyEditorSearch`: widok, węzeł, panel boczny, okno statystyk,
// wersja).
//
// Powłoka lekka jak w `admin.revenue.tsx`: walidator z liścia, nagłówek
// literałem, bez słownika i bez zapytań - edytor wczytuje dane sam (S8).
import { createFileRoute } from "@tanstack/react-router";

import { JourneyEditorRoute } from "@/components/admin/journeys/editor/JourneyEditorRoute";
import { adminPageHead } from "@/lib/adminPageHead";
import { parseJourneyEditorSearch } from "@/lib/journeys/editorSearch";

export const Route = createFileRoute("/admin/revenue_/journeys/$journeyId")({
  validateSearch: parseJourneyEditorSearch,
  head: () =>
    adminPageHead(
      "Ścieżka komunikacji - edytor",
      "Wyzwalacz, kroki, warunki, wyniki i publikacja ścieżki.",
    ),
  component: JourneyEditorPage,
});

function JourneyEditorPage() {
  const { journeyId } = Route.useParams();
  const search = Route.useSearch();
  return <JourneyEditorRoute journeyId={journeyId} search={search} />;
}
