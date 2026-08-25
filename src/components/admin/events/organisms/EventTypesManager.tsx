// Organizm: zarządzanie katalogiem RODZAJÓW WYDARZEŃ.
//
// CZTERY OPERACJE, które musi umieć redakcja: dodać rodzaj (PL + EN), zmienić
// ustawienia domyślne, wyłączyć rodzaj w organizacji i PRZEPIĄĆ wydarzenia na
// inny rodzaj. Ostatnia jest tu z premedytacją: bez niej blokada usunięcia
// („40 wydarzeń używa tego rodzaju") jest pułapką bez wyjścia.
//
// WYŁĄCZENIE JEST OSOBNE OD USUNIĘCIA. Rodzaj używany przez istniejące
// wydarzenia NIE może zniknąć, bo etykieta w archiwum przestałaby się
// rozwiązywać, a wydarzenie zostałoby bez nazwy rodzaju na stronie publicznej.
// Dlatego kasowanie działa tylko przy ZEROWYM użyciu, a wszystko inne wyłącza
// się przełącznikiem albo przepina.
//
// ORGANIZM JEST KOMPOZYCJĄ. Reguły (wersja robocza, walidacja, payload zapisu,
// odcięcie kosza, mapowanie odmowy bazy) mieszkają w
// `lib/events/adminEventTypeCatalog`. Powtarzalne fragmenty widoku (nagłówek
// z licznikiem, trzy stany listy, wiersz wpisu) to molekuły `AdminCatalog*`,
// wspólne z katalogami klubów. Formularz jest osobnym organizmem
// (`EventTypeDialog`). Tutaj zostaje SKLEJENIE: co idzie do mutacji, co się
// dzieje z odpowiedzią i co widzi administrator po odmowie.
//
// LICZNIK UŻYCIA JEST ROZBITY. „40 wydarzeń" i „40 wydarzeń, z czego 12
// opublikowanych" to dwie różne informacje: pierwsza mówi, że kasowanie jest
// zablokowane, druga - jak ryzykowne jest przepięcie. RPC oddaje oba liczniki,
// więc wiersz pokazuje ten, który w danym stanie coś znaczy.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
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
import { AdminCatalogRow } from "@/components/admin/molecules/AdminCatalogRow";
import { AdminCatalogToolbar } from "@/components/admin/molecules/AdminCatalogToolbar";
import { EventTypeDialog } from "@/components/admin/events/organisms/EventTypeDialog";
import { EventTypeReassignDialog } from "@/components/admin/events/molecules/EventTypeReassignDialog";
import { uiLang } from "@/lib/i18n/format";
import { eventTypeName, eventTypeUsage, type EventTypeAdminRow } from "@/lib/events/eventTypes";
import {
  activeEventTypeCount,
  eventTypeDeleteBlocked,
  eventTypeDeleteFailure,
  eventTypeDraftFromRow,
  eventTypeReassignAvailable,
  eventTypeReassignFailure,
  eventTypeSaveFailure,
  eventTypeUpsertPayload,
  newEventTypeDraft,
  type EventTypeDraft,
  type EventTypeFailure,
} from "@/lib/events/adminEventTypeCatalog";
import {
  useAdminEventTypes,
  useDeleteEventType,
  useReassignEventType,
  useSetEventTypeActive,
  useUpsertEventType,
} from "@/lib/events/useEventTypes";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export function EventTypesManager() {
  ensureAdminEventsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  const listQ = useAdminEventTypes();
  const upsert = useUpsertEventType();
  const setActive = useSetEventTypeActive();
  const remove = useDeleteEventType();
  const reassign = useReassignEventType();

  const [draft, setDraft] = useState<EventTypeDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EventTypeAdminRow | null>(null);
  const [pendingReassign, setPendingReassign] = useState<EventTypeAdminRow | null>(null);

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);

  /** Odmowa jedzie ze słownika tylko wtedy, gdy ją rozpoznaliśmy. */
  const failureText = (fail: EventTypeFailure): string =>
    fail.key === null ? fail.text : t(fail.key);

  /**
   * Zdanie o użyciu. Trzy stany, bo trzy różne decyzje: nieużywany (kasowalny),
   * tylko w szkicach (przepięcie bez skutku publicznego), mieszany (przepięcie
   * ruszy stronę publiczną).
   */
  const usageLabel = (row: EventTypeAdminRow): string => {
    const usage = eventTypeUsage(row);
    if (usage.total === 0) return t("adminEvents.types.usageNone");
    if (usage.published === 0) {
      return t("adminEvents.types.usageDraftsOnly", { total: usage.total });
    }
    return t("adminEvents.types.usageMixed", {
      total: usage.total,
      published: usage.published,
    });
  };

  const save = (current: EventTypeDraft) => {
    upsert.mutate(eventTypeUpsertPayload(current), {
      onSuccess: () => {
        toast.success(t("adminEvents.types.toasts.saved"));
        setDraft(null);
      },
      onError: (error) => toast.error(failureText(eventTypeSaveFailure(error))),
    });
  };

  const confirmDelete = (row: EventTypeAdminRow) => {
    remove.mutate(row.id, {
      onSuccess: () => {
        toast.success(t("adminEvents.types.toasts.deleted"));
        setPendingDelete(null);
      },
      onError: (error) => toast.error(failureText(eventTypeDeleteFailure(error))),
    });
  };

  const confirmReassign = (row: EventTypeAdminRow, targetId: string) => {
    reassign.mutate(
      { fromId: row.id, toId: targetId },
      {
        onSuccess: (moved) => {
          toast.success(t("adminEvents.types.toasts.reassigned", { count: moved }));
          setPendingReassign(null);
        },
        onError: (error) => toast.error(failureText(eventTypeReassignFailure(error))),
      },
    );
  };

  return (
    <div className="space-y-4">
      <AdminCatalogToolbar
        title={t("adminEvents.types.title")}
        subtitle={t("adminEvents.types.subtitle")}
        addLabel={t("adminEvents.types.addAction")}
        onAdd={() => setDraft(newEventTypeDraft(rows))}
        summary={t("adminEvents.types.summary", {
          active: activeEventTypeCount(rows),
          total: rows.length,
        })}
      />

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEvents.types.loading")}
        errorMessage={listQ.isError ? listQ.error.message : null}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEvents.types.empty")}
      >
        <ul className="space-y-2">
          {rows.map((row) => {
            const name = eventTypeName(row, lang);
            const otherActive = rows.filter((other) => other.id !== row.id && other.is_active);
            return (
              <li key={row.id}>
                <AdminCatalogRow
                  isActive={row.is_active}
                  isSystem={row.is_system}
                  systemLabel={t("adminEvents.types.systemBadge")}
                  disabledLabel={t("adminEvents.types.disabledBadge")}
                  leading={
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60"
                      style={
                        row.accent_color === null
                          ? undefined
                          : { color: row.accent_color, borderColor: row.accent_color }
                      }
                    >
                      <DynamicIcon name={row.icon ?? "CalendarDays"} size={16} />
                    </span>
                  }
                  title={
                    <>
                      <span className="font-medium">{name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {t(`adminEvents.formats.${row.default_format}`)}
                      </Badge>
                    </>
                  }
                  meta={<>{usageLabel(row)}</>}

                  toggleLabel={t("adminEvents.types.toggleLabel", { name })}
                  toggleDisabled={setActive.isPending}
                  onToggle={(checked) =>
                    setActive.mutate(
                      { id: row.id, isActive: checked },
                      {
                        onSuccess: () => toast.success(t("adminEvents.types.toasts.toggled")),
                        onError: (error) => toast.error(error.message),
                      },
                    )
                  }
                  extraActions={
                    eventTypeReassignAvailable(row, otherActive.length) ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("adminEvents.types.reassignLabel", { name })}
                        onClick={() => setPendingReassign(row)}
                      >
                        <ArrowLeftRight className="h-4 w-4" />
                      </Button>
                    ) : undefined
                  }
                  editLabel={t("adminEvents.types.editLabel", { name })}
                  onEdit={() => setDraft(eventTypeDraftFromRow(row))}
                  deleteLabel={t("adminEvents.types.deleteLabel", { name })}
                  deleteDisabled={eventTypeDeleteBlocked(row)}
                  onDelete={() => setPendingDelete(row)}
                />
              </li>
            );
          })}
        </ul>
      </AdminCatalogListState>

      <EventTypeDialog
        draft={draft}
        isSaving={upsert.isPending}
        onDraftChange={setDraft}
        onClose={() => setDraft(null)}
        onSave={save}
      />

      <EventTypeReassignDialog
        sourceName={pendingReassign === null ? null : eventTypeName(pendingReassign, lang)}
        total={pendingReassign?.events_count ?? 0}
        targets={rows
          .filter((row) => row.id !== pendingReassign?.id && row.is_active)
          .map((row) => ({ id: row.id, name: eventTypeName(row, lang) }))}
        isPending={reassign.isPending}
        onClose={() => setPendingReassign(null)}
        onConfirm={(targetId) => {
          if (pendingReassign !== null) confirmReassign(pendingReassign, targetId);
        }}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => (open ? null : setPendingDelete(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminEvents.types.deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEvents.types.deleteDialog.body", {
                name: pendingDelete === null ? "" : eventTypeName(pendingDelete, lang),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("adminEvents.types.deleteDialog.cancelAction")}
            </AlertDialogCancel>
            {pendingDelete === null ? null : (
              <AlertDialogAction
                onClick={() => confirmDelete(pendingDelete)}
                disabled={remove.isPending}
              >
                {t("adminEvents.types.deleteDialog.confirmAction")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
