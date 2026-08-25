// Molekuła: formularz jednego POLA formularza zapisu.
//
// KLUCZ JEST ZAMROŻONY PO ZAPISIE, bo odpowiedzi złożonych zgłoszeń leżą w JSON-ie
// pod tym kluczem. Zmiana zamieniłaby setki odpowiedzi w dane bez pytania.
//
// REGUŁA KWALIFIKUJĄCA POKAZUJE SIĘ TYLKO WŁĄCZONA. Operator i wartość widoczne
// przy wyłączonej regule sugerują, że coś już bramkuje zapisy - a nie bramkuje
// nic, i to jest najgorszy rodzaj pomyłki na formularzu, który odrzuca ludzi.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
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
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import {
  FIELD_MAX_HELP,
  FIELD_MAX_LABEL,
  FIELD_TYPES_WITH_OPTIONS,
  OPERATORS_WITHOUT_VALUE,
  emptyFieldDraft,
  fieldDraftFromRow,
  fieldDraftIssue,
  fieldDraftToInput,
  type FieldDraftField,
  type RegistrationFieldDraft,
} from "@/lib/events/registrationFieldDraft";
import {
  QUALIFY_OPERATORS,
  QUALIFY_OUTCOMES,
  REGISTRATION_FIELD_TYPES,
  type EventRegistrationFieldRow,
  type QualifyOperator,
  type QualifyOutcome,
  type RegistrationFieldInput,
  type RegistrationFieldType,
} from "@/lib/events/registrationsApi";

interface RegistrationFieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  field: EventRegistrationFieldRow | null;
  nextSortOrder: number;
  isSaving: boolean;
  onSubmit: (input: RegistrationFieldInput) => void;
}

