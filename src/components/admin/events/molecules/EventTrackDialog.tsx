// Molekuła: formularz jednej ŚCIEŻKI programu.
//
// KLUCZ JEST ZAMROŻONY PO ZAPISIE. RPC zapisu nie czyta klucza przy edycji, więc
// edytowalne pole obiecywałoby zmianę, która nigdy się nie stanie - pokazujemy je
// wyłączone.
//
// KOLOR MA WŁASNY PRÓBNIK, ale trzymamy go jako tekst: `#RRGGBB` wraca na
// publiczną agendę i musi przejść wzór, zanim pojedzie do bazy.
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
  emptyTrackDraft,
  trackDraftFromRow,
  trackDraftToInput,
  validateTrackDraft,
  type TrackDraft,
} from "@/lib/events/agendaCatalogDraft";
import type { EventTrackInput, EventTrackRow } from "@/lib/events/sessionsApi";

interface EventTrackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowa ścieżka. */
  track: EventTrackRow | null;
  nextSortOrder: number;
  isSaving: boolean;
  onSubmit: (input: EventTrackInput) => void;
}

export function EventTrackDialog({
  open,
  onOpenChange,
  eventId,
  track,
  nextSortOrder,
  isSaving,
  onSubmit,
}: EventTrackDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<TrackDraft>(() => emptyTrackDraft(nextSortOrder));
  const [touched, setTouched] = useState(false);

  // Szkic odtwarzamy przy KAŻDYM otwarciu - porzucone zmiany nie mogą wrócić
  // do formularza następnej ścieżki.
  useEffect(() => {
    if (!open) return;
    setDraft(track === null ? emptyTrackDraft(nextSortOrder) : trackDraftFromRow(track));
    setTouched(false);
  }, [open, track, nextSortOrder]);

  const errors = validateTrackDraft(draft);
  const errorFor = (field: keyof TrackDraft): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const set = <K extends keyof TrackDraft>(key: K, value: TrackDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(trackDraftToInput(draft, eventId));
  };

  const isNew = draft.id === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              isNew
                ? "adminEventAgenda.tracks.dialog.createTitle"
                : "adminEventAgenda.tracks.dialog.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventAgenda.tracks.subtitle")}</DialogDescription>
        </DialogHeader>

        <AdminFormSection title={t("adminEventAgenda.tracks.title")} columns={2}>
          <AdminFormTextRow
            label={t("adminEventAgenda.tracks.dialog.key")}
            hint={t("adminEventAgenda.tracks.dialog.keyHint")}
            value={draft.key}
            onValueChange={(value) => set("key", value)}
            disabled={!isNew}
            monospace
            maxLength={49}
            error={errorFor("key")}
          />
          <AdminFormTextRow
            label={t("adminEventAgenda.tracks.dialog.sortOrder")}
            value={draft.sortOrder}
            onValueChange={(value) => set("sortOrder", value)}
            inputMode="numeric"
          />
          <AdminFormTextRow
            label={t("adminEventAgenda.tracks.dialog.namePl")}
            value={draft.namePl}
            onValueChange={(value) => set("namePl", value)}
            maxLength={AGENDA_MAX_NAME}
            error={errorFor("namePl")}
          />
          <AdminFormTextRow
            label={t("adminEventAgenda.tracks.dialog.nameEn")}
            value={draft.nameEn}
            onValueChange={(value) => set("nameEn", value)}
            maxLength={AGENDA_MAX_NAME}
            error={errorFor("nameEn")}
          />
          <AdminFormTextRow
            label={t("adminEventAgenda.tracks.dialog.accentColor")}
            value={draft.accentColor}
            onValueChange={(value) => set("accentColor", value)}
            placeholder="#FA9346"
            monospace
            maxLength={7}
          />
          <AdminFormSwitchRow
            label={t("adminEventAgenda.tracks.dialog.isActive")}
            checked={draft.isActive}
            onCheckedChange={(value) => set("isActive", value)}
          />
        </AdminFormSection>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventAgenda.tracks.dialog.cancelAction")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventAgenda.tracks.dialog.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
