// Molekuła: formularz jednej SALI wydarzenia.
//
// PUSTA POJEMNOŚĆ TO BRAK DEKLARACJI. Baza wymaga `capacity > 0`, więc zero jest
// odmawiane, a puste pole znaczy „nie deklarujemy" - podpowiedź mówi to wprost,
// bo inaczej organizator wpisuje `0` w znaczeniu „bez limitu".
//
// OBNIŻENIE POJEMNOŚCI MOŻE ZOSTAĆ ODMÓWIONE (`capacity_below_sessions`), gdy
// jakaś sesja ma wyższy limit miejsc. To sprawdzenie zostaje w bazie - tylko ona
// widzi wszystkie sesje sali.
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
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import {
  AGENDA_MAX_NAME,
  emptyRoomDraft,
  roomDraftFromRow,
  roomDraftToInput,
  validateRoomDraft,
  type RoomDraft,
} from "@/lib/events/agendaCatalogDraft";
import type { EventRoomInput, EventRoomRow } from "@/lib/events/sessionsApi";

interface EventRoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowa sala. */
  room: EventRoomRow | null;
  nextSortOrder: number;
  isSaving: boolean;
  onSubmit: (input: EventRoomInput) => void;
}

export function EventRoomDialog({
  open,
  onOpenChange,
  eventId,
  room,
  nextSortOrder,
  isSaving,
  onSubmit,
}: EventRoomDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<RoomDraft>(() => emptyRoomDraft(nextSortOrder));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(room === null ? emptyRoomDraft(nextSortOrder) : roomDraftFromRow(room));
    setTouched(false);
  }, [open, room, nextSortOrder]);

  const errors = validateRoomDraft(draft);
  const errorFor = (field: keyof RoomDraft): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const set = <K extends keyof RoomDraft>(key: K, value: RoomDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(roomDraftToInput(draft, eventId));
  };

  const isNew = draft.id === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              isNew
                ? "adminEventAgenda.rooms.dialog.createTitle"
                : "adminEventAgenda.rooms.dialog.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventAgenda.rooms.subtitle")}</DialogDescription>
        </DialogHeader>

        <AdminFormSection title={t("adminEventAgenda.rooms.title")} columns={2}>
          <AdminFormTextRow
            label={t("adminEventAgenda.rooms.dialog.name")}
            value={draft.name}
            onValueChange={(value) => set("name", value)}
            maxLength={AGENDA_MAX_NAME}
            error={errorFor("name")}
          />
          <AdminFormTextRow
            label={t("adminEventAgenda.rooms.dialog.capacity")}
            hint={t("adminEventAgenda.rooms.dialog.capacityHint")}
            value={draft.capacity}
            onValueChange={(value) => set("capacity", value)}
            inputMode="numeric"
            error={errorFor("capacity")}
          />
          <AdminFormTextRow
            label={t("adminEventAgenda.rooms.dialog.floor")}
            value={draft.floor}
            onValueChange={(value) => set("floor", value)}
            maxLength={60}
          />
          <AdminFormTextRow
            label={t("adminEventAgenda.rooms.dialog.sortOrder")}
            value={draft.sortOrder}
            onValueChange={(value) => set("sortOrder", value)}
            inputMode="numeric"
          />
          <AdminFormTextRow
            label={t("adminEventAgenda.rooms.dialog.locationNote")}
            value={draft.locationNote}
            onValueChange={(value) => set("locationNote", value)}
            rows={2}
            maxLength={400}
            className="sm:col-span-2"
          />
          <AdminFormSwitchRow
            label={t("adminEventAgenda.rooms.dialog.isActive")}
            checked={draft.isActive}
            onCheckedChange={(value) => set("isActive", value)}
          />
        </AdminFormSection>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventAgenda.rooms.dialog.cancelAction")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventAgenda.rooms.dialog.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
