// Organizm: PRZESTRZEŃ ROBOCZA JEDNEJ ŚCIEŻKI programu (układ „studio").
//
// DLACZEGO OSOBNY EKRAN, A NIE WIERSZ NA LIŚCIE. Ścieżka nie jest etykietą, tylko
// pasmem, które się PLANUJE: ma własne zdanie wprowadzające, okładkę, salę
// domyślną, zestaw sesji ułożonych w czasie i obsadę wynikającą z tych sesji.
//
// UKŁAD: nagłówek z powrotem i tytułem, pasek zakładek z podkreśleniem oraz
// treść w dwóch kolumnach - lewa tłumaczy, po co jest sekcja, prawa zawiera
// dane. Każda zakładka to jeden aspekt pasma, dokładnie jak w studiu wydarzeń.
//
// SESJE SĄ ZAKŁADKĄ PASMA, nie odwrotnie. Organizator planuje „co się dzieje w
// tym paśmie", więc lista sesji ścieżki i przypinanie kolejnych stoją tutaj.
//
// OBSADA JEST WYLICZANA, NIE WPISYWANA. Prelegent należy do SESJI; pasmo
// pokazuje sumę tych przypisań (`admin_event_track_speakers`).
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock,
  Copy,
  Building2,
  LayoutList,
  Link2,
  Pencil,
  Search,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AgendaSessionsPanel } from "@/components/admin/events/organisms/AgendaSessionsPanel";
import { EventTrackDialog } from "@/components/admin/events/molecules/EventTrackDialog";
import {
  TrackSessionsLinkDialog,
  type TrackSessionsLinkResult,
} from "@/components/admin/events/molecules/TrackSessionsLinkDialog";
import { adminAgendaErrorMessage } from "@/lib/events/adminAgendaErrors";
import {
  useEventSessions,
  useEventTrackSpeakers,
  useSaveEventTrack,
  useSetSessionsTrack,
} from "@/lib/events/useEventSessions";
import { DEFAULT_SESSIONS_QUERY } from "@/lib/events/sessionsApi";
import { useSponsors } from "@/lib/events/useEventSponsors";
import { useRegistrationsList } from "@/lib/events/useEventRegistrations";
import { DEFAULT_REGISTRATIONS_QUERY } from "@/lib/events/registrationsApi";
import type { EventTrackInput, EventTrackRow } from "@/lib/events/sessionsApi";

interface EventTrackWorkspaceProps {
  eventId: string;
  track: EventTrackRow;
  /** Strefa wydarzenia - sesje pasma planuje się w niej, nie w UTC. */
  timeZoneLabel: string;
  onBack: () => void;
}

/** Godzina bez sekund; strefa czytelnika, bo panel planuje się „u siebie". */
function timeLabel(value: string | null, locale: string): string {
  if (value === null || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

/** Lewa kolumna zakładki - tytuł sekcji i zdanie, po co ona jest. */
function TabAside({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{lead}</p>
      {children}
    </div>
  );
}

/** Pole „tylko do odczytu" w wyglądzie inputa - spójne z formularzami studia. */
function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm">
        {value}
      </div>
    </div>
  );
}

/** Wiersz funkcji na żywo - etykieta, opis i licznik sesji po prawej. */
function FeatureRow({
  label,
  hint,
  count,
}: {
  label: string;
  hint: string;
  count: number;
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{hint}</p>
      </div>
      <Badge variant={count > 0 ? "secondary" : "outline"} className="shrink-0">
        {count}
      </Badge>
    </li>
  );
}

