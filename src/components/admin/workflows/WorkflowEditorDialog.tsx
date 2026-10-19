// Edytor przepisu „gdy X -> zrób Y": wyzwalacz (typ zdarzenia), warunek
// (containment na payloadzie) i sekwencja akcji z katalogu silnika.
// Formularz parametrów kroku jest generowany z WORKFLOW_ACTION_PARAMS -
// dodanie nowej akcji w silniku wymaga tylko wpisu w katalogu i i18n.
// Parametry z zamkniętą listą (etap) i osoby z zespołu mają własne pola
// wyboru: wpisany ręcznie uuid albo literówka w etapie kończyły się
// przebiegiem `failed` dopiero przy pierwszym zdarzeniu.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import "@/lib/i18n-admin-workflows";
import { AlertTriangle, ArrowDown, ArrowUp, ListPlus, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DOMAIN_EVENT_TYPES } from "@/lib/realtime/domainEvents";
import {
  WORKFLOW_ACTIONS,
  WORKFLOW_ACTION_PARAMS,
  isKnownEventType,
  isValidEventType,
  isWorkflowAction,
  validateWorkflowDraft,
  validateWorkflowStepParams,
  type WorkflowActionParamSpec,
  type WorkflowDraft,
  type WorkflowDraftError,
  type WorkflowStep,
  type WorkflowStepParamIssue,
} from "@/lib/admin/workflows";
import { workflowStaffUsersQueryOptions } from "@/lib/admin/workflowQueries";
import { useActionName } from "./useActionName";
import {
  CUSTOM_TRIGGER,
  applyTriggerSelection,
  defaultStep,
  emptyConditionPair,
  isCustomTriggerType,
  moveStep as moveStepIn,
  paramInputValue,
  patchConditionPair,
  removeAt,
  replaceAt,
  stepWithParam,
  triggerSelectValue,
} from "./lib/editorDraft";

interface WorkflowEditorDialogProps {
  open: boolean;
  initial: WorkflowDraft;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: WorkflowDraft) => void;
}

