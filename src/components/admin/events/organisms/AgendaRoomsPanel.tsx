// Organizm: sale wydarzenia.
//
// ZAJĘTE MINUTY OBOK POJEMNOŚCI. Sala bez ani jednej minuty programu to sala,
// którą wolno skasować; sala z minutami to odmowa `room_in_use`. Pokazanie
// obu liczb w wierszu zamienia odmowę w decyzję podjętą przed kliknięciem.
import { useState } from "react";
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
import { EventRoomDialog } from "@/components/admin/events/molecules/EventRoomDialog";
import { adminAgendaErrorMessage } from "@/lib/events/adminAgendaErrors";
import { roomDraftFromRow, roomDraftToInput } from "@/lib/events/agendaCatalogDraft";
import { useDeleteEventRoom, useEventRooms, useSaveEventRoom } from "@/lib/events/useEventSessions";
import type { EventRoomInput, EventRoomRow } from "@/lib/events/sessionsApi";

export function AgendaRoomsPanel({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const listQ = useEventRooms(eventId);
  const save = useSaveEventRoom(eventId);
  const remove = useDeleteEventRoom(eventId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [edited, setEdited] = useState<EventRoomRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EventRoomRow | null>(null);

  const rows = listQ.data ?? [];
  const nextSortOrder = rows.reduce((max, row) => Math.max(max, row.sort_order), 0) + 10;

  const fail = (error: unknown) => toast.error(adminAgendaErrorMessage(error));

  const submit = (input: EventRoomInput) => {
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventAgenda.rooms.toasts.saved"));
        setDialogOpen(false);
        setEdited(null);
      },
      onError: fail,
    });
  };

  const toggleActive = (row: EventRoomRow, next: boolean) => {
    save.mutate(
      { ...roomDraftToInput(roomDraftFromRow(row), eventId), isActive: next },
      { onError: fail },
    );
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t("adminEventAgenda.rooms.toasts.deleted"));
        setPendingDelete(null);
      },
      onError: (error) => {
        fail(error);
        setPendingDelete(null);
      },
    });
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-lg">{t("adminEventAgenda.rooms.title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("adminEventAgenda.rooms.subtitle")}
          </p>
        </div>
        <Button
          onClick={() => {
            setEdited(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminEventAgenda.rooms.addAction")}
        </Button>
      </header>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventAgenda.rooms.loading")}
        errorMessage={
          listQ.error === null || listQ.error === undefined
            ? null
            : adminAgendaErrorMessage(listQ.error)
        }
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventAgenda.rooms.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.floor === "" ? row.location_note : row.floor}
                </p>
              </div>
              <Badge variant="outline">
                {row.capacity > 0
                  ? t("adminEventAgenda.rooms.capacity", { count: row.capacity })
                  : t("adminEventAgenda.rooms.capacityUnknown")}
              </Badge>
              <Badge variant="secondary">
                {t("adminEventAgenda.rooms.sessionsCount", { count: row.sessions_count })}
              </Badge>
              <span className="text-xs tabular-nums text-muted-foreground">
                {t("adminEventAgenda.rooms.bookedMinutes", { count: row.booked_minutes })}
              </span>
              <AdminFormSwitchRow
                label={t("adminEventAgenda.rooms.dialog.isActive")}
                checked={row.is_active}
                onCheckedChange={(next) => toggleActive(row, next)}
                className="w-auto"
              />
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("adminEventAgenda.rooms.dialog.editTitle")}
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
                  aria-label={t("adminEventAgenda.rooms.deleteConfirm")}
                  onClick={() => setPendingDelete(row)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </AdminCatalogListState>

      <EventRoomDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        room={edited}
        nextSortOrder={nextSortOrder}
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
            <AlertDialogTitle>{t("adminEventAgenda.rooms.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventAgenda.rooms.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminEventAgenda.rooms.dialog.cancelAction")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("adminEventAgenda.rooms.dialog.saveAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
