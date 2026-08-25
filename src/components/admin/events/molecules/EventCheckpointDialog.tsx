// Molekuła: formularz JEDNEGO punktu kontrolnego.
//
// TRYB KONTROLI TO NAJWAŻNIEJSZE POLE TEGO EKRANU, nie nazwa. `control` odmawia
// wejścia bez zatwierdzonego zapisu, `track` zapisuje każde piknięcie. Pomyłka w
// tym polu widać dopiero przy bramce, na oczach kolejki - dlatego pole ma
// podpowiedź mówiącą wprost, co się stanie.
//
// PUSTA POJEMNOŚĆ TO BRAK LIMITU, ZERO TO ZAKAZ WEJŚCIA. Dwa różne zdania,
// jedno pole - podpowiedź rozstrzyga, żeby nikt nie wpisał `0` w znaczeniu „bez
// limitu".
//
// POWIĄZANIA CZYŚCI KONWERSJA, NIE UŻYTKOWNIK. Zmiana rodzaju punktu z `session`
// na `event_entry` zdejmuje wskazanie sesji jawnym `null`; inaczej w bazie
// zostaje sierota po poprzedniej wersji formularza.
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
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { FormSelect } from "@/components/atoms/FormSelect";
import { Label } from "@/components/ui/label";
import {
  CHECKPOINT_ACCESS_MODES,
  CHECKPOINT_DIRECTION_MODES,
  CHECKPOINT_KINDS,
  type CheckpointAccessMode,
  type CheckpointDirectionMode,
  type CheckpointInput,
  type CheckpointKind,
  type EventCheckpointRow,
} from "@/lib/events/onsiteApi";
import {
  ONSITE_MAX_NAME,
  checkpointDraftFromRow,
  checkpointDraftToInput,
  emptyCheckpointDraft,
  validateCheckpointDraft,
  type CheckpointDraft,
} from "@/lib/events/onsiteDraft";

export interface CheckpointRelationOption {
  id: string;
  label: string;
}

interface EventCheckpointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowy punkt kontrolny. */
  checkpoint: EventCheckpointRow | null;
  sessions: CheckpointRelationOption[];
  rooms: CheckpointRelationOption[];
  sponsors: CheckpointRelationOption[];
  isSaving: boolean;
  onSubmit: (input: CheckpointInput) => void;
}

