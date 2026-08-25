// Organizm: stoliki giełdy spotkań 1-1 jednego wydarzenia.
//
// WYŁĄCZENIE JEST PIERWSZORZĘDNE, USUNIĘCIE DRUGORZĘDNE. Baza nie pozwoli
// skasować stolika, przy którym cokolwiek się odbyło - także spotkania odwołane
// i odbyte - bo historia straciłaby miejsce zdarzenia. Dlatego przełącznik
// „aktywny" stoi w wierszu, a kasowanie chowa się za potwierdzeniem i mówi
// wprost, co zrobić zamiast niego.
//
// OBCIĄŻENIE POKAZUJEMY W WIERSZU, bo to jedyna liczba, która decyduje, czy
// dodać kolejny stolik. RPC listy liczy je razem z wierszem - drugie zapytanie
// tylko po to, żeby dopisać „3 spotkania", byłoby round-tripem na darmo.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { MeetingTableDialog } from "@/components/admin/events/molecules/MeetingTableDialog";
import { adminMeetingFailure } from "@/lib/events/adminMeetingErrors";
import { formatDateTime } from "@/lib/i18n/format";
import type { MeetingTableInput, MeetingTableRow } from "@/lib/events/meetingsApi";
import {
  useDeleteMeetingTable,
  useMeetingTables,
  useSaveMeetingTable,
} from "@/lib/events/useMeetings";

export function MeetingTablesPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const listQ = useMeetingTables(eventId);
  const save = useSaveMeetingTable(eventId);
  const remove = useDeleteMeetingTable(eventId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [edited, setEdited] = useState<MeetingTableRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MeetingTableRow | null>(null);

  const rows = listQ.data ?? [];
  const seats = rows.reduce((sum, row) => (row.is_active ? sum + row.capacity : sum), 0);

  const fail = (error: unknown) => {
    const failure = adminMeetingFailure(error);
    toast.error(t(failure.key, failure.params));
  };

  const submit = (input: MeetingTableInput) => {
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventMeetings.toasts.tableSaved"));
        setDialogOpen(false);
        setEdited(null);
      },
      onError: fail,
    });
  };

  /** Przełącznik w wierszu wysyła CAŁY wiersz - RPC zapisu jest upsertem. */
  const toggleActive = (row: MeetingTableRow, next: boolean) => {
    save.mutate(
      {
        id: row.id,
        eventId,
        label: row.label,
        zone: row.zone,
        roomId: row.room_id,
        capacity: row.capacity,
        note: row.note,
        sortOrder: row.sort_order,
        isActive: next,
      },
      { onError: fail },
    );
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t("adminEventMeetings.toasts.tableDeleted"));
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
        <div>
          <h2 className="font-display text-lg">{t("adminEventMeetings.tables.title")}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-snug text-muted-foreground">
            {t("adminEventMeetings.tables.subtitle")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("adminEventMeetings.tables.seatsSummary", { tables: rows.length, seats })}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEdited(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t("adminEventMeetings.tables.addAction")}
        </Button>
      </header>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventMeetings.tables.loading")}
        errorMessage={listQ.error === null ? null : t(adminMeetingFailure(listQ.error).key)}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventMeetings.tables.empty")}
      >
        <ul className="divide-y divide-border rounded-lg border border-border/60">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{row.label}</span>
                  {row.zone === null ? null : (
                    <Badge variant="outline" className="text-[11px]">
                      {row.zone}
                    </Badge>
                  )}
                  {row.room_name === null ? null : (
                    <Badge variant="secondary" className="text-[11px]">
                      {row.room_name}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("adminEventMeetings.tables.capacityLabel")}: {row.capacity} ·{" "}
                  {t("adminEventMeetings.tables.loadValue", {
                    count: row.meetings_count,
                    minutes: row.minutes_taken,
                  })}
                  {row.next_meeting_at === null
                    ? ""
                    : ` · ${t("adminEventMeetings.tables.nextColumn")}: ${formatDateTime(
                        row.next_meeting_at,
                        i18n.language,
                      )}`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={row.is_active}
                  onCheckedChange={(next) => toggleActive(row, next)}
                  aria-label={t("adminEventMeetings.tables.activeLabel")}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("adminEventMeetings.tables.editAction")}
                  onClick={() => {
                    setEdited(row);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("adminEventMeetings.tables.deleteAction")}
                  onClick={() => setPendingDelete(row)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </AdminCatalogListState>

      <MeetingTableDialog
        open={dialogOpen}
        eventId={eventId}
        row={edited}
        isSaving={save.isPending}
        onSubmit={submit}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setEdited(null);
        }}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("adminEventMeetings.tables.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventMeetings.tables.deleteConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminEventMeetings.tables.cancelAction")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("adminEventMeetings.tables.deleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
