// Organizm: ścieżki programu jednego wydarzenia.
//
// WYŁĄCZENIE PRZED USUNIĘCIEM. Baza odmawia skasowania ścieżki używanej przez
// sesje (`track_in_use`), bo publiczna agenda straciłaby pasmo. Dlatego
// przełącznik „aktywna" stoi w wierszu, a kasowanie jest za potwierdzeniem,
// które mówi wprost, kiedy zadziała.
//
// LICZBĘ SESJI POKAZUJEMY OBOK NAZWY, bo bez niej organizator nie wie, czy
// usunięcie ma szansę się udać - i czyta odmowę jako awarię.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowRight, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { EventTrackDialog } from "@/components/admin/events/molecules/EventTrackDialog";
import { AgendaStructureDiagram } from "@/components/admin/events/molecules/AgendaStructureDiagram";
import { EventTrackWorkspace } from "@/components/admin/events/organisms/EventTrackWorkspace";
import {
  TrackSessionsLinkDialog,
  type TrackSessionsLinkResult,
} from "@/components/admin/events/molecules/TrackSessionsLinkDialog";
import { adminAgendaErrorMessage } from "@/lib/events/adminAgendaErrors";
import { trackDraftFromRow, trackDraftToInput } from "@/lib/events/agendaCatalogDraft";
import {
  useDeleteEventTrack,
  useEventSessions,
  useEventTracks,
  useSaveEventTrack,
  useSetSessionsTrack,
} from "@/lib/events/useEventSessions";
import type { EventTrackInput, EventTrackRow } from "@/lib/events/sessionsApi";

interface AgendaTracksPanelProps {
  eventId: string;
  /** Strefa wydarzenia - przechodzi do zakładki sesji otwartego pasma. */
  timeZoneLabel: string;
}

export function AgendaTracksPanel({ eventId, timeZoneLabel }: AgendaTracksPanelProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language.startsWith("en");
  const listQ = useEventTracks(eventId);
  const save = useSaveEventTrack(eventId);
  const remove = useDeleteEventTrack(eventId);
  const setTrack = useSetSessionsTrack(eventId);
  // Diagram i licznik „bez ścieżki" czytają program, nie same ścieżki.
  const sessionsQ = useEventSessions({
    eventId,
    q: "",
    trackId: null,
    roomId: null,
    status: "all",
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [edited, setEdited] = useState<EventTrackRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EventTrackRow | null>(null);
  const [linked, setLinked] = useState<EventTrackRow | null>(null);
  // Otwarta ścieżka jest trzymana po IDENTYFIKATORZE, nie po wierszu: po zapisie
  // lista wraca ze świeżymi danymi i przestrzeń robocza ma pokazać nowe, a nie
  // zamrożoną kopię sprzed edycji.
  const [openedId, setOpenedId] = useState<string | null>(null);

  const rows = listQ.data ?? [];
  const nextSortOrder = rows.reduce((max, row) => Math.max(max, row.sort_order), 0) + 10;

  const fail = (error: unknown) => toast.error(adminAgendaErrorMessage(error));

  const submit = (input: EventTrackInput) => {
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventAgenda.tracks.toasts.saved"));
        setDialogOpen(false);
        setEdited(null);
      },
      onError: fail,
    });
  };

  /** Przełącznik w wierszu wysyła CAŁY wiersz - RPC zapisu jest upsertem. */
  const toggleActive = (row: EventTrackRow, next: boolean) => {
    save.mutate(
      { ...trackDraftToInput(trackDraftFromRow(row), eventId), isActive: next },
      { onError: fail },
    );
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t("adminEventAgenda.tracks.toasts.deleted"));
        setPendingDelete(null);
      },
      onError: (error) => {
        fail(error);
        setPendingDelete(null);
      },
    });
  };

  /**
   * Dwie intencje = dwa wywołania: baza rozróżnia „przypnij do ścieżki" od
   * „odepnij" (`track_id = null`), więc odpięcie idzie osobno.
   */
  const submitLink = (result: TrackSessionsLinkResult) => {
    if (linked === null) return;
    const steps: Promise<number>[] = [];
    if (result.attach.length > 0) {
      steps.push(setTrack.mutateAsync({ ids: result.attach, trackId: linked.id }));
    }
    if (result.detach.length > 0) {
      steps.push(setTrack.mutateAsync({ ids: result.detach, trackId: null }));
    }
    if (steps.length === 0) {
      toast.message(t("adminEventAgenda.tracks.link.nothing"));
      setLinked(null);
      return;
    }
    void Promise.all(steps)
      .then((counts) => {
        toast.success(
          t("adminEventAgenda.tracks.link.saved", {
            count: counts.reduce((sum, value) => sum + value, 0),
          }),
        );
        setLinked(null);
      })
      .catch(fail);
  };

  const opened = rows.find((row) => row.id === openedId) ?? null;

  const nameOf = (row: EventTrackRow): string =>
    isEn ? row.name_en || row.name_pl : row.name_pl || row.name_en;

  if (opened !== null) {
    return (
      <EventTrackWorkspace
        eventId={eventId}
        track={opened}
        timeZoneLabel={timeZoneLabel}
        onBack={() => setOpenedId(null)}
      />
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-lg">{t("adminEventAgenda.tracks.title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("adminEventAgenda.tracks.subtitle")}
          </p>
        </div>
        <Button
          onClick={() => {
            setEdited(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminEventAgenda.tracks.addAction")}
        </Button>
      </header>

      <AgendaStructureDiagram
        tracks={rows.map((row) => ({
          id: row.id,
          name: nameOf(row),
          accentColor: row.accent_color,
          sessionsCount: row.sessions_count,
        }))}
        unassignedCount={(sessionsQ.data ?? []).filter((row) => row.track_id === "").length}
        highlight="tracks"
      />

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventAgenda.tracks.loading")}
        errorMessage={
          listQ.error === null || listQ.error === undefined
            ? null
            : adminAgendaErrorMessage(listQ.error)
        }
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventAgenda.tracks.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 p-3"
            >
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 rounded-sm border border-border"
                style={{ backgroundColor: row.accent_color }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{nameOf(row)}</p>
                <p className="truncate font-medium tracking-tight text-xs text-muted-foreground">
                  {row.key}
                </p>
              </div>
              <Badge variant="secondary">
                {t("adminEventAgenda.tracks.sessionsCount", { count: row.sessions_count })}
              </Badge>
              <AdminFormSwitchRow
                label={t("adminEventAgenda.tracks.dialog.isActive")}
                checked={row.is_active}
                onCheckedChange={(next) => toggleActive(row, next)}
                className="w-auto"
              />
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setOpenedId(row.id)}>
                  <ArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("adminEventAgenda.tracks.openAction")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setLinked(row)}>
                  <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("adminEventAgenda.tracks.linkAction")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("adminEventAgenda.tracks.dialog.editTitle")}
                  onClick={() => {
                    setEdited(row);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("adminEventAgenda.tracks.deleteConfirm")}
                  onClick={() => setPendingDelete(row)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </AdminCatalogListState>

      <EventTrackDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        track={edited}
        nextSortOrder={nextSortOrder}
        isSaving={save.isPending}
        onSubmit={submit}
      />

      <TrackSessionsLinkDialog
        open={linked !== null}
        onOpenChange={(open) => {
          if (!open) setLinked(null);
        }}
        eventId={eventId}
        track={linked}
        isSaving={setTrack.isPending}
        onSubmit={submitLink}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminEventAgenda.tracks.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventAgenda.tracks.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("adminEventAgenda.tracks.dialog.cancelAction")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("adminEventAgenda.tracks.dialog.saveAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
