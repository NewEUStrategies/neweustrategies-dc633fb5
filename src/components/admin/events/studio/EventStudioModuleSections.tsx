// Sekcje studia, ktore montuja ISTNIEJACE panele modulu wydarzen.
//
// PANELE JUZ ISTNIEJA i przyjmuja `eventId` - brakowalo im tylko miejsca,
// w ktorym wydarzenie jest juz WYBRANE. Dotad kazdy ekran modulu mial wlasna
// dropliste wyboru wydarzenia na gorze; w studiu wybor zrobil sidebar, wiec
// droplista bylaby pytaniem o cos, co juz wiadomo (i drugim, rozjezdzajacym sie
// zrodlem prawdy o tym, ktore wydarzenie jest edytowane).
//
// STARE TRASY MODULU ZOSTAJA NIETKNIETE. `/admin/events/agenda` i siostrzane
// nadal dzialaja ze swoja droplista - kto pracuje na kilku wydarzeniach naraz,
// nie musi przechodzic przez studio. Studio jest DRUGA droga do tych samych
// paneli, a nie ich zamiennikiem.
//
// `key={eventId}` NA KAZDYM PANELU: zmiana wydarzenia resetuje szkice
// formularzy, zamiast przepisywac stan poprzedniego wydarzenia na nowe.
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EventStudioPage } from "@/components/admin/events/studio/EventStudioSection";
import { AgendaConflictsPanel } from "@/components/admin/events/organisms/AgendaConflictsPanel";
import { AgendaRoomsPanel } from "@/components/admin/events/organisms/AgendaRoomsPanel";
import { AgendaSessionsPanel } from "@/components/admin/events/organisms/AgendaSessionsPanel";
import { AgendaTracksPanel } from "@/components/admin/events/organisms/AgendaTracksPanel";
import { EventTermsPanel } from "@/components/admin/events/organisms/EventTermsPanel";
import { EventTicketsPanel } from "@/components/admin/events/organisms/EventTicketsPanel";
import { GroupMembersPanel } from "@/components/admin/events/organisms/GroupMembersPanel";
import { MeetingSettingsPanel } from "@/components/admin/events/organisms/MeetingSettingsPanel";
import { MeetingStatsPanel } from "@/components/admin/events/organisms/MeetingStatsPanel";
import { MeetingTablesPanel } from "@/components/admin/events/organisms/MeetingTablesPanel";
import { MeetingsListPanel } from "@/components/admin/events/organisms/MeetingsListPanel";
import { OnsiteBadgesPanel } from "@/components/admin/events/organisms/OnsiteBadgesPanel";
import { OnsiteCheckpointsPanel } from "@/components/admin/events/organisms/OnsiteCheckpointsPanel";
import { OnsiteDeskPanel } from "@/components/admin/events/organisms/OnsiteDeskPanel";
import { OnsiteDevicesPanel } from "@/components/admin/events/organisms/OnsiteDevicesPanel";
import { OnsiteLeadsPanel } from "@/components/admin/events/organisms/OnsiteLeadsPanel";
import { OnsiteLogPanel } from "@/components/admin/events/organisms/OnsiteLogPanel";
import { OnsiteStatsPanel } from "@/components/admin/events/organisms/OnsiteStatsPanel";
import { RegistrationFieldsPanel } from "@/components/admin/events/organisms/RegistrationFieldsPanel";
import { RegistrationsListPanel } from "@/components/admin/events/organisms/RegistrationsListPanel";
import { SponsorTiersPanel } from "@/components/admin/events/organisms/SponsorTiersPanel";
import { SponsorsListPanel } from "@/components/admin/events/organisms/SponsorsListPanel";
import { eventTimeZone } from "@/lib/events/timezone";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureAgendaI18n } from "@/lib/i18n-admin-event-agenda";
import { ensureI18n as ensureMeetingsI18n } from "@/lib/i18n-admin-event-meetings";
import { ensureOnsiteI18n } from "@/lib/i18n-admin-event-onsite";
import { ensureI18n as ensureRegistrationI18n } from "@/lib/i18n-admin-event-registration";
import { ensureSponsorsI18n } from "@/lib/i18n-admin-event-sponsors";
import { ensureTermsI18n } from "@/lib/i18n-admin-event-terms";

