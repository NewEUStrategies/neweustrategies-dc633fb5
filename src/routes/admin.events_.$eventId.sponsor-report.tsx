// /admin/events/<id>/sponsor-report - ekran „Raport dla sponsorów" studia wydarzenia.
//
// ZAŚLEPKA FUNDAMENTU. Trasa, pozycja w sidebarze (`EVENT_STUDIO_NAV`), klucz
// sekcji (`sponsorReport`) i etykieta (`adminEvents.studio.sections.sponsorReport`) są
// założone z góry, żeby siedem funkcji organizatora powstających równolegle
// nie kolidowało na drzewie tras ani na nawigacji. Właściciel ekranu - agent
// f6 (raport sponsora) - zastępuje CIAŁO komponentu swoim organizmem, zostawiając
// `EventStudioPage` z tym samym tytułem (ten sam klucz co etykieta w sidebarze).
//
// TRASA JEST CIENKA. Wiersz wydarzenia wczytuje RAMA studia i to ona pokazuje
// spinner oraz zdanie „nie znaleziono"; ekran, który powtórzyłby jedno i
// drugie, dawałby dwa spinnery pod sobą. Dopóki wiersza nie ma, ekran nie
// rysuje niczego.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { EventStudioPage } from "@/components/admin/events/studio/EventStudioSection";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";
import { ensureI18n } from "@/lib/i18n-admin-events";

export const Route = createFileRoute("/admin/events_/$eventId/sponsor-report")({
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
  ensureI18n();
  const { t } = useTranslation();
  const { eventId } = Route.useParams();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return (
    <EventStudioPage title={t("adminEvents.studio.sections.sponsorReport")}>{null}</EventStudioPage>
  );
}
