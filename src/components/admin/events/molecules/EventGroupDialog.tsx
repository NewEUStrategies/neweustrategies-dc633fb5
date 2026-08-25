// Molekula: formularz jednej GRUPY UCZESTNIKOW.
//
// KLUCZ ZAMROZONY PO ZAPISIE - RPC zapisu nie czyta klucza przy edycji, wiec
// edytowalne pole obiecywaloby zmiane, ktora nigdy sie nie stanie.
//
// WLACZNIK I ZASIEG SA DWOMA POLAMI, bo baza ma na to dwa warunki: przelacznik
// „widzi liste" jest wlacznikiem, a `attendee_visibility` zasiegiem. Zlanie ich
// w jedno pole odbieraloby organizatorowi mozliwosc pokazania listy w wezszym
// zakresie niz wszyscy zapisani.
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
import {
  TERMS_MAX_DESCRIPTION,
  TERMS_MAX_NAME,
  emptyGroupDraft,
  groupDraftFromRow,
  groupDraftToInput,
  validateGroupDraft,
  type GroupDraft,
} from "@/lib/events/termsGroupsDraft";
import {
  GROUP_VISIBILITIES,
  type EventGroupRow,
  type GroupInput,
  type GroupVisibility,
} from "@/lib/events/termsGroupsApi";

interface EventGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowa grupa. */
  group: EventGroupRow | null;
  nextSortOrder: number;
  isSaving: boolean;
  onSubmit: (input: GroupInput) => void;
}

export function EventGroupDialog({
  open,
  onOpenChange,
  eventId,
  group,
  nextSortOrder,
  isSaving,
  onSubmit,
}: EventGroupDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<GroupDraft>(() => emptyGroupDraft(nextSortOrder));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(
      group === null
        ? emptyGroupDraft(nextSortOrder)
        : groupDraftFromRow(group as unknown as Record<string, unknown>),
    );
    setTouched(false);
  }, [open, group, nextSortOrder]);

  const errors = validateGroupDraft(draft);
  const errorFor = (field: keyof GroupDraft): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const set = <K extends keyof GroupDraft>(key: K, value: GroupDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(groupDraftToInput(draft, eventId));
  };

  const isNew = draft.id === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              isNew
                ? "adminEventTerms.groups.dialog.createTitle"
                : "adminEventTerms.groups.dialog.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventTerms.groups.subtitle")}</DialogDescription>
        </DialogHeader>

        <AdminFormSection title={t("adminEventTerms.groups.title")} columns={2}>
          <AdminFormTextRow
            label={t("adminEventTerms.groups.dialog.key")}
            hint={t("adminEventTerms.groups.dialog.keyHint")}
            value={draft.key}
            onValueChange={(value) => set("key", value)}
            disabled={!isNew}
            monospace
            maxLength={49}
            error={errorFor("key")}
          />
          <AdminFormTextRow
            label={t("adminEventTerms.groups.dialog.color")}
            value={draft.color}
            onValueChange={(value) => set("color", value)}
            placeholder="#FA9346"
            monospace
            maxLength={7}
            error={errorFor("color")}
          />
          <AdminFormTextRow
            label={t("adminEventTerms.groups.dialog.namePl")}
            value={draft.namePl}
            onValueChange={(value) => set("namePl", value)}
            maxLength={TERMS_MAX_NAME}
            error={errorFor("namePl")}
          />
          <AdminFormTextRow
            label={t("adminEventTerms.groups.dialog.nameEn")}
            value={draft.nameEn}
            onValueChange={(value) => set("nameEn", value)}
            maxLength={TERMS_MAX_NAME}
          />
          <AdminFormTextRow
            label={t("adminEventTerms.groups.dialog.descriptionPl")}
            value={draft.descriptionPl}
            onValueChange={(value) => set("descriptionPl", value)}
            maxLength={TERMS_MAX_DESCRIPTION}
            rows={3}
          />
          <AdminFormTextRow
            label={t("adminEventTerms.groups.dialog.descriptionEn")}
            value={draft.descriptionEn}
            onValueChange={(value) => set("descriptionEn", value)}
            maxLength={TERMS_MAX_DESCRIPTION}
            rows={3}
          />
          <AdminFormTextRow
            label={t("adminEventTerms.groups.dialog.minTierRank")}
            value={draft.minTierRank}
            onValueChange={(value) => set("minTierRank", value)}
            inputMode="numeric"
            error={errorFor("minTierRank")}
          />
          <AdminFormTextRow
            label={t("adminEventTerms.groups.dialog.sortOrder")}
            value={draft.sortOrder}
            onValueChange={(value) => set("sortOrder", value)}
            inputMode="numeric"
          />
        </AdminFormSection>

        <AdminFormSection title={t("adminEventTerms.labels.permissions")} columns={2}>
          <AdminFormSwitchRow
            label={t("adminEventTerms.groups.dialog.canSeeAttendees")}
            checked={draft.canSeeAttendees}
            onCheckedChange={(value) => set("canSeeAttendees", value)}
          />
          <AdminFormEnumRow<GroupVisibility>
            label={t("adminEventTerms.groups.dialog.visibility")}
            hint={t("adminEventTerms.groups.dialog.visibilityHint")}
            value={draft.attendeeVisibility}
            options={GROUP_VISIBILITIES}
            labelFor={(option) => t(`adminEventTerms.visibilities.${option}`)}
            onValueChange={(value) => set("attendeeVisibility", value)}
            disabled={!draft.canSeeAttendees}
          />
          <AdminFormSwitchRow
            label={t("adminEventTerms.groups.dialog.canMeet")}
            checked={draft.canMeet}
            onCheckedChange={(value) => set("canMeet", value)}
          />
          <AdminFormSwitchRow
            label={t("adminEventTerms.groups.dialog.canChat")}
            checked={draft.canChat}
            onCheckedChange={(value) => set("canChat", value)}
          />
          <AdminFormSwitchRow
            label={t("adminEventTerms.groups.dialog.canLeadRetrieval")}
            checked={draft.canLeadRetrieval}
            onCheckedChange={(value) => set("canLeadRetrieval", value)}
          />
          <AdminFormSwitchRow
            label={t("adminEventTerms.groups.dialog.canSeeRecording")}
            checked={draft.canSeeRecording}
            onCheckedChange={(value) => set("canSeeRecording", value)}
          />
          <AdminFormSwitchRow
            label={t("adminEventTerms.groups.dialog.isDefault")}
            hint={t("adminEventTerms.groups.dialog.isDefaultHint")}
            checked={draft.isDefault}
            onCheckedChange={(value) => set("isDefault", value)}
          />
        </AdminFormSection>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventTerms.groups.dialog.cancelAction")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventTerms.groups.dialog.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
