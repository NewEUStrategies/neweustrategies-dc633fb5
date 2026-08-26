// Ekrany studia, ktore montuja ISTNIEJACE panele modulu wydarzen.
//
// PANELE JUZ ISTNIEJA i przyjmuja `eventId` - brakowalo im tylko miejsca,
// w ktorym wydarzenie jest juz WYBRANE. Dotad kazdy ekran modulu mial wlasna
// dropliste wyboru wydarzenia na gorze; w studiu wybor zrobil sidebar, wiec
// droplista bylaby pytaniem o cos, co juz wiadomo (i drugim, rozjezdzajacym sie
// zrodlem prawdy o tym, ktore wydarzenie jest edytowane).
//
// JEDEN PANEL = JEDNA PODSTRONA. Do tej zmiany cztery sekcje („Rejestracja",
// „Tresc", „Spotkania", „Na miejscu") sciagaly po kilka paneli i przelaczaly je
// ZAKLADKAMI. Zakladki znikly, bo nawigacja przeniosla sie do sidebara: kazdy
// panel ma teraz wlasny adres, wiec da sie do niego odeslac link i wrocic
// z zakladki przegladarki, a sidebar mowi „jestem w Salach", a nie „jestem
// w Tresci". Dwie nawigacje jedna nad druga odpowiadaly na to samo pytanie
// „gdzie jestem" dwa razy.
//
// ZAKLADKI ZOSTAJA W DWOCH MIEJSCACH: „Sponsorzy i reklama" (lista + poziomy)
// i „Regulaminy" (zgody + czlonkostwa). Te dwie zostaja POZYCJAMI sidebara,
// bo sidebar wzorca jest dwupoziomowy - „Kreator > Sponsorzy > Poziomy" byloby
// trzecim poziomem, ktorego wzorzec nie ma.
//
// TYTUL EKRANU TO TA SAMA ETYKIETA, CO POZYCJA W SIDEBARZE, i pochodzi z tego
// samego klucza slownika modulu. Dwa napisy na jedna rzecz („Sesje" w sidebarze,
// „Agenda" w naglowku) kaza sie za kazdym razem upewniac, czy to ten ekran.
//
// STARE TRASY MODULU ZOSTAJA NIETKNIETE. `/admin/events/agenda` i siostrzane
// nadal dzialaja ze swoja droplista - kto pracuje na kilku wydarzeniach naraz,
// nie musi przechodzic przez studio. Studio jest DRUGA droga do tych samych
// paneli, a nie ich zamiennikiem.
//
// `key={eventId}` NA KAZDYM PANELU: zmiana wydarzenia resetuje szkice
// formularzy, zamiast przepisywac stan poprzedniego wydarzenia na nowe.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EventStudioPage } from "@/components/admin/events/studio/EventStudioSection";
import { EventSpeakersManager } from "@/components/admin/community/EventSpeakersManager";
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
import { ensureI18n as ensureCommunityEventsI18n } from "@/lib/i18n-admin-community-events";
import { ensureAgendaI18n } from "@/lib/i18n-admin-event-agenda";
import { ensureI18n as ensureMeetingsI18n } from "@/lib/i18n-admin-event-meetings";
import { ensureOnsiteI18n } from "@/lib/i18n-admin-event-onsite";
import { ensureI18n as ensureRegistrationI18n } from "@/lib/i18n-admin-event-registration";
import { ensureSponsorsI18n } from "@/lib/i18n-admin-event-sponsors";
import { ensureTermsI18n } from "@/lib/i18n-admin-event-terms";

/**
 * Rama jednoekranowej podstrony studia.
 *
 * Tytul przychodzi KLUCZEM, nie napisem: dziewietnascie ekranow przepisanych
 * „na piechote" rozjechaloby sie z sidebarem na pierwszej korekcie nazwy.
 */
function ModuleScreen({ titleKey, children }: { titleKey: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <EventStudioPage title={t(titleKey)}>
      <div className="py-6">{children}</div>
    </EventStudioPage>
  );
}

// ------------------------------------------------- Rejestracja w aplikacji

export function EventRegistrationListSection({ row }: { row: AdminEventDetailRow }) {
  ensureRegistrationI18n();
  return (
    <ModuleScreen titleKey="adminEventRegistration.nav.registrations">
      {/* `eventSlug` jest tu po to, zeby wiersz zgloszenia mogl prowadzic na
          strone publiczna wydarzenia - panel sam adresu nie zna. */}
      <RegistrationsListPanel key={row.id} eventId={row.id} eventSlug={row.slug} />
    </ModuleScreen>
  );
}

