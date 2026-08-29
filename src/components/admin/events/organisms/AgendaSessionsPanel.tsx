// Organizm: lista sesji programu z filtrami, publikacją i kolejnością.
//
// FILTRY IDĄ DO BAZY, nie do tablicy w przeglądarce - RPC listy przyjmuje frazę,
// ścieżkę, salę i stan, a lista wydarzenia potrafi liczyć setki sesji.
//
// PUBLIKACJA JEST OPERACJĄ ZBIORCZĄ w bazie (`sessions_status`), więc jeden
// przycisk w wierszu wysyła jednoelementową listę - zamiast drugiego RPC, który
// robiłby to samo dla jednej sesji.
//
// USUNIĘCIE SESJI Z ZAPISAMI JEST ODMAWIANE (`session_has_signups`). Dlatego
// obok kasowania stoi „Odwołaj sesję" - to jest właściwa operacja dla sesji,
// na którą ktoś już przyszedł.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarX2, Pencil, Plus, Trash2, Upload, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { EventSessionDialog } from "@/components/admin/events/molecules/EventSessionDialog";
import { AgendaStructureDiagram } from "@/components/admin/events/molecules/AgendaStructureDiagram";
import { adminAgendaErrorMessage } from "@/lib/events/adminAgendaErrors";
import {
  SESSION_STATUSES,
  type EventSessionInput,
  type EventSessionRow,
  type SessionStatusFilter,
} from "@/lib/events/sessionsApi";
import {
  useDeleteEventSession,
  useEventRooms,
  useEventSessions,
  useEventTracks,
  useSaveEventSession,
  useSetSessionsStatus,
} from "@/lib/events/useEventSessions";

const ALL = "all";

interface AgendaSessionsPanelProps {
  eventId: string;
  /** Etykieta strefy wydarzenia - godziny wpisuje się w niej, nie w UTC. */
  timeZoneLabel: string;
  /**
   * Ścieżka, w której planujemy. Ustawiona = panel jest ZAKŁADKĄ PASMA: lista
   * pokazuje wyłącznie sesje tej ścieżki, filtr ścieżki znika (nie ma czego
   * wybierać), a nowa sesja rodzi się już przypięta do pasma.
   */
  lockedTrackId?: string | null;
  /** W zakładce pasma nagłówek i diagram stoją wyżej - nie powielamy ich. */
  embedded?: boolean;
}