export function EventCheckpointDialog({
  open,
  onOpenChange,
  eventId,
  checkpoint,
  sessions,
  rooms,
  sponsors,
  isSaving,
  onSubmit,
}: EventCheckpointDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CheckpointDraft>(() => emptyCheckpointDraft());
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(
      checkpoint === null ? emptyCheckpointDraft() : checkpointDraftFromRow({ ...checkpoint }),
    );
    setTouched(false);
  }, [open, checkpoint]);

  const errors = validateCheckpointDraft(draft);
  const errorFor = (field: string): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const set = <K extends keyof CheckpointDraft>(key: K, value: CheckpointDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(checkpointDraftToInput(draft, eventId));
  };

  const isNew = draft.id === undefined;
  // Radix nie przyjmuje pustego stringa jako wartosci itemu - „brak wskazania"
  // ma wlasny wartownik, ktory konwersja zamienia na pusty tekst szkicu.
  const NONE = "__none__";
  const relationOptions = (items: CheckpointRelationOption[], noneLabel: string) => [
    { value: NONE, label: noneLabel },
    ...items.map((item) => ({ value: item.id, label: item.label })),
  ];
  const relationValue = (value: string) => (value === "" ? NONE : value);
  const relationSet = (key: "sessionId" | "roomId" | "sponsorId") => (value: string) =>
    set(key, value === NONE ? "" : value);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              isNew
                ? "adminEventOnsite.checkpoints.dialog.createTitle"
                : "adminEventOnsite.checkpoints.dialog.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventOnsite.checkpoints.subtitle")}</DialogDescription>
        </DialogHeader>

        <AdminFormSection title={t("adminEventOnsite.checkpoints.title")} columns={2}>
          <AdminFormTextRow
            label={t("adminEventOnsite.checkpoints.dialog.namePl")}
            value={draft.namePl}
            onValueChange={(value) => set("namePl", value)}
            maxLength={ONSITE_MAX_NAME}
            error={errorFor("namePl")}
          />
          <AdminFormTextRow
            label={t("adminEventOnsite.checkpoints.dialog.nameEn")}
            value={draft.nameEn}
            onValueChange={(value) => set("nameEn", value)}
            maxLength={ONSITE_MAX_NAME}
            error={errorFor("nameEn")}
          />
          <AdminFormEnumRow<CheckpointKind>
            label={t("adminEventOnsite.checkpoints.dialog.kind")}
            value={draft.kind as CheckpointKind}
            options={CHECKPOINT_KINDS}
            labelFor={(option) => t(`adminEventOnsite.checkpointKinds.${option}`)}
            onValueChange={(value) => set("kind", value)}
          />
          <AdminFormEnumRow<CheckpointAccessMode>
            label={t("adminEventOnsite.checkpoints.dialog.accessMode")}
            hint={t("adminEventOnsite.checkpoints.dialog.accessModeHint")}
            value={draft.accessMode as CheckpointAccessMode}
            options={CHECKPOINT_ACCESS_MODES}
            labelFor={(option) => t(`adminEventOnsite.accessModes.${option}`)}
            onValueChange={(value) => set("accessMode", value)}
          />
          <AdminFormEnumRow<CheckpointDirectionMode>
            label={t("adminEventOnsite.checkpoints.dialog.directionMode")}
            value={draft.directionMode as CheckpointDirectionMode}
            options={CHECKPOINT_DIRECTION_MODES}
            labelFor={(option) => t(`adminEventOnsite.directionModes.${option}`)}
            onValueChange={(value) => set("directionMode", value)}
          />
          <AdminFormTextRow
            label={t("adminEventOnsite.checkpoints.dialog.capacity")}
            hint={t("adminEventOnsite.checkpoints.dialog.capacityHint")}
            value={draft.capacity}
            onValueChange={(value) => set("capacity", value)}
            inputMode="numeric"
            error={errorFor("capacity")}
          />

          {draft.kind === "session" ? (
            <div className="space-y-1.5">
              <Label htmlFor="checkpoint-session">
                {t("adminEventOnsite.checkpoints.dialog.session")}
              </Label>
              <FormSelect
                id="checkpoint-session"
                value={relationValue(draft.sessionId)}
                options={relationOptions(sessions, t("adminEventOnsite.filters.all"))}
                onValueChange={relationSet("sessionId")}
                aria-label={t("adminEventOnsite.checkpoints.dialog.session")}
              />
              {errorFor("sessionId") === null ? null : (
                <p className="text-xs text-destructive">{errorFor("sessionId")}</p>
              )}
            </div>
          ) : null}

          {draft.kind === "company_booth" ? (
            <div className="space-y-1.5">
              <Label htmlFor="checkpoint-sponsor">
                {t("adminEventOnsite.checkpoints.dialog.sponsor")}
              </Label>
              <FormSelect
                id="checkpoint-sponsor"
                value={relationValue(draft.sponsorId)}
                options={relationOptions(sponsors, t("adminEventOnsite.filters.all"))}
                onValueChange={relationSet("sponsorId")}
                aria-label={t("adminEventOnsite.checkpoints.dialog.sponsor")}
              />
              {errorFor("sponsorId") === null ? null : (
                <p className="text-xs text-destructive">{errorFor("sponsorId")}</p>
              )}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="checkpoint-room">
              {t("adminEventOnsite.checkpoints.dialog.room")}
            </Label>
            <FormSelect
              id="checkpoint-room"
              value={relationValue(draft.roomId)}
              options={relationOptions(rooms, t("adminEventOnsite.filters.all"))}
              onValueChange={relationSet("roomId")}
              aria-label={t("adminEventOnsite.checkpoints.dialog.room")}
            />
          </div>

          <AdminFormTextRow
            label={t("adminEventOnsite.checkpoints.dialog.dedupeWindowSeconds")}
            hint={t("adminEventOnsite.checkpoints.dialog.dedupeHint")}
            value={draft.dedupeWindowSeconds}
            onValueChange={(value) => set("dedupeWindowSeconds", value)}
            inputMode="numeric"
            error={errorFor("dedupeWindowSeconds")}
          />
          <AdminFormTextRow
            label={t("adminEventOnsite.checkpoints.dialog.sortOrder")}
            value={draft.sortOrder}
            onValueChange={(value) => set("sortOrder", value)}
            inputMode="numeric"
          />
          <AdminFormSwitchRow
            label={t("adminEventOnsite.checkpoints.dialog.isActive")}
            checked={draft.isActive}
            onCheckedChange={(value) => set("isActive", value)}
            className="sm:col-span-2"
          />
        </AdminFormSection>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventOnsite.actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventOnsite.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
