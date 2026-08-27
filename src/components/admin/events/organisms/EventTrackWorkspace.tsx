// Organizm: PRZESTRZEŃ ROBOCZA JEDNEJ ŚCIEŻKI programu.
//
// DLACZEGO OSOBNY EKRAN, A NIE WIERSZ NA LIŚCIE. Ścieżka nie jest etykietą, tylko
// pasmem, które się PLANUJE: ma własne zdanie wprowadzające, okładkę, salę
// domyślną, zestaw sesji ułożonych w czasie i obsadę wynikającą z tych sesji.
// Wiersz listy potrafi pokazać nazwę i kolor - nie potrafi pokazać programu.
//
// SESJE SĄ ZAKŁADKĄ PASMA, nie odwrotnie. Organizator planuje „co się dzieje w
// tym paśmie", więc lista sesji ścieżki i przypinanie kolejnych stoją tutaj, a
// nie na globalnym ekranie sesji, gdzie giną wśród całego programu.
//
// OBSADA JEST WYLICZANA, NIE WPISYWANA. Prelegent należy do SESJI; pasmo
// pokazuje sumę tych przypisań (`admin_event_track_speakers`). Osobna lista
// prelegentów ścieżki rozjeżdżałaby się z agendą po pierwszej zmianie obsady.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock,
  LayoutList,
  Link2,
  Pencil,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AgendaSessionsPanel } from "@/components/admin/events/organisms/AgendaSessionsPanel";
import { AdminMetricTile } from "@/components/admin/molecules/AdminMetricTile";
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
    eventId,
    q: "",
    trackId: track.id,
    roomId: null,
    status: "all",
  });

  const [editOpen, setEditOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const name = isEn ? track.name_en || track.name_pl : track.name_pl || track.name_en;
  const tagline = isEn
    ? track.tagline_en || track.tagline_pl
    : track.tagline_pl || track.tagline_en;
  const description = isEn
    ? track.description_en || track.description_pl
    : track.description_pl || track.description_en;

  const sessions = useMemo(
    () =>
      [...(sessionsQ.data ?? [])].sort((a, b) =>
        String(a.starts_at).localeCompare(String(b.starts_at)),
      ),
    [sessionsQ.data],
  );

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

  return (
    <section className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
        {t("adminEventAgenda.tracks.workspace.backAction")}
      </Button>

      <header className="overflow-hidden rounded-md border border-border/70">
        {track.cover_url === null || track.cover_url === "" ? null : (
          <img src={track.cover_url} alt="" className="h-40 w-full object-cover" loading="lazy" />
        )}
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 rounded-sm border border-border"
                style={{ backgroundColor: track.accent_color }}
              />
              <h2 className="truncate font-display text-lg">{name}</h2>
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
              {t("adminEventAgenda.tracks.dialog.editTitle")}
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AdminMetricTile
          icon={LayoutList}
          label={t("adminEventAgenda.tracks.workspace.metricSessions")}
          value={String(track.sessions_count)}
        />
        <AdminMetricTile
          icon={CheckCircle2}
          label={t("adminEventAgenda.tracks.workspace.metricPublished")}
          value={`${track.published_count} / ${track.sessions_count}`}
        />
        <AdminMetricTile
          icon={Users}
          label={t("adminEventAgenda.tracks.workspace.metricSpeakers")}
          value={String(track.speakers_count)}
        />
        <AdminMetricTile
          icon={Clock}
          label={t("adminEventAgenda.tracks.workspace.metricMinutes")}
          value={t("adminEventAgenda.tracks.workspace.minutes", {
            count: track.minutes_total,
          })}
        />
      </div>

      <Tabs defaultValue="sessions">
        <TabsList>
          <TabsTrigger value="sessions">
            {t("adminEventAgenda.tracks.workspace.tabSessions")}
          </TabsTrigger>
          <TabsTrigger value="speakers">
            {t("adminEventAgenda.tracks.workspace.tabSpeakers")}
          </TabsTrigger>
          <TabsTrigger value="details">
            {t("adminEventAgenda.tracks.workspace.tabDetails")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="pt-4">
          {/*
            SESJA JEST ZAKŁADKĄ PASMA. Cały warsztat programu - dodawanie,
            edycja, publikacja, odwołanie i kasowanie - stoi tutaj, zawężony do
            tej ścieżki, żeby planować pasmo, a nie przeszukiwać cały program.
          */}
          <AgendaSessionsPanel
            eventId={eventId}
            timeZoneLabel={timeZoneLabel}
            lockedTrackId={track.id}
            embedded
          />
        </TabsContent>

        <TabsContent value="speakers" className="pt-4">
          <AdminCatalogListState
            isLoading={speakersQ.isLoading}
            loadingLabel={t("adminEventAgenda.tracks.workspace.speakersLoading")}
            errorMessage={
              speakersQ.error === null || speakersQ.error === undefined
                ? null
                : adminAgendaErrorMessage(speakersQ.error)
            }
            isEmpty={(speakersQ.data ?? []).length === 0}
            emptyLabel={t("adminEventAgenda.tracks.workspace.speakersEmpty")}
          >
            <ul className="grid gap-2 sm:grid-cols-2">
              {(speakersQ.data ?? []).map((row) => {
                const displayName = row.display_name ?? "";
                return (
                  <li
                    key={row.speaker_profile_id}
                    className="flex items-center gap-3 rounded-md border border-border/70 p-3"
                  >
                    <Avatar className="h-9 w-9 rounded-md">
                      <AvatarImage src={row.avatar_url ?? undefined} alt="" />
                      <AvatarFallback className="rounded-md text-xs">
                        {initialsOf(displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{displayName}</p>
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
          </AdminCatalogListState>
        </TabsContent>

        <TabsContent value="details" className="space-y-3 pt-4 text-sm">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("adminEventAgenda.tracks.dialog.key")}
              </dt>
              <dd className="font-medium tracking-tight">{track.key}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("adminEventAgenda.tracks.dialog.defaultRoom")}
              </dt>
              <dd>
                {track.default_room_name === null || track.default_room_name === ""
                  ? t("adminEventAgenda.tracks.dialog.defaultRoomNone")
                  : track.default_room_name}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("adminEventAgenda.tracks.workspace.window")}
              </dt>
              <dd>
                {track.first_starts_at === null
                  ? t("adminEventAgenda.tracks.workspace.windowEmpty")
                  : `${timeLabel(track.first_starts_at, locale)} - ${timeLabel(track.last_ends_at, locale)}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("adminEventAgenda.tracks.dialog.isActive")}
              </dt>
              <dd>
                {t(
                  track.is_active
                    ? "adminEventAgenda.tracks.workspace.yes"
                    : "adminEventAgenda.tracks.workspace.no",
                )}
              </dd>
            </div>
          </dl>
          {description === null || description === "" ? null : (
            <p className="max-w-3xl whitespace-pre-line text-muted-foreground">{description}</p>
          )}
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
