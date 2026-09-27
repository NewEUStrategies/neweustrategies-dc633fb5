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
//
// WZORZEC UUID JEST TU WPISANY, NIE IMPORTOWANY z `sponsorExposure`. Splitter
// TanStacka wynosi do osobnego chunku wyłącznie `component`; `validateSearch`
// zostaje w drzewie tras, czyli w chunku WEJŚCIOWYM każdej strony. Import
// stamtąd wciągał do entry cały słownik pomiaru ekspozycji sponsorów - dla
// czytelnika, który nigdy nie otworzy panelu (kronika `check-bundle-size.ts`,
// wpis XIX). Parytet z tamtym wzorcem pilnuje test trasy.
import { createFileRoute } from "@tanstack/react-router";

import { SponsorReportPanel } from "@/components/admin/events/organisms/SponsorReportPanel";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

/** Kształt uuid - ten sam, co `UUID_PATTERN` w `lib/events/sponsorExposure.ts`. */
const SPONSOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SponsorReportSearch {
  sponsor?: string;
}

export const Route = createFileRoute("/admin/events_/$eventId/sponsor-report")({
  // Klucz wraca ZAWSZE, także jako `undefined`: router składa search z surowego
  // adresu i wyniku walidatora (`{...surowy, ...zwalidowany}`), więc pominięty
  // klucz przepuściłby surową wartość `?sponsor=` do komponentu.
  validateSearch: (search: Record<string, unknown>): SponsorReportSearch => ({
    sponsor:
      typeof search.sponsor === "string" && SPONSOR_ID_PATTERN.test(search.sponsor)
        ? search.sponsor
        : undefined,
  }),
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