export function EventTrackWorkspace({
  eventId,
  track,
  timeZoneLabel,
  onBack,
}: EventTrackWorkspaceProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language.startsWith("en");
  const locale = isEn ? "en-GB" : "pl-PL";

  const save = useSaveEventTrack(eventId);
  const setTrack = useSetSessionsTrack(eventId);
  const speakersQ = useEventTrackSpeakers(track.id);
  const sessionsQ = useEventSessions({
    ...DEFAULT_SESSIONS_QUERY,
    eventId,
    trackId: track.id,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [exhibitorQuery, setExhibitorQuery] = useState("");
  const [attendeeQuery, setAttendeeQuery] = useState("");

  const sponsorsQ = useSponsors({ eventId, q: exhibitorQuery, limit: 50 });
  const attendeesQ = useRegistrationsList({
    ...DEFAULT_REGISTRATIONS_QUERY,
    eventId,
    q: attendeeQuery,
    limit: 25,
  });

  const name = isEn ? track.name_en || track.name_pl : track.name_pl || track.name_en;
  const tagline = isEn
    ? track.tagline_en || track.tagline_pl
    : track.tagline_pl || track.tagline_en;
  const description = isEn
    ? track.description_en || track.description_pl
    : track.description_pl || track.description_en;

  const sessions = useMemo(() => sessionsQ.data ?? [], [sessionsQ.data]);
  const formatCounts = useMemo(() => {
    const counts = { onsite: 0, online: 0, hybrid: 0 };
    for (const row of sessions) {
      if (row.format === "onsite") counts.onsite += 1;
      else if (row.format === "online") counts.online += 1;
      else if (row.format === "hybrid") counts.hybrid += 1;
    }
    return counts;
  }, [sessions]);
  const featureCounts = useMemo(
    () => ({
      stream: sessions.filter((row) => row.has_stream).length,
      recording: sessions.filter((row) => row.has_recording).length,
      signup: sessions.filter((row) => row.requires_signup).length,
      chatham: sessions.filter((row) => row.chatham_house).length,
    }),
    [sessions],
  );

  const speakers = speakersQ.data ?? [];
  const sponsors = sponsorsQ.data ?? [];
  const attendees = attendeesQ.data?.rows ?? [];

  const fail = (error: unknown) => toast.error(adminAgendaErrorMessage(error));

  const submitEdit = (input: EventTrackInput) => {
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventAgenda.tracks.toasts.saved"));
        setEditOpen(false);
      },
      onError: fail,
    });
  };

  const submitLink = (result: TrackSessionsLinkResult) => {
    const steps: Promise<number>[] = [];
    if (result.attach.length > 0) {
      steps.push(setTrack.mutateAsync({ ids: result.attach, trackId: track.id }));
    }
    if (result.detach.length > 0) {
      steps.push(setTrack.mutateAsync({ ids: result.detach, trackId: null }));
    }
    if (steps.length === 0) {
      toast.message(t("adminEventAgenda.tracks.link.nothing"));
      setLinkOpen(false);
      return;
    }
    void Promise.all(steps)
      .then((counts) => {
        toast.success(
          t("adminEventAgenda.tracks.link.saved", {
            count: counts.reduce((sum, value) => sum + value, 0),
          }),
        );
        setLinkOpen(false);
      })
      .catch(fail);
  };

  const copyId = () => {
    void navigator.clipboard
      ?.writeText(track.id)
      .then(() => toast.success(t("adminEventAgenda.tracks.workspace.preferences.copied")))
      .catch(() => undefined);
  };

  const tabTriggerClass =
    "relative rounded-none border-b-2 border-transparent bg-transparent px-1 pb-3 pt-0 text-sm font-medium text-muted-foreground shadow-none transition-colors data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none";
  const columnsClass = "grid gap-6 pt-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]";

  return (
    <section className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
        {t("adminEventAgenda.tracks.workspace.backAction")}
      </Button>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-4 w-4 shrink-0 rounded-sm border border-border"
              style={{ backgroundColor: track.accent_color }}
            />
            <h2 className="truncate font-display text-2xl">{name}</h2>
            <Badge variant={track.is_public ? "secondary" : "outline"}>
              {t(
                track.is_public
                  ? "adminEventAgenda.tracks.workspace.publicBadge"
                  : "adminEventAgenda.tracks.workspace.hiddenBadge",
              )}
            </Badge>
          </div>
          {tagline === null || tagline === "" ? null : (
            <p className="max-w-2xl text-sm text-muted-foreground">{tagline}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
            <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("adminEventAgenda.tracks.linkAction")}
          </Button>
          <Button size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("adminEventAgenda.tracks.workspace.details.editAction")}
          </Button>
        </div>
      </header>

      <Tabs defaultValue="details">
        <div className="-mx-1 overflow-x-auto border-b border-border/70 px-1">
          <TabsList
            aria-label={t("adminEventAgenda.tracks.workspace.tabsNavLabel")}
            className="h-auto w-max justify-start gap-6 rounded-none border-0 bg-transparent p-0"
          >
            <TabsTrigger value="details" className={tabTriggerClass}>
              {t("adminEventAgenda.tracks.workspace.tabDetails")}
            </TabsTrigger>
            <TabsTrigger value="format" className={tabTriggerClass}>
              {t("adminEventAgenda.tracks.workspace.tabFormat")}
            </TabsTrigger>
            <TabsTrigger value="speakers" className={tabTriggerClass}>
              {`${t("adminEventAgenda.tracks.workspace.tabSpeakers")} (${track.speakers_count})`}
            </TabsTrigger>
            <TabsTrigger value="exhibitors" className={tabTriggerClass}>
              {`${t("adminEventAgenda.tracks.workspace.tabExhibitors")} (${sponsors.length})`}
            </TabsTrigger>
            <TabsTrigger value="attendees" className={tabTriggerClass}>
              {`${t("adminEventAgenda.tracks.workspace.tabAttendees")} (${attendeesQ.data?.total ?? 0})`}
            </TabsTrigger>
            <TabsTrigger value="sessions" className={tabTriggerClass}>
              {`${t("adminEventAgenda.tracks.workspace.tabSessions")} (${track.sessions_count})`}
            </TabsTrigger>
            <TabsTrigger value="documents" className={tabTriggerClass}>
              {t("adminEventAgenda.tracks.workspace.tabDocuments")}
            </TabsTrigger>
            <TabsTrigger value="preferences" className={tabTriggerClass}>
              {t("adminEventAgenda.tracks.workspace.tabPreferences")}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* SZCZEGÓŁY - okładka, nazwa, opis i okno programu w jednym formularzu. */}
        <TabsContent value="details" className={columnsClass}>
          <TabAside
            title={t("adminEventAgenda.tracks.workspace.details.asideTitle")}
            lead={t("adminEventAgenda.tracks.workspace.details.asideLead")}
          >
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("adminEventAgenda.tracks.workspace.details.editAction")}
            </Button>
          </TabAside>

          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t("adminEventAgenda.tracks.workspace.details.cover")}
              </p>
              <div className="flex flex-wrap items-start gap-4">
                {track.cover_url === null || track.cover_url === "" ? (
                  <div className="flex h-24 w-44 items-center justify-center rounded-md border border-dashed border-border/70 text-xs text-muted-foreground">
                    {t("adminEventAgenda.tracks.workspace.details.coverEmpty")}
                  </div>
                ) : (
                  <img
                    src={track.cover_url}
                    alt=""
                    loading="lazy"
                    className="h-24 w-44 rounded-md object-cover"
                  />
                )}
                <p className="max-w-sm text-xs text-muted-foreground">
                  {t("adminEventAgenda.tracks.workspace.details.coverHint")}
                </p>
              </div>
            </div>

            <ReadField
              label={t("adminEventAgenda.tracks.workspace.details.nameField")}
              value={name}
            />
            <ReadField
              label={t("adminEventAgenda.tracks.workspace.details.taglineField")}
              value={
                tagline === null || tagline === ""
                  ? t("adminEventAgenda.tracks.workspace.details.taglineEmpty")
                  : tagline
              }
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <ReadField
                label={t("adminEventAgenda.tracks.workspace.window")}
                value={
                  track.first_starts_at === null
                    ? t("adminEventAgenda.tracks.workspace.windowEmpty")
                    : `${timeLabel(track.first_starts_at, locale)} - ${timeLabel(track.last_ends_at, locale)}`
                }
              />
              <ReadField
                label={t("adminEventAgenda.tracks.workspace.details.room")}
                value={
                  track.default_room_name === null || track.default_room_name === ""
                    ? t("adminEventAgenda.tracks.dialog.defaultRoomNone")
                    : track.default_room_name
                }
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {t("adminEventAgenda.tracks.workspace.details.descriptionField")}
              </p>
              <div className="min-h-24 whitespace-pre-line rounded-md border border-border/70 bg-background px-3 py-2 text-sm">
                {description === null || description === ""
                  ? t("adminEventAgenda.tracks.workspace.details.descriptionEmpty")
                  : description}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricBox
                icon={LayoutList}
                label={t("adminEventAgenda.tracks.workspace.metricSessions")}
                value={String(track.sessions_count)}
              />
              <MetricBox
                icon={CheckCircle2}
                label={t("adminEventAgenda.tracks.workspace.metricPublished")}
                value={`${track.published_count} / ${track.sessions_count}`}
              />
              <MetricBox
                icon={Users}
                label={t("adminEventAgenda.tracks.workspace.metricSpeakers")}
                value={String(track.speakers_count)}
              />
              <MetricBox
                icon={Clock}
                label={t("adminEventAgenda.tracks.workspace.metricMinutes")}
                value={t("adminEventAgenda.tracks.workspace.minutes", {
                  count: track.minutes_total,
                })}
              />
            </div>
          </div>
        </TabsContent>

        {/* FORMAT I WIDEO - podsumowanie sposobu prowadzenia sesji pasma. */}
        <TabsContent value="format" className={columnsClass}>
          <TabAside
            title={t("adminEventAgenda.tracks.workspace.format.asideTitle")}
            lead={t("adminEventAgenda.tracks.workspace.format.asideLead")}
          />
          <AdminCatalogListState
            isLoading={sessionsQ.isLoading}
            loadingLabel={t("adminEventAgenda.tracks.workspace.format.loading")}
            errorMessage={
              sessionsQ.error === null || sessionsQ.error === undefined
                ? null
                : adminAgendaErrorMessage(sessionsQ.error)
            }
            isEmpty={sessions.length === 0}
            emptyLabel={t("adminEventAgenda.tracks.workspace.format.empty")}
          >
            <div className="space-y-4">
              <div className="rounded-md border border-border/70">
                <p className="border-b border-border/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("adminEventAgenda.tracks.workspace.format.breakdownTitle")}
                </p>
                <ul>
                  <FeatureRow
                    label={t("adminEventAgenda.formats.onsite")}
                    hint={t("adminEventAgenda.tracks.workspace.format.sessionsCount", {
                      count: formatCounts.onsite,
                    })}
                    count={formatCounts.onsite}
                  />
                  <FeatureRow
                    label={t("adminEventAgenda.formats.online")}
                    hint={t("adminEventAgenda.tracks.workspace.format.sessionsCount", {
                      count: formatCounts.online,
                    })}
                    count={formatCounts.online}
                  />
                  <FeatureRow
                    label={t("adminEventAgenda.formats.hybrid")}
                    hint={t("adminEventAgenda.tracks.workspace.format.sessionsCount", {
                      count: formatCounts.hybrid,
                    })}
                    count={formatCounts.hybrid}
                  />
                </ul>
              </div>

              <div className="rounded-md border border-border/70">
                <p className="border-b border-border/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("adminEventAgenda.tracks.workspace.format.featuresTitle")}
                </p>
                <ul>
                  <FeatureRow
                    label={t("adminEventAgenda.tracks.workspace.format.stream")}
                    hint={t("adminEventAgenda.tracks.workspace.format.streamHint")}
                    count={featureCounts.stream}
                  />
                  <FeatureRow
                    label={t("adminEventAgenda.tracks.workspace.format.recording")}
                    hint={t("adminEventAgenda.tracks.workspace.format.recordingHint")}
                    count={featureCounts.recording}
                  />
                  <FeatureRow
                    label={t("adminEventAgenda.tracks.workspace.format.signup")}
                    hint={t("adminEventAgenda.tracks.workspace.format.signupHint")}
                    count={featureCounts.signup}
                  />
                  <FeatureRow
                    label={t("adminEventAgenda.tracks.workspace.format.chatham")}
                    hint={t("adminEventAgenda.tracks.workspace.format.chathamHint")}
                    count={featureCounts.chatham}
                  />
                </ul>
              </div>
            </div>
          </AdminCatalogListState>
        </TabsContent>

        {/* PRELEGENCI - obsada wyliczona z sesji pasma. */}
        <TabsContent value="speakers" className={columnsClass}>
          <TabAside
            title={t("adminEventAgenda.tracks.workspace.speakers.asideTitle")}
            lead={t("adminEventAgenda.tracks.workspace.speakers.asideLead")}
          />
          <AdminCatalogListState
            isLoading={speakersQ.isLoading}
            loadingLabel={t("adminEventAgenda.tracks.workspace.speakersLoading")}
            errorMessage={
              speakersQ.error === null || speakersQ.error === undefined
                ? null
                : adminAgendaErrorMessage(speakersQ.error)
            }
            isEmpty={speakers.length === 0}
            emptyLabel={t("adminEventAgenda.tracks.workspace.speakersEmpty")}
          >
            <div className="rounded-md border border-border/70">
              <p className="border-b border-border/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("adminEventAgenda.tracks.workspace.speakers.cardTitle")}
              </p>
              <ul>
                {speakers.map((row) => {
                  const displayName = row.display_name ?? "";
                  return (
                    <li
                      key={row.speaker_profile_id}
                      className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
                    >
                      <Avatar className="h-10 w-10 rounded-md">
                        <AvatarImage src={row.avatar_url ?? undefined} alt="" />
                        <AvatarFallback className="rounded-md text-xs">
                          {initialsOf(displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{displayName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.job_title ?? ""}
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        <Users className="mr-1 h-3 w-3" aria-hidden="true" />
                        {row.sessions_count}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          </AdminCatalogListState>
        </TabsContent>

        {/* WYSTAWCY - partnerzy wydarzenia z wyszukiwarką jak w studiu. */}
        <TabsContent value="exhibitors" className={columnsClass}>
          <TabAside
            title={t("adminEventAgenda.tracks.workspace.exhibitors.asideTitle")}
            lead={t("adminEventAgenda.tracks.workspace.exhibitors.asideLead")}
          />
          <div className="space-y-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={exhibitorQuery}
                onChange={(event) => setExhibitorQuery(event.target.value)}
                placeholder={t(
                  "adminEventAgenda.tracks.workspace.exhibitors.searchPlaceholder",
                )}
                aria-label={t(
                  "adminEventAgenda.tracks.workspace.exhibitors.searchPlaceholder",
                )}
                className="pl-9"
              />
            </div>
            <AdminCatalogListState
              isLoading={sponsorsQ.isLoading}
              loadingLabel={t("adminEventAgenda.tracks.workspace.exhibitors.loading")}
              errorMessage={
                sponsorsQ.error === null || sponsorsQ.error === undefined
                  ? null
                  : adminAgendaErrorMessage(sponsorsQ.error)
              }
              isEmpty={sponsors.length === 0}
              emptyLabel={t("adminEventAgenda.tracks.workspace.exhibitors.empty")}
            >
              <ul className="rounded-md border border-border/70">
                {sponsors.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
                  >
                    {row.snapshot_logo_url === null || row.snapshot_logo_url === "" ? (
                      <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border/70">
                        <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </span>
                    ) : (
                      <img
                        src={row.snapshot_logo_url}
                        alt=""
                        loading="lazy"
                        className="h-10 w-10 rounded-md object-contain"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{row.snapshot_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {isEn ? row.tier_name_en : row.tier_name_pl}
                      </p>
                    </div>
                    <Badge variant={row.is_published ? "secondary" : "outline"}>
                      {t(
                        row.is_published
                          ? "adminEventAgenda.tracks.workspace.exhibitors.publishedBadge"
                          : "adminEventAgenda.tracks.workspace.exhibitors.hiddenBadge",
                      )}
                    </Badge>
                  </li>
                ))}
              </ul>
            </AdminCatalogListState>
          </div>
        </TabsContent>

        {/* UCZESTNICY - tabela zgłoszeń wydarzenia. */}
        <TabsContent value="attendees" className={columnsClass}>
          <TabAside
            title={t("adminEventAgenda.tracks.workspace.attendees.asideTitle")}
            lead={t("adminEventAgenda.tracks.workspace.attendees.asideLead")}
          />
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {t("adminEventAgenda.tracks.workspace.attendees.total", {
                  count: attendeesQ.data?.total ?? 0,
                })}
              </p>
              <div className="relative w-full sm:w-72">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={attendeeQuery}
                  onChange={(event) => setAttendeeQuery(event.target.value)}
                  placeholder={t(
                    "adminEventAgenda.tracks.workspace.attendees.searchPlaceholder",
                  )}
                  aria-label={t(
                    "adminEventAgenda.tracks.workspace.attendees.searchPlaceholder",
                  )}
                  className="pl-9"
                />
              </div>
            </div>
            <AdminCatalogListState
              isLoading={attendeesQ.isLoading}
              loadingLabel={t("adminEventAgenda.tracks.workspace.attendees.loading")}
              errorMessage={
                attendeesQ.error === null || attendeesQ.error === undefined
                  ? null
                  : adminAgendaErrorMessage(attendeesQ.error)
              }
              isEmpty={attendees.length === 0}
              emptyLabel={t("adminEventAgenda.tracks.workspace.attendees.empty")}
            >
              <div className="overflow-x-auto rounded-md border border-border/70">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">
                        {t("adminEventAgenda.tracks.workspace.attendees.colEmail")}
                      </th>
                      <th className="px-4 py-2.5 font-medium">
                        {t("adminEventAgenda.tracks.workspace.attendees.colName")}
                      </th>
                      <th className="px-4 py-2.5 font-medium">
                        {t("adminEventAgenda.tracks.workspace.attendees.colJob")}
                      </th>
                      <th className="px-4 py-2.5 font-medium">
                        {t("adminEventAgenda.tracks.workspace.attendees.colCompany")}
                      </th>
                      <th className="px-4 py-2.5 font-medium">
                        {t("adminEventAgenda.tracks.workspace.attendees.colRegistered")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendees.map((row) => (
                      <tr key={row.id} className="border-b border-border/60 last:border-b-0">
                        <td className="px-4 py-2.5">{row.email}</td>
                        <td className="px-4 py-2.5">
                          {`${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {row.job_title ?? ""}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {row.company_name ?? row.company_text ?? ""}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {timeLabel(row.created_at, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminCatalogListState>
          </div>
        </TabsContent>

        {/* SESJE - pełny warsztat programu zawężony do pasma. */}
        <TabsContent value="sessions" className={columnsClass}>
          <TabAside
            title={t("adminEventAgenda.tracks.workspace.sessions.asideTitle")}
            lead={t("adminEventAgenda.tracks.workspace.sessions.asideLead")}
          >
            <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
              <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("adminEventAgenda.tracks.linkAction")}
            </Button>
          </TabAside>
          <AgendaSessionsPanel
            eventId={eventId}
            timeZoneLabel={timeZoneLabel}
            lockedTrackId={track.id}
            embedded
          />
        </TabsContent>

        {/* DOKUMENTY I LINKI - materiały pasma pochodzą z sesji. */}
        <TabsContent value="documents" className={columnsClass}>
          <TabAside
            title={t("adminEventAgenda.tracks.workspace.documents.asideTitle")}
            lead={t("adminEventAgenda.tracks.workspace.documents.asideLead")}
          />
          <div className="space-y-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                disabled
                placeholder={t(
                  "adminEventAgenda.tracks.workspace.documents.searchPlaceholder",
                )}
                aria-label={t(
                  "adminEventAgenda.tracks.workspace.documents.searchPlaceholder",
                )}
                className="pl-9"
              />
            </div>
            <p className="rounded-md border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
              {t("adminEventAgenda.tracks.workspace.documents.empty")}
            </p>
          </div>
        </TabsContent>

        {/* PREFERENCJE - widoczność pasma i identyfikatory. */}
        <TabsContent value="preferences" className={columnsClass}>
          <TabAside
            title={t("adminEventAgenda.tracks.workspace.preferences.asideTitle")}
            lead={t("adminEventAgenda.tracks.workspace.preferences.asideLead")}
          />
          <div className="space-y-4">
            <ul className="rounded-md border border-border/70">
              <FeatureRow
                label={t("adminEventAgenda.tracks.workspace.preferences.visibility")}
                hint={t("adminEventAgenda.tracks.workspace.preferences.visibilityHint")}
                count={track.is_public ? 1 : 0}
              />
              <FeatureRow
                label={t("adminEventAgenda.tracks.workspace.preferences.active")}
                hint={t("adminEventAgenda.tracks.workspace.preferences.activeHint")}
                count={track.is_active ? 1 : 0}
              />
            </ul>
            <div className="grid gap-4 sm:grid-cols-2">
              <ReadField
                label={t("adminEventAgenda.tracks.workspace.details.keyField")}
                value={track.key}
              />
              <ReadField
                label={t("adminEventAgenda.tracks.workspace.preferences.order")}
                value={String(track.sort_order)}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {t("adminEventAgenda.tracks.workspace.preferences.internalId")}
              </p>
              <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-sm">{track.id}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={copyId}
                  aria-label={t("adminEventAgenda.tracks.workspace.preferences.copyAction")}
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <EventTrackDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        eventId={eventId}
        track={track}
        nextSortOrder={track.sort_order}
        isSaving={save.isPending}
        onSubmit={submitEdit}
      />

      <TrackSessionsLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        eventId={eventId}
        track={track}
        isSaving={setTrack.isPending}
        onSubmit={submitLink}
      />
    </section>
  );
}

/** Kafelek metryki pasma - ten sam rytm co reszta studia, ale lokalny. */
function MetricBox({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border/70 p-3">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>
    </div>
  );
}
