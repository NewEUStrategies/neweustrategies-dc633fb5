// Molekuła: formularz jednego STOLIKA giełdy spotkań 1-1.
//
// DIALOG, A NIE WIERSZ EDYTOWALNY W MIEJSCU. Stolik ma siedem decyzji, z czego
// dwie (pojemność, kolejność) zmieniają sposób, w jaki baza przydziela miejsca -
// a to nie jest coś, co redaktor ma zmieniać przypadkiem, przewijając listę.
//
// POJEMNOŚĆ TO LICZBA SPOTKAŃ RÓWNOLEGLE, NIE LICZBA KRZESEŁ. Stolik dwuosobowy
// ma pojemność 1. Tekst podpowiedzi mówi to wprost, bo pierwsze wypełnienie tego
// pola liczbą krzeseł podwaja przepustowość giełdy i kończy się dwoma parami
// przy jednym stoliku.
//
// WALIDACJA JEST TU MINIMALNA I CELOWO: etykieta niepusta oraz pojemność 1-50,
// czyli dokładnie to, co pozwala WYSŁAĆ zapytanie. Resztę - zajęte miejsce,
// zdublowana etykieta - rozstrzyga baza, bo tylko ona zna stan pozostałych
// stolików, a zgadywanie go po stronie przeglądarki dałoby dwie różne prawdy.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { MeetingTableInput, MeetingTableRow } from "@/lib/events/meetingsApi";

/** Szkic formularza; liczby jako napisy, bo tak działa kontrolowany input. */
interface TableDraft {
  label: string;
  zone: string;
  capacity: string;
  note: string;
  sortOrder: string;
  isActive: boolean;
}

const NEW_DRAFT: TableDraft = {
  label: "",
  zone: "",
  capacity: "1",
  note: "",
  sortOrder: "0",
  isActive: true,
};

function draftFromRow(row: MeetingTableRow): TableDraft {
  return {
    label: row.label,
    zone: row.zone ?? "",
    capacity: String(row.capacity),
    note: row.note ?? "",
    sortOrder: String(row.sort_order),
    isActive: row.is_active,
  };
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function MeetingTableDialog({
  open,
  eventId,
  row,
  isSaving,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  eventId: string;
  /** `null` znaczy „nowy stolik" - dialog nie odgaduje trybu z pustych pól. */
  row: MeetingTableRow | null;
  isSaving: boolean;
  onSubmit: (input: MeetingTableInput) => void;
  onOpenChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<TableDraft>(NEW_DRAFT);

  // Szkic wraca do wartości wiersza przy KAŻDYM otwarciu: dialog zamknięty bez
  // zapisu nie może zostawić cudzych danych w polu następnego stolika.
  useEffect(() => {
    if (!open) return;
    setDraft(row === null ? NEW_DRAFT : draftFromRow(row));
  }, [open, row]);

  const capacity = toNumber(draft.capacity, 0);
  const labelOk = draft.label.trim().length > 0;
  const capacityOk = capacity >= 1 && capacity <= 50;
  const canSave = labelOk && capacityOk && !isSaving;

  const submit = () => {
    if (!canSave) return;
    onSubmit({
      id: row?.id ?? null,
      eventId,
      label: draft.label.trim(),
      zone: draft.zone.trim().length > 0 ? draft.zone.trim() : null,
      // Sala agendy zostaje po stronie wiersza - przepinanie stolika między
      // salami to decyzja agendy, nie giełdy, i ma własny ekran.
      roomId: row?.room_id ?? null,
      capacity,
      note: draft.note.trim().length > 0 ? draft.note.trim() : null,
      sortOrder: toNumber(draft.sortOrder, 0),
      isActive: draft.isActive,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {row === null
              ? t("adminEventMeetings.tables.addAction")
              : t("adminEventMeetings.tables.editAction")}
          </DialogTitle>
          <DialogDescription>{t("adminEventMeetings.tables.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="meeting-table-label">{t("adminEventMeetings.tables.labelLabel")}</Label>
            <Input
              id="meeting-table-label"
              value={draft.label}
              onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))}
              placeholder={t("adminEventMeetings.tables.labelPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">
              {labelOk
                ? t("adminEventMeetings.tables.labelHint")
                : t("adminEventMeetings.errors.invalidLabel")}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="meeting-table-zone">{t("adminEventMeetings.tables.zoneLabel")}</Label>
              <Input
                id="meeting-table-zone"
                value={draft.zone}
                onChange={(event) => setDraft((prev) => ({ ...prev, zone: event.target.value }))}
                placeholder={t("adminEventMeetings.tables.zonePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-table-capacity">
                {t("adminEventMeetings.tables.capacityLabel")}
              </Label>
              <Input
                id="meeting-table-capacity"
                inputMode="numeric"
                value={draft.capacity}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, capacity: event.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                {capacityOk
                  ? t("adminEventMeetings.tables.capacityHint")
                  : t("adminEventMeetings.errors.invalidCapacity")}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="meeting-table-order">{t("adminEventMeetings.tables.orderLabel")}</Label>
            <Input
              id="meeting-table-order"
              inputMode="numeric"
              value={draft.sortOrder}
              onChange={(event) => setDraft((prev) => ({ ...prev, sortOrder: event.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              {t("adminEventMeetings.tables.orderHint")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="meeting-table-note">{t("adminEventMeetings.tables.noteLabel")}</Label>
            <Textarea
              id="meeting-table-note"
              value={draft.note}
              rows={2}
              onChange={(event) => setDraft((prev) => ({ ...prev, note: event.target.value }))}
              placeholder={t("adminEventMeetings.tables.notePlaceholder")}
            />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 p-3">
            <div>
              <Label htmlFor="meeting-table-active" className="text-sm">
                {t("adminEventMeetings.tables.activeLabel")}
              </Label>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                {t("adminEventMeetings.tables.activeHint")}
              </p>
            </div>
            <Switch
              id="meeting-table-active"
              checked={draft.isActive}
              onCheckedChange={(next) => setDraft((prev) => ({ ...prev, isActive: next }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("adminEventMeetings.tables.cancelAction")}
          </Button>
          <Button onClick={submit} disabled={!canSave}>
            {t("adminEventMeetings.tables.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
