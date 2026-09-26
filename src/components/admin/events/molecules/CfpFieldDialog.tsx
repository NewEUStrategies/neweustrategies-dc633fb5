// Molekuła: okno „Pytanie formularza zgłoszenia".
//
// KLUCZ TYLKO PRZY TWORZENIU. Odpowiedzi leżą w zgłoszeniach po kluczu, więc
// baza nie pozwala go zmienić (`key_immutable`) - pole znika z okna edycji,
// zamiast zapraszać do zmiany, której zapis i tak odbije.
//
// OPCJE WIDAĆ TYLKO PRZY PYTANIACH WYBORU. Lista opcji przy polu tekstowym
// byłaby pustą obietnicą - baza ją pominie.
import { useEffect, useRef, useState } from "react";
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
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { CFP_FIELD_TYPE_LABEL_KEYS } from "@/lib/events/adminCfpLabels";
import { CFP_FIELD_TYPES, type CfpFieldType } from "@/lib/events/cfpEnums";
import type { CfpFieldInput, CfpFieldRow } from "@/lib/events/cfpApi";
import {
  CFP_MAX_OPTIONS,
  cfpFieldDraftFromRow,
  cfpFieldDraftToInput,
  emptyCfpFieldDraft,
  emptyOptionDraft,
  isChoiceType,
  validateCfpFieldDraft,
  withLabelPl,
  type CfpFieldDraft,
  type CfpFieldDraftField,
} from "@/lib/events/cfpFieldDraft";
import { ensureAdminEventCfpI18n } from "@/lib/i18n-admin-event-cfp";

