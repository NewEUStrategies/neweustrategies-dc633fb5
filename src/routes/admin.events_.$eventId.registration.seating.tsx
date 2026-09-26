// /admin/events/<id>/registration/seating - ekran „Plan sali" studia wydarzenia.
//
// TRASA JEST CIENKA. Wiersz wydarzenia wczytuje RAMA studia i to ona pokazuje
// spinner oraz zdanie „nie znaleziono"; ekran, który powtórzyłby jedno i
// drugie, dawałby dwa spinnery pod sobą. Dopóki wiersza nie ma, ekran nie
// rysuje niczego. Tytuł to TEN SAM klucz co etykieta w sidebarze.
//
// OTWARTY PLAN MIESZKA W ADRESIE (`?map=<id>`) - jak otwarte pasmo agendy
// (`?track=`): plan da się wysłać linkiem, a „wstecz" w przeglądarce wraca do
// listy planów. Pod `/admin` nie ma loaderów - dane czyta panel po stronie
// klienta.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { SeatingPanel } from "@/components/admin/events/organisms/SeatingPanel";
import { EventStudioPage } from "@/components/admin/events/studio/EventStudioSection";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureI18n } from "@/lib/i18n-admin-events";
import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";

interface SeatingSearch {
  map?: string;
}

export const Route = createFileRoute("/admin/events_/$eventId/registration/seating")({
  validateSearch: (search: Record<string, unknown>): SeatingSearch => {
    const raw = search["map"];
    return typeof raw === "string" && raw !== "" ? { map: raw } : {};
  },
  head: () => ({
    meta: [
      { title: "Seating plan · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Seating plan of this event with seat assignment.",
      },
    ],
  }),
  component: EventStudioRegistrationSeatingPage,
});

function EventStudioRegistrationSeatingPage() {
  ensureI18n();
  ensureSeatingI18n();
  const { t, i18n } = useTranslation();
  const { eventId } = Route.useParams();
  const { map } = Route.useSearch();
  const navigate = useNavigate();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return (
    <EventStudioPage
      title={t("adminEvents.studio.sections.registrationSeating")}
      description={t("adminEventSeating.description")}
    >
      <SeatingPanel
        key={row.id}
        eventId={row.id}
        eventSlug={row.slug}
        eventTitle={pickLocalized(row, "title", uiLang(i18n.language))}
        mapId={map ?? null}
        onOpenMap={(mapId) => {
          void navigate({
            to: "/admin/events/$eventId/registration/seating",
            params: { eventId },
            search: mapId === null ? {} : { map: mapId },
          });
        }}
      />
    </EventStudioPage>
  );
}