export function AgendaSessionsPanel({
  eventId,
  timeZoneLabel,
  lockedTrackId = null,
  embedded = false,
}: AgendaSessionsPanelProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language.startsWith("en");

  const [search, setSearch] = useState("");
  const [trackId, setTrackId] = useState<string>(lockedTrackId ?? ALL);
  const [roomId, setRoomId] = useState<string>(ALL);
  const [status, setStatus] = useState<SessionStatusFilter>("all");

  const tracksQ = useEventTracks(eventId);
  const roomsQ = useEventRooms(eventId);
  const listQ = useEventSessions({
    eventId,
    q: search,
    trackId: lockedTrackId ?? (trackId === ALL ? null : trackId),
    roomId: roomId === ALL ? null : roomId,
    status,
  });

  const save = useSaveEventSession(eventId);
  const remove = useDeleteEventSession(eventId);
  const setStatuses = useSetSessionsStatus(eventId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [edited, setEdited] = useState<EventSessionRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EventSessionRow | null>(null);

  const tracks = tracksQ.data ?? [];
  const rooms = roomsQ.data ?? [];
  const rows = listQ.data ?? [];
  const hasFilters =
    search.trim() !== "" ||
    (lockedTrackId === null && trackId !== ALL) ||
    roomId !== ALL ||
    status !== "all";

  const nextSortOrder = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.sort_order), 0) + 10,
    [rows],
  );

  const fail = (error: unknown) => toast.error(adminAgendaErrorMessage(error));

  const submit = (input: EventSessionInput) => {
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventAgenda.sessions.toasts.saved"));
        setDialogOpen(false);
        setEdited(null);
      },
      onError: fail,
    });
  };

  const changeStatus = (row: EventSessionRow, next: "draft" | "published" | "cancelled") => {
    setStatuses.mutate(
      { ids: [row.id], status: next },
      {
        onSuccess: (count) => {
          toast.success(t("adminEventAgenda.sessions.toasts.statusChanged", { count }));
        },
        onError: fail,
      },
    );
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t("adminEventAgenda.sessions.toasts.deleted"));
        setPendingDelete(null);
      },
      onError: (error) => {
        fail(error);
        setPendingDelete(null);
      },
    });
  };

  const titleOf = (row: EventSessionRow): string =>
    isEn ? row.title_en || row.title_pl : row.title_pl || row.title_en;

  const trackOptions: readonly string[] = [ALL, ...tracks.map((row) => row.id)];
  const roomOptions: readonly string[] = [ALL, ...rooms.map((row) => row.id)];
  const statusOptions: readonly SessionStatusFilter[] = ["all", ...SESSION_STATUSES];

  const timeLabel = (row: EventSessionRow): string => {
    try {
      // FORMATER POWSTAJE W ŚRODKU `try` - I TO JEST CAŁA RÓŻNICA. Nieznaną
      // strefę odrzuca KONSTRUKTOR (`RangeError: Invalid time zone specified`),
      // więc dopóki stał przed `try`, ta gałąź łapała wyłącznie niesparsowalną
      // datę - czyli dokładnie nie ten przypadek, który opisuje. Wyjątek
      // z konstruktora leciał do renderu i wygaszał CAŁĄ zakładkę „Program":
      // pusty ekran w miejscu listy sesji, bez komunikatu.
      //
      // Że to nie jest hipoteza, mówi sama nazwa propa: `timeZoneLabel`, nie
      // `timeZone`. `eventTimeZoneLabel()` z tego modułu zwraca ETYKIETĘ
      // (`GMT+2`) albo pusty łańcuch, a nie identyfikator IANA. Dziś wszystkie
      // trzy ścieżki wywołania podają wartość odkażoną, więc defekt jest
      // utajony - ale trzyma go wyłącznie dyscyplina wywołujących.
      const formatter = new Intl.DateTimeFormat(isEn ? "en-GB" : "pl-PL", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timeZoneLabel,
      });
      return formatter.format(new Date(row.starts_at));
    } catch {
      // Nieznana strefa degraduje POJEDYNCZY wiersz, nie całą listę.
      return new Date(row.starts_at).toLocaleString(isEn ? "en-GB" : "pl-PL");
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        {embedded ? (
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("adminEventAgenda.tracks.workspace.sessionsLead")}
          </p>
        ) : (
          <div className="space-y-1">
            <h2 className="font-display text-lg">{t("adminEventAgenda.sessions.title")}</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("adminEventAgenda.sessions.subtitle")}
            </p>
          </div>
        )}
        <Button
          onClick={() => {
            setEdited(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminEventAgenda.sessions.addAction")}
        </Button>
      </header>

      {embedded ? null : (
        <AgendaStructureDiagram
          tracks={tracks.map((row) => ({
            id: row.id,
            name: isEn ? row.name_en || row.name_pl : row.name_pl || row.name_en,
            accentColor: row.accent_color,
            sessionsCount: row.sessions_count,
          }))}
          unassignedCount={rows.filter((row) => row.track_id === "").length}
          highlight="sessions"
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("adminEventAgenda.sessions.searchPlaceholder")}
          aria-label={t("adminEventAgenda.sessions.searchPlaceholder")}
        />
        {lockedTrackId === null ? (
          <AdminFormEnumRow
            label={t("adminEventAgenda.nav.tracks")}
            value={trackId}
            options={trackOptions}
            labelFor={(value) =>
              value === ALL
                ? t("adminEventAgenda.sessions.allTracks")
                : (() => {
                    const found = tracks.find((row) => row.id === value);
                    if (found === undefined) return value;
                    return isEn ? found.name_en || found.name_pl : found.name_pl || found.name_en;
                  })()
            }
            onValueChange={setTrackId}
          />
        ) : null}
        <AdminFormEnumRow
          label={t("adminEventAgenda.nav.rooms")}
          value={roomId}
          options={roomOptions}
          labelFor={(value) =>
            value === ALL
              ? t("adminEventAgenda.sessions.allRooms")
              : (rooms.find((row) => row.id === value)?.name ?? value)
          }
          onValueChange={setRoomId}
        />
        <AdminFormEnumRow
          label={t("adminEventAgenda.sessionDialog.status")}
          value={status}
          options={statusOptions}
          labelFor={(value) =>
            value === "all"
              ? t("adminEventAgenda.sessions.allStatuses")
              : t(`adminEventAgenda.statuses.${value}`)
          }
          onValueChange={setStatus}
        />
      </div>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventAgenda.sessions.loading")}
        errorMessage={
          listQ.error === null || listQ.error === undefined
            ? null
            : adminAgendaErrorMessage(listQ.error)
        }
        isEmpty={rows.length === 0}
        emptyLabel={t(
          hasFilters
            ? "adminEventAgenda.sessions.emptyFiltered"
            : lockedTrackId === null
              ? "adminEventAgenda.sessions.empty"
              : "adminEventAgenda.tracks.workspace.sessionsEmpty",
        )}
      >
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-md border border-border/70 p-3">
              <div className="flex flex-wrap items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1 h-4 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: row.track_accent_color || "transparent" }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{titleOf(row)}</p>
                  <p className="text-xs text-muted-foreground">
                    {timeLabel(row)} · {row.duration_minutes} min ·{" "}
                    {row.room_name === "" ? t("adminEventAgenda.sessions.noRoom") : row.room_name}
                  </p>
                </div>
                <Badge variant={row.status === "published" ? "default" : "secondary"}>
                  {t(`adminEventAgenda.statuses.${row.status}`)}
                </Badge>
                <Badge variant="outline">{t(`adminEventAgenda.formats.${row.format}`)}</Badge>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {row.requires_signup
                    ? row.capacity > 0
                      ? t("adminEventAgenda.sessions.seats", {
                          left: row.seats_left,
                          capacity: row.capacity,
                        })
                      : t("adminEventAgenda.sessions.seatsUnlimited")
                    : t("adminEventAgenda.sessions.signupsOff")}
                </span>
                <span>
                  {t("adminEventAgenda.sessions.speakersCount", { count: row.speakers_count })}
                </span>
                {row.children_count > 0 ? (
                  <span>
                    {t("adminEventAgenda.sessions.childrenCount", { count: row.children_count })}
                  </span>
                ) : null}
                {row.chatham_house ? (
                  <Badge variant="outline">{t("adminEventAgenda.sessions.chathamHouse")}</Badge>
                ) : null}
                {row.is_private ? (
                  <Badge variant="outline">{t("adminEventAgenda.sessions.isPrivate")}</Badge>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {row.status === "published" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => changeStatus(row, "draft")}
                    disabled={setStatuses.isPending}
                  >
                    <Undo2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t("adminEventAgenda.sessions.unpublishAction")}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => changeStatus(row, "published")}
                    disabled={setStatuses.isPending}
                  >
                    <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t("adminEventAgenda.sessions.publishAction")}
                  </Button>
                )}
                {row.status === "cancelled" ? null : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => changeStatus(row, "cancelled")}
                    disabled={setStatuses.isPending}
                  >
                    <CalendarX2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t("adminEventAgenda.sessions.cancelAction")}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEdited(row);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("adminEventAgenda.sessionDialog.editTitle")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("adminEventAgenda.sessions.deleteConfirm")}
                  onClick={() => setPendingDelete(row)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </AdminCatalogListState>

      <EventSessionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        session={edited}
        tracks={tracks}
        rooms={rooms}
        sessions={rows}
        timeZoneLabel={timeZoneLabel}
        nextSortOrder={nextSortOrder}
        defaultTrackId={lockedTrackId}
        isSaving={save.isPending}
        onSubmit={submit}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminEventAgenda.sessions.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventAgenda.sessions.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("adminEventAgenda.sessionDialog.cancelAction")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("adminEventAgenda.sessionDialog.saveAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