export function WorkflowEditorDialog({
  open,
  initial,
  saving,
  onClose,
  onSave,
}: WorkflowEditorDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<WorkflowDraft>(initial);
  const [showErrors, setShowErrors] = useState(false);

  const [customTrigger, setCustomTrigger] = useState(false);

  // Świeży snapshot draftu przy każdym otwarciu (nowy przepis lub inny
  // wiersz); tryb „inny typ zdarzenia" liczony wprost z `initial`, nie ze
  // stanu draftu - stan mógłby być jeszcze sprzed resetu (stale closure).
  useEffect(() => {
    if (open) {
      setDraft(initial);
      setShowErrors(false);
      setCustomTrigger(isCustomTriggerType(initial.triggerEventType));
    }
  }, [open, initial]);

  const errors = useMemo(() => validateWorkflowDraft(draft), [draft]);
  const errorSet = new Set<WorkflowDraftError>(showErrors ? errors : []);
  const paramIssues = useMemo(
    () => (showErrors ? validateWorkflowStepParams(draft.steps) : []),
    [showErrors, draft.steps],
  );
  const trimmedTrigger = draft.triggerEventType.trim();
  // Typ poprawny składniowo, ale spoza katalogu szyny: zapis przechodzi
  // (moduł może emitować go w przyszłości), lecz redaktor dostaje ostrzeżenie.
  const unknownTrigger =
    customTrigger && isValidEventType(trimmedTrigger) && !isKnownEventType(trimmedTrigger);

  const patch = (partial: Partial<WorkflowDraft>) => setDraft((d) => ({ ...d, ...partial }));

  const patchStep = (index: number, step: WorkflowStep) =>
    setDraft((d) => ({ ...d, steps: replaceAt(d.steps, index, step) }));

  const moveStep = (index: number, delta: -1 | 1) =>
    setDraft((d) => {
      const steps = moveStepIn(d.steps, index, delta);
      return steps === d.steps ? d : { ...d, steps: [...steps] };
    });

  const submit = () => {
    if (errors.length > 0) {
      setShowErrors(true);
      return;
    }
    onSave(draft);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {draft.id ? t("adminWorkflows.editor.titleEdit") : t("adminWorkflows.editor.titleNew")}
          </DialogTitle>
          <DialogDescription>{t("adminWorkflows.editor.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="wf-name">{t("adminWorkflows.editor.name")}</Label>
              <Input
                id="wf-name"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder={t("adminWorkflows.editor.namePlaceholder")}
                aria-invalid={errorSet.has("name")}
              />
              {errorSet.has("name") && (
                <p className="text-xs text-destructive">
                  {t("adminWorkflows.editor.validation.name")}
                </p>
              )}
            </div>
            <label className="flex items-center gap-2 pb-1 text-sm">
              <Switch
                checked={draft.enabled}
                onCheckedChange={(enabled) => patch({ enabled })}
                aria-label={t("adminWorkflows.editor.enabled")}
              />
              {t("adminWorkflows.editor.enabled")}
            </label>
          </div>

          <div className="space-y-1.5">
            <Label>{t("adminWorkflows.editor.trigger")}</Label>
            <Select
              value={triggerSelectValue(customTrigger, draft.triggerEventType)}
              onValueChange={(value) => {
                const next = applyTriggerSelection(value);
                setCustomTrigger(next.customTrigger);
                patch({ triggerEventType: next.triggerEventType });
              }}
            >
              <SelectTrigger aria-invalid={errorSet.has("trigger")}>
                <SelectValue placeholder={t("adminWorkflows.editor.trigger")} />
              </SelectTrigger>
              <SelectContent>
                {DOMAIN_EVENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    <span className="font-mono text-xs">{type}</span>
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_TRIGGER}>
                  {t("adminWorkflows.editor.triggerCustom")}
                </SelectItem>
              </SelectContent>
            </Select>
            {customTrigger && (
              <Input
                value={draft.triggerEventType}
                onChange={(e) => patch({ triggerEventType: e.target.value })}
                placeholder={t("adminWorkflows.editor.triggerCustomPlaceholder")}
                className="font-mono text-xs"
                aria-invalid={errorSet.has("trigger")}
              />
            )}
            {errorSet.has("trigger") && (
              <p className="text-xs text-destructive">
                {t("adminWorkflows.editor.validation.trigger")}
              </p>
            )}
            {unknownTrigger && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground" role="status">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("adminWorkflows.editor.triggerUnknown")}
              </p>
            )}
          </div>

          <fieldset className="space-y-2 rounded-lg border border-border/70 p-3">
            <legend className="px-1 text-sm font-medium">
              {t("adminWorkflows.editor.conditionTitle")}
            </legend>
            <p className="text-xs text-muted-foreground">
              {t("adminWorkflows.editor.conditionHint")}
            </p>
            {draft.conditionPairs.map((pair, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={pair.key}
                  onChange={(e) =>
                    patch({
                      conditionPairs: patchConditionPair(draft.conditionPairs, index, {
                        key: e.target.value,
                      }),
                    })
                  }
                  placeholder={t("adminWorkflows.editor.conditionKey")}
                  className="font-mono text-xs"
                />
                <Input
                  value={pair.value}
                  onChange={(e) =>
                    patch({
                      conditionPairs: patchConditionPair(draft.conditionPairs, index, {
                        value: e.target.value,
                      }),
                    })
                  }
                  placeholder={t("adminWorkflows.editor.conditionValue")}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => patch({ conditionPairs: removeAt(draft.conditionPairs, index) })}
                  aria-label={t("adminWorkflows.editor.removeCondition")}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}
            {errorSet.has("conditionKey") && (
              <p className="text-xs text-destructive">
                {t("adminWorkflows.editor.validation.conditionKey")}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                patch({ conditionPairs: [...draft.conditionPairs, emptyConditionPair()] })
              }
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t("adminWorkflows.editor.addCondition")}
            </Button>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-border/70 p-3">
            <legend className="px-1 text-sm font-medium">
              {t("adminWorkflows.editor.stepsTitle")}
            </legend>
            <p className="text-xs text-muted-foreground">{t("adminWorkflows.editor.stepsHint")}</p>
            {draft.steps.map((step, index) => (
              <StepEditor
                key={index}
                index={index}
                total={draft.steps.length}
                step={step}
                issues={paramIssues.filter((issue) => issue.stepIndex === index)}
                onChange={(next) => patchStep(index, next)}
                onMove={(delta) => moveStep(index, delta)}
                onRemove={() => patch({ steps: removeAt(draft.steps, index) })}
              />
            ))}
            {errorSet.has("steps") && (
              <p className="text-xs text-destructive">
                {t("adminWorkflows.editor.validation.steps")}
              </p>
            )}
            {errorSet.has("stepParams") && (
              <p className="text-xs text-destructive">
                {t("adminWorkflows.editor.validation.stepParams")}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => patch({ steps: [...draft.steps, defaultStep()] })}
            >
              <ListPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t("adminWorkflows.editor.addStep")}
            </Button>
          </fieldset>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("adminWorkflows.editor.cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {t("adminWorkflows.editor.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Komponent na poziomie modułu (nie zagnieżdżony w dialogu): zagnieżdżenie
// tworzyłoby nowy typ komponentu przy każdym renderze i gubiło fokus inputów.
function StepEditor({
  index,
  total,
  step,
  issues,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  step: WorkflowStep;
  issues: readonly WorkflowStepParamIssue[];
  onChange: (step: WorkflowStep) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const actionName = useActionName();
  const specs = WORKFLOW_ACTION_PARAMS[step.action];
  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">
          {t("adminWorkflows.editor.stepLabel", { index: index + 1 })}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label={t("adminWorkflows.editor.moveUp")}
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label={t("adminWorkflows.editor.moveDown")}
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            aria-label={t("adminWorkflows.editor.removeStep")}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <Select
        value={step.action}
        onValueChange={(action) => {
          if (!isWorkflowAction(action)) return;
          // Zmiana akcji zeruje parametry - katalogi pól są rozłączne.
          onChange({ action, params: {} });
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WORKFLOW_ACTIONS.map((action) => (
            <SelectItem key={action} value={action}>
              {actionName(action)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {t(`adminWorkflows.actions.${step.action}.description`)}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {specs.map((spec) => {
          const label = t(`adminWorkflows.params.${spec.key}`);
          const issue = issues.find((i) => i.key === spec.key);
          const fieldId = `wf-step-${index}-${spec.key}`;
          const issueId = issue ? `${fieldId}-issue` : undefined;
          const issueText = issue
            ? issue.issue === "tooLong"
              ? t("adminWorkflows.editor.paramIssue.tooLong", { max: spec.maxLength })
              : t(`adminWorkflows.editor.paramIssue.${issue.issue}`)
            : null;
          if (spec.kind === "select" || spec.kind === "staff") {
            return (
              <div key={spec.key} className="space-y-1">
                <Label htmlFor={fieldId} className="text-xs text-muted-foreground">
                  {label}
                  {spec.required && <span aria-hidden> *</span>}
                </Label>
                {spec.kind === "select" ? (
                  <OptionParamSelect
                    id={fieldId}
                    spec={spec}
                    value={paramInputValue(step.params[spec.key])}
                    invalid={Boolean(issue)}
                    describedBy={issueId}
                    onChange={(value) => onChange(stepWithParam(step, spec.key, value))}
                  />
                ) : (
                  <StaffParamSelect
                    id={fieldId}
                    required={Boolean(spec.required)}
                    value={paramInputValue(step.params[spec.key])}
                    invalid={Boolean(issue)}
                    describedBy={issueId}
                    onChange={(value) => onChange(stepWithParam(step, spec.key, value))}
                  />
                )}
                {issueText && (
                  <p id={issueId} className="text-xs text-destructive">
                    {issueText}
                  </p>
                )}
              </div>
            );
          }
          if (spec.kind === "boolean") {
            return (
              <label key={spec.key} className="flex items-center gap-2 text-sm">
                <Switch
                  checked={step.params[spec.key] === true}
                  onCheckedChange={(checked) => onChange(stepWithParam(step, spec.key, checked))}
                  aria-label={label}
                />
                {label}
              </label>
            );
          }
          // Roles: z bazy przychodzi string[], ale podczas edycji trzymamy
          // surowy CSV (string) - podział robi dopiero serializeWorkflowSteps,
          // inaczej wpisywany przecinek znikałby przy każdym renderze.
          const value = paramInputValue(step.params[spec.key]);
          return (
            <div key={spec.key} className="space-y-1">
              <Label htmlFor={fieldId} className="text-xs text-muted-foreground">
                {label}
                {spec.required && <span aria-hidden> *</span>}
              </Label>
              <Input
                id={fieldId}
                value={value}
                placeholder={spec.example}
                onChange={(e) => onChange(stepWithParam(step, spec.key, e.target.value))}
                className="h-8 text-sm"
                aria-invalid={Boolean(issue)}
                aria-required={spec.required || undefined}
                aria-describedby={issueId}
              />
              {issueText && (
                <p id={issueId} className="text-xs text-destructive">
                  {issueText}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Wartownik „brak wartości" dla Radiksowego Select (pusty string jest tam
// zarezerwowany i czyści zaznaczenie).
const EMPTY_OPTION = "__none__";

function OptionParamSelect({
  id,
  spec,
  value,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  spec: WorkflowActionParamSpec;
  value: string;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const options = spec.options ?? [];
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        className="h-8 text-sm"
        aria-invalid={invalid}
        aria-required={spec.required || undefined}
        aria-describedby={describedBy}
      >
        <SelectValue placeholder={t("adminWorkflows.editor.selectPlaceholder")} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {spec.optionGroup ? t(`adminWorkflows.options.${spec.optionGroup}.${option}`) : option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StaffParamSelect({
  id,
  required,
  value,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  required: boolean;
  value: string;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  // Lista zespołu z serwera (ta sama co picker właściciela w CRM): silnik
  // i tak odrzuca osobę spoza personelu najemcy, ale błąd przy zdarzeniu jest
  // dużo droższy niż wybór z listy przy zapisie.
  const staffQuery = useQuery(workflowStaffUsersQueryOptions());
  const staff = staffQuery.data ?? [];
  const known = value === "" || staff.some((person) => person.id === value);
  return (
    <Select
      value={value === "" ? (required ? undefined : EMPTY_OPTION) : value}
      onValueChange={(next) => onChange(next === EMPTY_OPTION ? "" : next)}
      disabled={staffQuery.isLoading}
    >
      <SelectTrigger
        id={id}
        className="h-8 text-sm"
        aria-invalid={invalid}
        aria-required={required || undefined}
        aria-describedby={describedBy}
      >
        <SelectValue
          placeholder={
            staffQuery.isLoading
              ? t("adminWorkflows.editor.staffLoading")
              : t("adminWorkflows.editor.staffPlaceholder")
          }
        />
      </SelectTrigger>
      <SelectContent>
        {!required && (
          <SelectItem value={EMPTY_OPTION}>{t("adminWorkflows.editor.none")}</SelectItem>
        )}
        {staff.map((person) => (
          <SelectItem key={person.id} value={person.id}>
            {person.label}
          </SelectItem>
        ))}
        {!known && (
          // Zapisany przepis wskazuje osobę, której nie ma już w zespole -
          // pokazujemy ją, zamiast po cichu zgubić wartość przy edycji.
          <SelectItem value={value}>
            {t("adminWorkflows.editor.staffUnknown", { id: value })}
          </SelectItem>
        )}
        {staff.length === 0 && !staffQuery.isLoading && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("adminWorkflows.editor.staffEmpty")}
          </div>
        )}
      </SelectContent>
    </Select>
  );
}