export function CfpFieldDialog({
  open,
  onOpenChange,
  eventId,
  field,
  isSaving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowe pytanie. */
  field: CfpFieldRow | null;
  isSaving: boolean;
  onSubmit: (input: CfpFieldInput) => void;
}) {
  ensureAdminEventCfpI18n();
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CfpFieldDraft>(emptyCfpFieldDraft);
  const [touched, setTouched] = useState(false);

  // Szkic odtwarzany przy KAŻDYM otwarciu (tożsamość wiersza, nie obiekt -
  // odświeżenie listy w tle nie może zamieść wpisanej pracy).
  const fieldRef = useRef(field);
  fieldRef.current = field;
  const fieldId = field === null ? null : field.id;
  useEffect(() => {
    if (!open) return;
    const row = fieldRef.current;
    setDraft(row === null ? emptyCfpFieldDraft() : cfpFieldDraftFromRow(row));
    setTouched(false);
  }, [open, fieldId]);

  const issues = validateCfpFieldDraft(draft);
  const errorFor = (name: CfpFieldDraftField): string | null => {
    if (!touched) return null;
    const found = issues.find((issue) => issue.field === name);
    return found === undefined ? null : t(found.messageKey);
  };
  const set = <K extends keyof CfpFieldDraft>(key: K, value: CfpFieldDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const setOption = (index: number, patch: Partial<CfpFieldDraft["options"][number]>) =>
    set(
      "options",
      draft.options.map((option, i) => (i === index ? { ...option, ...patch } : option)),
    );

  const submit = () => {
    setTouched(true);
    if (issues.length > 0) return;
    onSubmit(cfpFieldDraftToInput(eventId, draft));
  };

  const isNew = draft.id === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              isNew
                ? "adminEventCfp.form.dialog.createTitle"
                : "adminEventCfp.form.dialog.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventCfp.form.dialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminFormTextRow
              id="cfp-field-label-pl"
              label={t("adminEventCfp.form.dialog.labelPl")}
              value={draft.labelPl}
              maxLength={200}
              onValueChange={(value) => setDraft((previous) => withLabelPl(previous, value))}
            />
            <AdminFormTextRow
              id="cfp-field-label-en"
              label={t("adminEventCfp.form.dialog.labelEn")}
              value={draft.labelEn}
              maxLength={200}
              error={errorFor("labels")}
              onValueChange={(value) => set("labelEn", value)}
            />
          </div>
          {isNew ? (
            <AdminFormTextRow
              id="cfp-field-key"
              label={t("adminEventCfp.form.dialog.key")}
              value={draft.key}
              monospace
              maxLength={49}
              hint={t("adminEventCfp.form.dialog.keyHint")}
              error={errorFor("key")}
              onValueChange={(value) =>
                setDraft((previous) => ({ ...previous, key: value, keyTouched: true }))
              }
            />
          ) : null}
          <AdminFormEnumRow<CfpFieldType>
            id="cfp-field-type"
            label={t("adminEventCfp.form.dialog.type")}
            value={draft.fieldType}
            options={CFP_FIELD_TYPES}
            labelFor={(option) => t(CFP_FIELD_TYPE_LABEL_KEYS[option])}
            onValueChange={(value) => set("fieldType", value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminFormTextRow
              id="cfp-field-help-pl"
              label={t("adminEventCfp.form.dialog.helpPl")}
              value={draft.helpPl}
              rows={2}
              maxLength={500}
              onValueChange={(value) => set("helpPl", value)}
            />
            <AdminFormTextRow
              id="cfp-field-help-en"
              label={t("adminEventCfp.form.dialog.helpEn")}
              value={draft.helpEn}
              rows={2}
              maxLength={500}
              error={errorFor("help")}
              onValueChange={(value) => set("helpEn", value)}
            />
          </div>
          <AdminFormSwitchRow
            id="cfp-field-required"
            label={t("adminEventCfp.form.dialog.required")}
            hint={t("adminEventCfp.form.dialog.requiredHint")}
            checked={draft.isRequired}
            onCheckedChange={(checked) => set("isRequired", checked)}
          />
          <AdminFormSwitchRow
            id="cfp-field-active"
            label={t("adminEventCfp.form.dialog.active")}
            hint={t("adminEventCfp.form.dialog.activeHint")}
            checked={draft.isActive}
            onCheckedChange={(checked) => set("isActive", checked)}
          />

          {isChoiceType(draft.fieldType) ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                {t("adminEventCfp.form.dialog.options")}
              </legend>
              {draft.options.map((option, index) => (
                <div
                  key={`option-${index}`}
                  className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr_auto]"
                >
                  <AdminFormTextRow
                    id={`cfp-option-${index}-value`}
                    label={t("adminEventCfp.form.dialog.optionValue")}
                    value={option.value}
                    monospace
                    onValueChange={(value) => setOption(index, { value })}
                  />
                  <AdminFormTextRow
                    id={`cfp-option-${index}-pl`}
                    label={t("adminEventCfp.form.dialog.optionPl")}
                    value={option.labelPl}
                    onValueChange={(labelPl) => setOption(index, { labelPl })}
                  />
                  <AdminFormTextRow
                    id={`cfp-option-${index}-en`}
                    label={t("adminEventCfp.form.dialog.optionEn")}
                    value={option.labelEn}
                    onValueChange={(labelEn) => setOption(index, { labelEn })}
                  />
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        set(
                          "options",
                          draft.options.filter((_, i) => i !== index),
                        )
                      }
                    >
                      {t("adminEventCfp.list.remove")}
                    </Button>
                  </div>
                </div>
              ))}
              {errorFor("options") === null ? null : (
                <p className="text-xs text-destructive" role="alert">
                  {errorFor("options")}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={draft.options.length >= CFP_MAX_OPTIONS}
                onClick={() =>
                  set("options", [...draft.options, emptyOptionDraft(draft.options.length)])
                }
              >
                {t("adminEventCfp.form.dialog.addOption")}
              </Button>
            </fieldset>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("adminEventCfp.common.cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={isSaving}>
            {t(isSaving ? "adminEventCfp.common.saving" : "adminEventCfp.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