export function EventRegistrationTicketsSection({ row }: { row: AdminEventDetailRow }) {
  ensureRegistrationI18n();
  return (
    <ModuleScreen titleKey="adminEventRegistration.nav.tickets">
      <EventTicketsPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

export function EventRegistrationFormSection({ row }: { row: AdminEventDetailRow }) {
  ensureRegistrationI18n();
  return (
    <ModuleScreen titleKey="adminEventRegistration.nav.form">
      <RegistrationFieldsPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

// ------------------------------------------------------------------ Tresc

export function EventContentSessionsSection({ row }: { row: AdminEventDetailRow }) {
  ensureAgendaI18n();
  // Godziny sesji wpisuje sie w STREFIE WYDARZENIA - bez tej etykiety
  // organizator w innej strefie wpisuje wlasne popoludnie w cudzy poranek.
  const timeZoneLabel = eventTimeZone({ timezone: row.timezone });
  return (
    <ModuleScreen titleKey="adminEventAgenda.nav.sessions">
      <AgendaSessionsPanel key={row.id} eventId={row.id} timeZoneLabel={timeZoneLabel} />
    </ModuleScreen>
  );
}

/**
 * Prelegenci wydarzenia.
 *
 * OSTATNI EKRAN, KTORY TRZYMAL PRZY ZYCIU STARA TRASE. Katalog prelegentow
 * mieszkal wylacznie w `/admin/community/events` - wewnatrz dialogu edycji
 * wydarzenia, do ktorego dochodzilo sie przez wyszukanie wydarzenia po slugu.
 * Komponent od poczatku przyjmuje `eventId`, wiec brakowalo mu tylko miejsca,
 * w ktorym wydarzenie jest juz wybrane.
 *
 * Slownik jest ten sam, co w sekcji spolecznosci (`adminCommunityEvents`) -
 * komponent wozi swoje teksty i nie ma powodu ich przepisywac po to, zeby
 * stanely pod innym korzeniem.
 */
export function EventContentSpeakersSection({ row }: { row: AdminEventDetailRow }) {
  ensureCommunityEventsI18n();
  return (
    <ModuleScreen titleKey="adminEvents.nav.speakers">
      <EventSpeakersManager key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

export function EventContentTracksSection({ row }: { row: AdminEventDetailRow }) {
  ensureAgendaI18n();
  return (
    <ModuleScreen titleKey="adminEventAgenda.nav.tracks">
      <AgendaTracksPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

export function EventContentRoomsSection({ row }: { row: AdminEventDetailRow }) {
  ensureAgendaI18n();
  return (
    <ModuleScreen titleKey="adminEventAgenda.nav.rooms">
      <AgendaRoomsPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

export function EventContentConflictsSection({ row }: { row: AdminEventDetailRow }) {
  ensureAgendaI18n();
  return (
    <ModuleScreen titleKey="adminEventAgenda.nav.conflicts">
      <AgendaConflictsPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

// -------------------------------------------------------------- Spotkania

export function EventMeetingsTablesSection({ row }: { row: AdminEventDetailRow }) {
  ensureMeetingsI18n();
  return (
    <ModuleScreen titleKey="adminEventMeetings.nav.tables">
      <MeetingTablesPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

export function EventMeetingsSettingsSection({ row }: { row: AdminEventDetailRow }) {
  ensureMeetingsI18n();
  return (
    <ModuleScreen titleKey="adminEventMeetings.nav.settings">
      <MeetingSettingsPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

export function EventMeetingsListSection({ row }: { row: AdminEventDetailRow }) {
  ensureMeetingsI18n();
  return (
    <ModuleScreen titleKey="adminEventMeetings.nav.meetings">
      <MeetingsListPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

export function EventMeetingsStatsSection({ row }: { row: AdminEventDetailRow }) {
  ensureMeetingsI18n();
  return (
    <ModuleScreen titleKey="adminEventMeetings.nav.stats">
      <MeetingStatsPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

// -------------------------------------------------------------- Na miejscu

export function EventOnsiteDeskSection({ row }: { row: AdminEventDetailRow }) {
  ensureOnsiteI18n();
  return (
    <ModuleScreen titleKey="adminEventOnsite.nav.desk">
      <OnsiteDeskPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

export function EventOnsiteLogSection({ row }: { row: AdminEventDetailRow }) {
  ensureOnsiteI18n();
  return (
    <ModuleScreen titleKey="adminEventOnsite.nav.log">
      <OnsiteLogPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

export function EventOnsiteStatsSection({ row }: { row: AdminEventDetailRow }) {
  ensureOnsiteI18n();
  return (
    <ModuleScreen titleKey="adminEventOnsite.nav.stats">
      <OnsiteStatsPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

export function EventOnsiteCheckpointsSection({ row }: { row: AdminEventDetailRow }) {
  ensureOnsiteI18n();
  return (
    <ModuleScreen titleKey="adminEventOnsite.nav.checkpoints">
      <OnsiteCheckpointsPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

export function EventOnsiteDevicesSection({ row }: { row: AdminEventDetailRow }) {
  ensureOnsiteI18n();
  return (
    <ModuleScreen titleKey="adminEventOnsite.nav.devices">
      <OnsiteDevicesPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

export function EventOnsiteBadgesSection({ row }: { row: AdminEventDetailRow }) {
  ensureOnsiteI18n();
  return (
    <ModuleScreen titleKey="adminEventOnsite.nav.badges">
      <OnsiteBadgesPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

export function EventOnsiteLeadsSection({ row }: { row: AdminEventDetailRow }) {
  ensureOnsiteI18n();
  return (
    <ModuleScreen titleKey="adminEventOnsite.nav.leads">
      <OnsiteLeadsPanel key={row.id} eventId={row.id} />
    </ModuleScreen>
  );
}

// ------------------------------ Pozycje z zakladkami (drugi poziom w tresci)

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
