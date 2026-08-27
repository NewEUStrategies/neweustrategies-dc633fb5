// /admin/events/<id>/content/tracks - podstrona „Tracks" studia wydarzenia.
//
// TRASA JEST CIENKA. Wiersz wydarzenia wczytuje RAMA studia i to ona pokazuje
// spinner oraz zdanie „nie znaleziono"; podstrona, która powtórzyłaby jedno i
// drugie, dawałaby dwa spinnery pod sobą i dwa komunikaty o tym samym braku.
// Dopóki wiersza nie ma, podstrona nie rysuje niczego.
//
// OTWARTE PASMO MIESZKA W ADRESIE (`?track=<id>`). Warsztat ścieżki to osobny
// ekran z ośmioma zakładkami (Szczegóły, Format i wideo, Prelegenci, Wystawcy,
// Uczestnicy, Sesje, Dokumenty, Preferencje) - trzymany wyłącznie w stanie
// komponentu znikał po odświeżeniu i nie dawał się wysłać linkiem.
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { EventContentTracksSection } from "@/components/admin/events/studio/EventStudioModuleSections";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

interface TracksSearch {
  track?: string;
}

export const Route = createFileRoute("/admin/events_/$eventId/content/tracks")({
  validateSearch: (search: Record<string, unknown>): TracksSearch => {
    const raw = search["track"];
    return typeof raw === "string" && raw !== "" ? { track: raw } : {};
  },
  head: () => ({
    meta: [
      { title: "Tracks · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Thematic tracks that group the sessions of this event.",
      },
    ],
  }),
  component: EventStudioContentTracksPage,
});

function EventStudioContentTracksPage() {
  const { eventId } = Route.useParams();
  const { track } = Route.useSearch();
  const navigate = useNavigate();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return (
    <EventContentTracksSection
      row={row}
      openedTrackId={track ?? null}
      onOpenTrack={(trackId) => {
        void navigate({
          to: "/admin/events/$eventId/content/tracks",
          params: { eventId },
          search: trackId === null ? {} : { track: trackId },
          replace: true,
        });
      }}
    />
  );
}
