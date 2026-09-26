// /admin/events/<id>/sponsor-report - ekran „Raport dla sponsorów" studia wydarzenia.
//
// TRASA JEST CIENKA. Wiersz wydarzenia wczytuje RAMA studia i to ona pokazuje
// spinner oraz zdanie „nie znaleziono"; ekran, który powtórzyłby jedno i
// drugie, dawałby dwa spinnery pod sobą. Dopóki wiersza nie ma, ekran nie
// rysuje niczego. Treść - wyświetlenia, kliknięcia, zebrane kontakty, linki
// dla sponsorów i przeniesienie kontaktów do CRM - to `SponsorReportPanel`,
// który rysuje `EventStudioPage` pod TYM SAMYM kluczem co etykieta w sidebarze
// (`adminEvents.studio.sections.sponsorReport`).
//
// `?sponsor=<uuid>` otwiera raport z filtrem jednego sponsora - tak prowadzi
// odnośnik z karty firmy w CRM („Sponsoring wydarzeń"). Wartość spoza kształtu
// uuid jest odrzucana w `validateSearch`, zanim dotknie zapytania.
import { createFileRoute } from "@tanstack/react-router";

import { SponsorReportPanel } from "@/components/admin/events/organisms/SponsorReportPanel";
import { UUID_PATTERN } from "@/lib/events/sponsorExposure";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

interface SponsorReportSearch {
  sponsor?: string;
}

export const Route = createFileRoute("/admin/events_/$eventId/sponsor-report")({
  validateSearch: (search: Record<string, unknown>): SponsorReportSearch =>
    typeof search.sponsor === "string" && UUID_PATTERN.test(search.sponsor)
      ? { sponsor: search.sponsor }
      : {},
  head: () => ({
    meta: [
      { title: "Sponsor report · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Impressions, clicks and collected contacts for the sponsors of this event.",
      },
    ],
  }),
  component: EventStudioSponsorReportPage,
});

function EventStudioSponsorReportPage() {
  const { eventId } = Route.useParams();
  const { sponsor } = Route.useSearch();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <SponsorReportPanel key={row.id} row={row} initialSponsorId={sponsor ?? null} />;
}