export function EventRegistrationSection({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  ensureRegistrationI18n();
  const { t } = useTranslation();
  const eventId = row.id;
  return (
    <EventStudioPage title={t("adminEvents.studio.sections.registration")}>
      <Tabs defaultValue="registrations" className="space-y-4 py-6">
        <TabsList className="tabs-scroller">
          <TabsTrigger value="registrations">
            {t("adminEventRegistration.nav.registrations")}
          </TabsTrigger>
          <TabsTrigger value="tickets">{t("adminEventRegistration.nav.tickets")}</TabsTrigger>
          <TabsTrigger value="form">{t("adminEventRegistration.nav.form")}</TabsTrigger>
        </TabsList>
        <TabsContent value="registrations">
          <RegistrationsListPanel key={eventId} eventId={eventId} eventSlug={row.slug} />
        </TabsContent>
        <TabsContent value="tickets">
          <EventTicketsPanel key={eventId} eventId={eventId} />
        </TabsContent>
        <TabsContent value="form">
          <RegistrationFieldsPanel key={eventId} eventId={eventId} />
        </TabsContent>
      </Tabs>
    </EventStudioPage>
  );
}

export function EventContentSection({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  ensureAgendaI18n();
  const { t } = useTranslation();
  const eventId = row.id;
  // Godziny sesji wpisuje sie w STREFIE WYDARZENIA - bez tej etykiety
  // organizator w innej strefie wpisuje wlasne popoludnie w cudzy poranek.
  const timeZoneLabel = eventTimeZone({ timezone: row.timezone });
  return (
    <EventStudioPage title={t("adminEvents.studio.sections.content")}>
      <Tabs defaultValue="sessions" className="space-y-4 py-6">
        <TabsList className="tabs-scroller">
          <TabsTrigger value="sessions">{t("adminEventAgenda.nav.sessions")}</TabsTrigger>
          <TabsTrigger value="tracks">{t("adminEventAgenda.nav.tracks")}</TabsTrigger>
          <TabsTrigger value="rooms">{t("adminEventAgenda.nav.rooms")}</TabsTrigger>
          <TabsTrigger value="conflicts">{t("adminEventAgenda.nav.conflicts")}</TabsTrigger>
        </TabsList>
        <TabsContent value="sessions">
          <AgendaSessionsPanel key={eventId} eventId={eventId} timeZoneLabel={timeZoneLabel} />
        </TabsContent>
        <TabsContent value="tracks">
          <AgendaTracksPanel key={eventId} eventId={eventId} />
        </TabsContent>
        <TabsContent value="rooms">
          <AgendaRoomsPanel key={eventId} eventId={eventId} />
        </TabsContent>
        <TabsContent value="conflicts">
          <AgendaConflictsPanel key={eventId} eventId={eventId} />
        </TabsContent>
      </Tabs>
    </EventStudioPage>
  );
}

export function EventMeetingsSection({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  ensureMeetingsI18n();
  const { t } = useTranslation();
  const eventId = row.id;
  return (
    <EventStudioPage title={t("adminEvents.studio.sections.meetings")}>
      <Tabs defaultValue="tables" className="space-y-4 py-6">
        <TabsList className="tabs-scroller">
          <TabsTrigger value="tables">{t("adminEventMeetings.nav.tables")}</TabsTrigger>
          <TabsTrigger value="settings">{t("adminEventMeetings.nav.settings")}</TabsTrigger>
          <TabsTrigger value="meetings">{t("adminEventMeetings.nav.meetings")}</TabsTrigger>
          <TabsTrigger value="stats">{t("adminEventMeetings.nav.stats")}</TabsTrigger>
        </TabsList>
        <TabsContent value="tables">
          <MeetingTablesPanel key={eventId} eventId={eventId} />
        </TabsContent>
        <TabsContent value="settings">
          <MeetingSettingsPanel key={eventId} eventId={eventId} />
        </TabsContent>
        <TabsContent value="meetings">
          <MeetingsListPanel key={eventId} eventId={eventId} />
        </TabsContent>
        <TabsContent value="stats">
          <MeetingStatsPanel key={eventId} eventId={eventId} />
        </TabsContent>
      </Tabs>
    </EventStudioPage>
  );
}

export function EventOnsiteSection({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  ensureOnsiteI18n();
  const { t } = useTranslation();
  const eventId = row.id;
  return (
    <EventStudioPage title={t("adminEvents.studio.sections.onsite")}>
      <Tabs defaultValue="desk" className="space-y-4 py-6">
        <TabsList className="tabs-scroller">
          <TabsTrigger value="desk">{t("adminEventOnsite.nav.desk")}</TabsTrigger>
          <TabsTrigger value="log">{t("adminEventOnsite.nav.log")}</TabsTrigger>
          <TabsTrigger value="stats">{t("adminEventOnsite.nav.stats")}</TabsTrigger>
          <TabsTrigger value="checkpoints">{t("adminEventOnsite.nav.checkpoints")}</TabsTrigger>
          <TabsTrigger value="devices">{t("adminEventOnsite.nav.devices")}</TabsTrigger>
          <TabsTrigger value="badges">{t("adminEventOnsite.nav.badges")}</TabsTrigger>
          <TabsTrigger value="leads">{t("adminEventOnsite.nav.leads")}</TabsTrigger>
        </TabsList>
        <TabsContent value="desk">
          <OnsiteDeskPanel key={eventId} eventId={eventId} />
        </TabsContent>
        <TabsContent value="log">
          <OnsiteLogPanel key={eventId} eventId={eventId} />
        </TabsContent>
        <TabsContent value="stats">
          <OnsiteStatsPanel key={eventId} eventId={eventId} />
        </TabsContent>
        <TabsContent value="checkpoints">
          <OnsiteCheckpointsPanel key={eventId} eventId={eventId} />
        </TabsContent>
        <TabsContent value="devices">
          <OnsiteDevicesPanel key={eventId} eventId={eventId} />
        </TabsContent>
        <TabsContent value="badges">
          <OnsiteBadgesPanel key={eventId} eventId={eventId} />
        </TabsContent>
        <TabsContent value="leads">
          <OnsiteLeadsPanel key={eventId} eventId={eventId} />
        </TabsContent>
      </Tabs>
    </EventStudioPage>
  );
}

export function EventSponsorsSection({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  ensureSponsorsI18n();
  const { t } = useTranslation();
  const eventId = row.id;
  return (
    <EventStudioPage title={t("adminEvents.studio.sections.sponsors")}>
      <Tabs defaultValue="sponsors" className="space-y-4 py-6">
        <TabsList className="tabs-scroller">
          <TabsTrigger value="sponsors">{t("adminEventSponsors.nav.sponsors")}</TabsTrigger>
          <TabsTrigger value="tiers">{t("adminEventSponsors.nav.tiers")}</TabsTrigger>
        </TabsList>
        <TabsContent value="sponsors">
          <SponsorsListPanel key={eventId} eventId={eventId} />
        </TabsContent>
        <TabsContent value="tiers">
          <SponsorTiersPanel key={eventId} eventId={eventId} />
        </TabsContent>
      </Tabs>
    </EventStudioPage>
  );
}

export function EventTermsSection({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  ensureTermsI18n();
  const { t } = useTranslation();
  const eventId = row.id;
  return (
    <EventStudioPage title={t("adminEvents.studio.sections.terms")}>
      <Tabs defaultValue="terms" className="space-y-4 py-6">
        <TabsList className="tabs-scroller">
          <TabsTrigger value="terms">{t("adminEventTerms.nav.terms")}</TabsTrigger>
          <TabsTrigger value="members">{t("adminEventTerms.nav.members")}</TabsTrigger>
        </TabsList>
        <TabsContent value="terms">
          <EventTermsPanel key={eventId} eventId={eventId} />
        </TabsContent>
        <TabsContent value="members">
          <GroupMembersPanel key={eventId} eventId={eventId} />
        </TabsContent>
      </Tabs>
    </EventStudioPage>
  );
}