export function RegistrationFieldDialog({
  open,
  onOpenChange,
  eventId,
  field,
  nextSortOrder,
  isSaving,
  onSubmit,
}: RegistrationFieldDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<RegistrationFieldDraft>(() => emptyFieldDraft(nextSortOrder));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(field === null ? emptyFieldDraft(nextSortOrder) : fieldDraftFromRow(field));
    setTouched(false);
  }, [open, field, nextSortOrder]);

  const issue = fieldDraftIssue(draft);
  const errorFor = (name: FieldDraftField): string | null =>
    touched && issue?.field === name ? t(`adminEventRegistration.errors.${issue.errorKey}`) : null;

  const set = <K extends keyof RegistrationFieldDraft>(key: K, value: RegistrationFieldDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const setOption = (index: number, patch: Partial<RegistrationFieldDraft["options"][number]>) =>
    setDraft((previous) => ({
      ...previous,
      options: previous.options.map((option, position) =>
        position === index ? { ...option, ...patch } : option,
      ),
    }));

  const submit = () => {
    setTouched(true);
    if (issue !== null) return;
    onSubmit(fieldDraftToInput(draft, eventId));
  };

  const isNew = draft.id === null;
  const showsOptions = FIELD_TYPES_WITH_OPTIONS.includes(draft.fieldType);
  const needsValue = !OPERATORS_WITHOUT_VALUE.includes(draft.qualifyOperator);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              isNew
                ? "adminEventRegistration.form.editor.createTitle"
                : "adminEventRegistration.form.editor.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventRegistration.form.modeHint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <AdminFormSection title={t("adminEventRegistration.form.columns.label")} columns={2}>
            <AdminFormTextRow
              label={t("adminEventRegistration.form.editor.key")}
              hint={t("adminEventRegistration.form.editor.keyHint")}
              value={draft.key}
              onValueChange={(value) => set("key", value)}
              disabled={!isNew}
              monospace
              maxLength={49}
              error={errorFor("key")}
            />
            <AdminFormEnumRow<RegistrationFieldType>
              label={t("adminEventRegistration.form.editor.type")}
              value={draft.fieldType}
              options={REGISTRATION_FIELD_TYPES}
              labelFor={(option) => t(`adminEventRegistration.fieldTypes.${option}`)}
              onValueChange={(value) => set("fieldType", value)}
              hint={t(`adminEventRegistration.fieldTypeHints.${draft.fieldType}`)}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.form.editor.labelPl")}
              value={draft.labelPl}
              onValueChange={(value) => set("labelPl", value)}
              maxLength={FIELD_MAX_LABEL}
              error={errorFor("labelPl")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.form.editor.labelEn")}
              value={draft.labelEn}
              onValueChange={(value) => set("labelEn", value)}
              maxLength={FIELD_MAX_LABEL}
              error={errorFor("labelEn")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.form.editor.helpPl")}
              hint={t("adminEventRegistration.form.editor.helpHint")}
              value={draft.helpPl}
              onValueChange={(value) => set("helpPl", value)}
              rows={2}
              maxLength={FIELD_MAX_HELP}
              error={errorFor("helpPl")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.form.editor.helpEn")}
              value={draft.helpEn}
              onValueChange={(value) => set("helpEn", value)}
              rows={2}
              maxLength={FIELD_MAX_HELP}
              error={errorFor("helpEn")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.form.editor.sortOrder")}
              value={draft.sortOrder}
              onValueChange={(value) => set("sortOrder", value)}
              inputMode="numeric"
              error={errorFor("sortOrder")}
            />
            <div className="space-y-3">
              <AdminFormSwitchRow
                label={t("adminEventRegistration.form.editor.required")}
                checked={draft.isRequired}
                onCheckedChange={(checked) => set("isRequired", checked)}
              />
              <AdminFormSwitchRow
                label={t("adminEventRegistration.form.editor.active")}
                checked={draft.isActive}
                onCheckedChange={(checked) => set("isActive", checked)}
              />
            </div>
          </AdminFormSection>

          {showsOptions ? (
            <AdminFormSection
              title={t("adminEventRegistration.form.editor.options")}
              hint={t("adminEventRegistration.form.editor.optionsHint")}
              columns={1}
            >
              <div className="space-y-3">
                {draft.options.map((option, index) => (
                  <div
                    key={`option-${index}`}
                    className="grid gap-2 rounded-md border border-border/60 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
                  >
                    <AdminFormTextRow
                      label={t("adminEventRegistration.form.editor.optionValue")}
                      value={option.value}
                      onValueChange={(value) => setOption(index, { value })}
                      monospace
                    />
                    <AdminFormTextRow
                      label={t("adminEventRegistration.form.editor.optionLabelPl")}
                      value={option.labelPl}
                      onValueChange={(labelPl) => setOption(index, { labelPl })}
                    />
                    <AdminFormTextRow
                      label={t("adminEventRegistration.form.editor.optionLabelEn")}
                      value={option.labelEn}
                      onValueChange={(labelEn) => setOption(index, { labelEn })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="self-end"
                      aria-label={t("adminEventRegistration.form.editor.removeOption")}
                      onClick={() =>
                        set(
                          "options",
                          draft.options.filter((_option, position) => position !== index),
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {errorFor("options") !== null ? (
                  <p className="text-sm text-destructive">{errorFor("options")}</p>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    set("options", [...draft.options, { value: "", labelPl: "", labelEn: "" }])
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t("adminEventRegistration.form.editor.addOption")}
                </Button>
              </div>
            </AdminFormSection>
          ) : null}

          <AdminFormSection
            title={t("adminEventRegistration.form.editor.qualifying")}
            hint={t("adminEventRegistration.form.editor.qualifyingHint")}
            columns={1}
          >
            <AdminFormSwitchRow
              label={t("adminEventRegistration.form.editor.qualifying")}
              checked={draft.isQualifying}
              onCheckedChange={(checked) => set("isQualifying", checked)}
            />
            {draft.isQualifying ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <AdminFormEnumRow<QualifyOperator>
                  label={t("adminEventRegistration.form.editor.operator")}
                  value={draft.qualifyOperator}
                  options={QUALIFY_OPERATORS}
                  labelFor={(option) => t(`adminEventRegistration.qualifyOperators.${option}`)}
                  onValueChange={(value) => set("qualifyOperator", value)}
                />
                {needsValue ? (
                  <AdminFormTextRow
                    label={t("adminEventRegistration.form.editor.value")}
                    hint={t("adminEventRegistration.form.editor.valueHint")}
                    value={draft.qualifyValue}
                    onValueChange={(value) => set("qualifyValue", value)}
                    rows={2}
                    error={errorFor("qualifyValue")}
                  />
                ) : null}
                <AdminFormEnumRow<QualifyOutcome>
                  label={t("adminEventRegistration.form.editor.outcome")}
                  value={draft.qualifyOutcome}
                  options={QUALIFY_OUTCOMES}
                  labelFor={(option) => t(`adminEventRegistration.qualifyOutcomes.${option}`)}
                  onValueChange={(value) => set("qualifyOutcome", value)}
                  hint={t(`adminEventRegistration.qualifyOutcomeHints.${draft.qualifyOutcome}`)}
                />
                <p className="self-end text-xs text-muted-foreground">
                  {t("adminEventRegistration.form.editor.outcomePrecedence")}
                </p>
              </div>
            ) : null}
            {errorFor("qualifyOperator") !== null ? (
              <p className="text-sm text-destructive">{errorFor("qualifyOperator")}</p>
            ) : null}
          </AdminFormSection>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventRegistration.form.editor.cancelAction")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventRegistration.form.editor.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
