// Molekula: formularz jednej ZGODY wydarzenia.
//
// PODNIESIENIE WERSJI JEST OSOBNYM, JAWNYM PRZELACZNIKIEM. Automat przy kazdej
// poprawce tresci kazalby wszystkim uczestnikom akceptowac zgode ponownie - a
// wtedy redakcja przestalaby poprawiac literowki. Przelacznik startuje wylaczony
// za kazdym otwarciem formularza.
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
  TERMS_MAX_BODY,
  TERMS_MAX_NAME,
  TERMS_MAX_URL,
  emptyTermDraft,
  termDraftFromRow,
  termDraftToInput,
  validateTermDraft,
  type TermDraft,
} from "@/lib/events/termsGroupsDraft";
import {
  TERM_DISPLAYS,
  type EventTermRow,
  type TermDisplay,
  type TermInput,
} from "@/lib/events/termsGroupsApi";

interface EventTermDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowa zgoda. */
  term: EventTermRow | null;
  nextSortOrder: number;
  isSaving: boolean;
  onSubmit: (input: TermInput) => void;
}

export function EventTermDialog({
  open,
  onOpenChange,
  eventId,
  term,
  nextSortOrder,
  isSaving,
  onSubmit,
}: EventTermDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<TermDraft>(() => emptyTermDraft(nextSortOrder));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(term === null ? emptyTermDraft(nextSortOrder) : termDraftFromRow(term));
    setTouched(false);
  }, [open, term, nextSortOrder]);

  const errors = validateTermDraft(draft);
  const errorFor = (field: keyof TermDraft): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const set = <K extends keyof TermDraft>(key: K, value: TermDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(termDraftToInput(draft, eventId));
  };

  const isNew = draft.id === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              isNew
                ? "adminEventTerms.terms.dialog.createTitle"
                : "adminEventTerms.terms.dialog.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventTerms.terms.subtitle")}</DialogDescription>
        </DialogHeader>

        <AdminFormSection title={t("adminEventTerms.terms.title")} columns={2}>
          <AdminFormTextRow
            label={t("adminEventTerms.terms.dialog.key")}
            hint={t("adminEventTerms.terms.dialog.keyHint")}
            value={draft.key}
            onValueChange={(value) => set("key", value)}
            disabled={!isNew}
            monospace
            maxLength={49}
            error={errorFor("key")}
          />
          <AdminFormEnumRow<TermDisplay>
            label={t("adminEventTerms.terms.dialog.display")}
            value={draft.display}
            options={TERM_DISPLAYS}
            labelFor={(option) => t(`adminEventTerms.displays.${option}`)}
            onValueChange={(value) => set("display", value)}
          />
          <AdminFormTextRow
            label={t("adminEventTerms.terms.dialog.labelPl")}
            value={draft.labelPl}
            onValueChange={(value) => set("labelPl", value)}
            maxLength={TERMS_MAX_NAME}
            error={errorFor("labelPl")}
          />
          <AdminFormTextRow
            label={t("adminEventTerms.terms.dialog.labelEn")}
            value={draft.labelEn}
            onValueChange={(value) => set("labelEn", value)}
            maxLength={TERMS_MAX_NAME}
          />
          <AdminFormTextRow
            label={t("adminEventTerms.terms.dialog.bodyPl")}
            value={draft.bodyPl}
            onValueChange={(value) => set("bodyPl", value)}
            maxLength={TERMS_MAX_BODY}
            rows={5}
          />
          <AdminFormTextRow
            label={t("adminEventTerms.terms.dialog.bodyEn")}
            value={draft.bodyEn}
            onValueChange={(value) => set("bodyEn", value)}
            maxLength={TERMS_MAX_BODY}
            rows={5}
          />
          <AdminFormTextRow
            label={t("adminEventTerms.terms.dialog.externalUrl")}
            hint={t("adminEventTerms.terms.dialog.externalUrlHint")}
            value={draft.externalUrl}
            onValueChange={(value) => set("externalUrl", value)}
            maxLength={TERMS_MAX_URL}
            placeholder="https://"
            error={errorFor("externalUrl")}
          />
          <AdminFormTextRow
            label={t("adminEventTerms.terms.dialog.sortOrder")}
            value={draft.sortOrder}
            onValueChange={(value) => set("sortOrder", value)}
            inputMode="numeric"
            error={errorFor("sortOrder")}
          />
          <AdminFormSwitchRow
            label={t("adminEventTerms.terms.dialog.isRequired")}
            checked={draft.isRequired}
            onCheckedChange={(value) => set("isRequired", value)}
          />
          <AdminFormSwitchRow
            label={t("adminEventTerms.terms.dialog.isActive")}
            checked={draft.isActive}
            onCheckedChange={(value) => set("isActive", value)}
          />
          {isNew ? null : (
            <AdminFormSwitchRow
              label={t("adminEventTerms.terms.dialog.bumpVersion")}
              hint={t("adminEventTerms.terms.dialog.bumpVersionHint")}
              checked={draft.bumpVersion}
              onCheckedChange={(value) => set("bumpVersion", value)}
            />
          )}
        </AdminFormSection>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventTerms.terms.dialog.cancelAction")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventTerms.terms.dialog.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
