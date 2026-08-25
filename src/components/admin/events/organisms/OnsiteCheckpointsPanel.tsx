// Organizm: punkty kontrolne wydarzenia.
//
// ZAJĘTOŚĆ OBOK POJEMNOŚCI, ODMOWY OBOK WPUSZCZEŃ. Punkt bez ani jednej odprawy
// wolno skasować; punkt z odprawami to odmowa `checkpoint_in_use`. Pokazanie
// liczb w wierszu zamienia odmowę bazy w decyzję podjętą przed kliknięciem.
//
// TRYB KONTROLI JEST ODZNACZONY OSOBNO. `track` liczy wejścia i nie odmawia -
// organizator musi widzieć to z listy, bo to jedyna różnica między punktem, który
// pilnuje wstępu, a punktem, który tylko zbiera statystykę.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import {
  EventCheckpointDialog,
  type CheckpointRelationOption,
} from "@/components/admin/events/molecules/EventCheckpointDialog";
import { adminOnsiteErrorMessage } from "@/lib/events/adminOnsiteErrors";
import { checkpointDraftFromRow, checkpointDraftToInput } from "@/lib/events/onsiteDraft";
import {
  useCheckpoints,
  useDeleteCheckpoint,
  useSaveCheckpoint,
} from "@/lib/events/useEventOnsite";
import { useEventRooms, useEventSessions } from "@/lib/events/useEventSessions";
import { useSponsors } from "@/lib/events/useEventSponsors";
import { DEFAULT_SESSIONS_QUERY } from "@/lib/events/sessionsApi";
import { uiLang } from "@/lib/i18n/format";
import type { CheckpointInput, EventCheckpointRow } from "@/lib/events/onsiteApi";

export function OnsiteCheckpointsPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const listQ = useCheckpoints(eventId);
  const sessionsQ = useEventSessions({ ...DEFAULT_SESSIONS_QUERY, eventId });
  const roomsQ = useEventRooms(eventId);
  const sponsorsQ = useSponsors({ eventId, limit: 200 });
  const save = useSaveCheckpoint(eventId);
  const remove = useDeleteCheckpoint(eventId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [edited, setEdited] = useState<EventCheckpointRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EventCheckpointRow | null>(null);

  const rows = listQ.data ?? [];

  const sessions: CheckpointRelationOption[] = useMemo(
    () =>
      (sessionsQ.data ?? []).map((row) => ({
        id: row.id,
        label: lang === "en" ? row.title_en || row.title_pl : row.title_pl || row.title_en,
      })),
    [sessionsQ.data, lang],
  );
  const rooms: CheckpointRelationOption[] = useMemo(
    () => (roomsQ.data ?? []).map((row) => ({ id: row.id, label: row.name })),
    [roomsQ.data],
  );
  const sponsors: CheckpointRelationOption[] = useMemo(
    () =>
      (sponsorsQ.data ?? []).map((row) => ({
        id: row.id,
        label: row.snapshot_name || row.crm_name || row.id,
      })),
    [sponsorsQ.data],
  );

  const fail = (error: unknown) => toast.error(adminOnsiteErrorMessage(error));

  const submit = (input: CheckpointInput) => {
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventOnsite.checkpoints.toasts.saved"));
        setDialogOpen(false);
        setEdited(null);
      },
      onError: fail,
    });
  };

  const toggleActive = (row: EventCheckpointRow, next: boolean) => {
    save.mutate(
      { ...checkpointDraftToInput(checkpointDraftFromRow({ ...row }), eventId), isActive: next },
      { onError: fail },
    );
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t("adminEventOnsite.checkpoints.toasts.deleted"));
        setPendingDelete(null);
      },
      onError: (error) => {
        fail(error);
        setPendingDelete(null);
      },
    });
  };

  const name = (row: EventCheckpointRow) =>
    lang === "en" ? row.name_en || row.name_pl : row.name_pl || row.name_en;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-lg">{t("adminEventOnsite.checkpoints.title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("adminEventOnsite.checkpoints.subtitle")}
          </p>
        </div>
        <Button
          onClick={() => {
            setEdited(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminEventOnsite.actions.addCheckpoint")}
        </Button>
      </header>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventOnsite.checkpoints.loading")}
        errorMessage={
          listQ.error === null || listQ.error === undefined
            ? null
            : adminOnsiteErrorMessage(listQ.error)
        }
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventOnsite.checkpoints.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{name(row)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {`${t(`adminEventOnsite.checkpointKinds.${row.kind}`, { defaultValue: row.kind })} · ${t(
                    `adminEventOnsite.directionModes.${row.direction_mode}`,
                    { defaultValue: row.direction_mode },
                  )}`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={row.access_mode === "control" ? "default" : "secondary"}>
                  {t(`adminEventOnsite.accessModes.${row.access_mode}`, {
                    defaultValue: row.access_mode,
                  })}
                </Badge>
                <Badge variant="outline">
                  {`${t("adminEventOnsite.labels.occupancy")}: ${row.occupancy}${
                    row.capacity === null ? "" : ` / ${row.capacity}`
                  }`}
                </Badge>
                <Badge variant="outline">{`${t("adminEventOnsite.results.granted")}: ${row.granted_count}`}</Badge>
                {row.denied_count > 0 ? (
                  <Badge variant="destructive">{`${t("adminEventOnsite.filters.denied")}: ${row.denied_count}`}</Badge>
                ) : null}
                {row.device_count > 0 ? (
                  <Badge variant="outline">{`${t("adminEventOnsite.labels.devices")}: ${row.device_count}`}</Badge>
                ) : null}
              </div>

              <AdminFormSwitchRow
                label={t("adminEventOnsite.checkpoints.dialog.isActive")}
                checked={row.is_active}
                onCheckedChange={(next) => toggleActive(row, next)}
                className="w-auto border-0 p-0"
              />

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("adminEventOnsite.checkpoints.dialog.editTitle")}
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
                  aria-label={t("adminEventOnsite.checkpoints.deleteConfirm")}
                  onClick={() => setPendingDelete(row)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </AdminCatalogListState>

      <EventCheckpointDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setEdited(null);
        }}
        eventId={eventId}
        checkpoint={edited}
        sessions={sessions}
        rooms={rooms}
        sponsors={sponsors}
        isSaving={save.isPending}
        onSubmit={submit}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => (next ? undefined : setPendingDelete(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminEventOnsite.checkpoints.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventOnsite.checkpoints.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminEventOnsite.actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("adminEventOnsite.actions.save")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
