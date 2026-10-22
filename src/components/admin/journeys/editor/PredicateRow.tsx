// Warunki ścieżki (S8, SPEC §6.3): wiersz warunku `if_else` i filtra wejścia
// (14 rodzajów z `predicates.ts` S5) oraz WSPÓLNE POLA arkuszy edytora
// (panel kroku, wyzwalacz, ustawienia) - ten moduł jest ich liściem, więc
// arkusze importują pola stąd, a nie od siebie nawzajem (bez cykli).
//
// ODRZUCENIE, NIE PRZYCIĘCIE (AGENTS). Każde pole tekstowe i liczbowe trzyma
// WŁASNY bufor napisu: wartość spoza limitu (za długi tag, 0 dni czekania,
// lista ponad limit) zostaje w polu z komunikatem i licznikiem, a do szkicu
// idzie dopiero wartość, którą przyjmie walidator grafu i SQL. Nic nie jest
// ucinane - pola nie mają `maxLength`, bo przeglądarka ucięłaby wklejony tekst
// po cichu. Limity czytamy z `JOURNEY_LIMITS` i schematów S5, nie z kopii.
//
// BUFOR A COFNIJ. Pole porównuje wartość z sesji z ostatnią, którą samo
// oddało: ta sama -> zostawia napis (spacja na końcu, „05”), inna -> to zmiana
// z zewnątrz (cofnij, ponów, wersja z innej karty) i napis wraca do wartości
// szkicu.
//
// LISTA WARUNKÓW TRZYMA WIERSZE LOKALNIE. Zmiana rodzaju warunku daje wiersz
// jeszcze niekompletny („Ma tag” bez tagu); lista oddaje warunki do szkicu
// dopiero wtedy, gdy KAŻDY wiersz przechodzi `PredicateSchema`, a warunki
// otwarcia i kliknięcia wskazują e-mail z listy dozwolonych (przodek kroku -
// `predicate_not_ancestor_email`).
//
// POMIAR ZA ZGODĄ (I9d-Y2). Warunki otwarcia i kliknięcia mają stałą notkę:
// odbiorca bez zgody na pomiar nie ma piksela ani linków z identyfikatorem,
// więc NIGDY nie spełni warunku i trafi do gałęzi „nie”, choćby przeczytał
// mail. To nie błąd grafu (walidator go nie zgłasza) - świadoma decyzja
// redakcji, którą notka ma umożliwić.
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlatformSelect } from "@/components/ui/platform-select";
import { Textarea } from "@/components/ui/textarea";
import { stableStringify } from "@/lib/admin/journeys/hash";
import type { JourneyEmailContentDto } from "@/lib/admin/journeys/journeyEditor.functions";
import { DEFAULT_WAIT_EVENT } from "@/lib/admin/journeys/ops";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
import { LeadBandSchema } from "@/lib/crm/leadListSpec";
import { LIFECYCLE_STAGES } from "@/lib/crm/lifecycle";
import "@/lib/i18n-admin-crm-lifecycle";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n } from "@/lib/i18n-admin-journeys-steps";
import { ensureI18n as ensureMeasurementHintI18n } from "@/lib/i18n-admin-measurement-hint";
import type { JourneyGraph } from "@/lib/journeys/graph";
import { journeyLabelKey, journeyTriggerLabelKey } from "@/lib/journeys/labels";
import {
  CRM_STAGES,
  JOURNEY_PREDICATE_KINDS,
  PREDICATE_SUBSCRIPTION_STATUSES,
  PredicateSchema,
  isHistoryPredicate,
  type JourneyPredicate,
  type JourneyPredicateKind,
} from "@/lib/journeys/predicates";
import {
  JOURNEY_TRIGGERS,
  TriggerConditionError,
  buildTriggerCondition,
  journeyTrigger,
  type TriggerConditionField,
  type TriggerGroup,
} from "@/lib/journeys/triggers";

// ── Pola wspólne ────────────────────────────────────────────────────────────

/** Błąd pola: klucz słownika + wartości do interpolacji. */
export interface JourneyFieldError {
  key: string;
  values?: Record<string, unknown>;
}

/** `aria-describedby` z identyfikatorów, które faktycznie są na ekranie. */
export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter((id): id is string => typeof id === "string" && id !== "");
  return list.length > 0 ? list.join(" ") : undefined;
}

export interface SheetFieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  counter?: string;
  children: ReactNode;
}

/**
 * Etykieta, kontrolka i pod nią podpowiedź, błąd i licznik - identyfikatory
 * `${id}-hint`, `${id}-error`, `${id}-counter` wskazuje `aria-describedby`
 * kontrolki (`describedBy`).
 */
export function SheetField({ id, label, hint, error, counter, children }: SheetFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      {children}
      {hint || error || counter ? (
        <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
          <div className="min-w-0 space-y-0.5">
            {hint ? (
              <p id={`${id}-hint`} className="text-muted-foreground">
                {hint}
              </p>
            ) : null}
            {error ? (
              <p id={`${id}-error`} className="text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          {counter ? (
            <span id={`${id}-counter`} className="shrink-0 tabular-nums text-muted-foreground">
              {counter}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Bufor napisu pola nad wartością szkicu (patrz nagłówek „Bufor a cofnij”).
 * `accept(v)` zapamiętuje wartość oddaną do szkicu, żeby jej powrót z sesji
 * nie nadpisał napisu, który właśnie piszesz.
 */
export function useFieldText<T>(
  value: T,
  format: (value: T) => string,
): [string, (text: string) => void, (accepted: T) => void] {
  const key = stableStringify(value ?? null);
  const [state, setState] = useState(() => ({ key, text: format(value) }));
  const acceptedRef = useRef<string | null>(null);
  let current = state;
  if (state.key !== key) {
    // Wartość wróciła z sesji: nasza (zostaw napis) albo z zewnątrz (pokaż ją).
    current =
      acceptedRef.current === key ? { key, text: state.text } : { key, text: format(value) };
    acceptedRef.current = null;
    setState(current);
  }
  const setText = useCallback((text: string) => setState((s) => ({ ...s, text })), []);
  const accept = useCallback((accepted: T) => {
    acceptedRef.current = stableStringify(accepted ?? null);
  }, []);
  return [current.text, setText, accept];
}

/**
 * Bufor całego formularza nad wartością szkicu - ta sama zasada co
 * `useFieldText`, dla stanu, który bywa chwilowo niekompletny (wiersze listy
 * warunków, tryb „wybrana osoba” bez osoby).
 */
export function useFormBuffer<F>(
  source: unknown,
  init: () => F,
): { form: F; setForm: (next: F) => void; markCommitted: (value: unknown) => void } {
  const key = stableStringify(source ?? null);
  const [state, setState] = useState(() => ({ key, form: init() }));
  const committedRef = useRef<string | null>(null);
  let current = state;
  if (state.key !== key) {
    current = committedRef.current === key ? { key, form: state.form } : { key, form: init() };
    committedRef.current = null;
    setState(current);
  }
  const setForm = useCallback((form: F) => setState((s) => ({ ...s, form })), []);
  const markCommitted = useCallback((value: unknown) => {
    committedRef.current = stableStringify(value ?? null);
  }, []);
  return { form: current.form, setForm, markCommitted };
}

/** Długość liczona jak walidator (`z.string().trim()`): po przycięciu brzegów. */
export function textFieldError(
  text: string,
  limits: { min?: number; max: number; pattern?: RegExp; patternKey?: string },
): JourneyFieldError | null {
  const trimmed = text.trim();
  const min = limits.min ?? 0;
  if (trimmed.length < min) return { key: "adminJourneys.sheetField.error.required" };
  if (trimmed.length > limits.max) {
    return { key: "adminJourneys.sheetField.error.tooLong", values: { max: limits.max } };
  }
  if (limits.pattern && trimmed !== "" && !limits.pattern.test(trimmed)) {
    return { key: limits.patternKey ?? "adminJourneys.sheetField.error.pattern" };
  }
  return null;
}

/** Liczba całkowita z zakresu; pusta = `null` (tylko pole opcjonalne). */
export function parseIntField(
  text: string,
  limits: { min: number; max: number; optional?: boolean },
): { value: number | null; error: JourneyFieldError | null } {
  const trimmed = text.trim();
  if (trimmed === "") {
    return limits.optional
      ? { value: null, error: null }
      : { value: null, error: { key: "adminJourneys.sheetField.error.required" } };
  }
  const value = /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < limits.min || value > limits.max) {
    return {
      value: null,
      error: {
        key: "adminJourneys.sheetField.error.range",
        values: { min: limits.min, max: limits.max },
      },
    };
  }
  return { value, error: null };
}

/** Lista „a, b, c” -> elementy bez pustych (przecinek rozdziela wartości). */
export function parseListText(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

export function listFieldError(
  items: readonly string[],
  limits: { min: number; max: number; itemMax: number; pattern?: RegExp },
): JourneyFieldError | null {
  if (items.length < limits.min || items.length > limits.max) {
    return {
      key: "adminJourneys.sheetField.error.listCount",
      values: { min: limits.min, max: limits.max },
    };
  }
  if (items.some((item) => item.length > limits.itemMax)) {
    return { key: "adminJourneys.sheetField.error.listItem", values: { max: limits.itemMax } };
  }
  if (limits.pattern && items.some((item) => !limits.pattern?.test(item))) {
    return { key: "adminJourneys.sheetField.error.pattern" };
  }
  return null;
}

function useFieldTranslate() {
  const { t } = useTranslation();
  return {
    t,
    errorText: (error: JourneyFieldError | null | undefined): string | null =>
      error ? t(error.key, error.values) : null,
  };
}

export interface BufferedTextFieldProps {
  id: string;
  label: string;
  hint?: string;
  /** Wartość ze szkicu (`""` = brak). */
  value: string;
  min?: number;
  max: number;
  pattern?: RegExp;
  patternKey?: string;
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
  disabled?: boolean;
  /** Błąd spoza pola (np. warunek wyzwalacza odrzucony przez katalog). */
  externalError?: string | null;
  /** Wartość przycięta, przyjęta przez limity pola. */
  onCommit: (value: string) => void;
}

/** Pole tekstowe z licznikiem = limit i odrzuceniem wartości spoza niego. */
export function BufferedTextField(props: BufferedTextFieldProps) {
  const { id, label, hint, value, min = 0, max, multiline, rows = 3, mono, disabled } = props;
  const { t, errorText } = useFieldTranslate();
  const [text, setText, accept] = useFieldText(value, (v) => v);
  const error =
    errorText(
      textFieldError(text, { min, max, pattern: props.pattern, patternKey: props.patternKey }),
    ) ??
    props.externalError ??
    null;
  const counter = t("adminJourneys.common.counter", { count: text.trim().length, max });
  const onChange = (next: string) => {
    setText(next);
    if (textFieldError(next, { min, max, pattern: props.pattern, patternKey: props.patternKey }))
      return;
    const trimmed = next.trim();
    accept(trimmed);
    if (trimmed !== value) props.onCommit(trimmed);
  };
  const common = {
    id,
    value: text,
    disabled,
    required: min > 0,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy(hint && `${id}-hint`, error && `${id}-error`, `${id}-counter`),
  } as const;
  return (
    <SheetField id={id} label={label} hint={hint} error={error} counter={counter}>
      {multiline ? (
        <Textarea {...common} rows={rows} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input
          {...common}
          className={mono ? "font-mono" : undefined}
          spellCheck={mono ? false : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </SheetField>
  );
}

export interface BufferedIntFieldProps {
  id: string;
  label: string;
  hint?: string;
  value: number | null;
  min: number;
  max: number;
  optional?: boolean;
  disabled?: boolean;
  onCommit: (value: number | null) => void;
}

/** Liczba całkowita z zakresu limitów; poza zakresem - komunikat, bez zapisu. */
export function BufferedIntField(props: BufferedIntFieldProps) {
  const { id, label, hint, value, min, max, optional, disabled } = props;
  const { errorText } = useFieldTranslate();
  const [text, setText, accept] = useFieldText(value, (v) => (v === null ? "" : String(v)));
  const error = errorText(parseIntField(text, { min, max, optional }).error);
  return (
    <SheetField id={id} label={label} hint={hint} error={error}>
      <Input
        id={id}
        inputMode="numeric"
        value={text}
        disabled={disabled}
        required={!optional}
        className="tabular-nums"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-error`)}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = parseIntField(event.target.value, { min, max, optional });
          if (parsed.error) return;
          accept(parsed.value);
          if (parsed.value !== value) props.onCommit(parsed.value);
        }}
      />
    </SheetField>
  );
}

export interface BufferedListFieldProps {
  id: string;
  label: string;
  hint?: string;
  value: readonly string[];
  min: number;
  max: number;
  itemMax: number;
  pattern?: RegExp;
  disabled?: boolean;
  onCommit: (values: string[]) => void;
}

/** Lista wartości rozdzielonych przecinkami (warstwy, statusy, wartości pola). */
export function BufferedListField(props: BufferedListFieldProps) {
  const { id, label, hint, value, min, max, itemMax, pattern, disabled } = props;
  const { errorText } = useFieldTranslate();
  const [text, setText, accept] = useFieldText<readonly string[]>(value, (v) => v.join(", "));
  const error = errorText(listFieldError(parseListText(text), { min, max, itemMax, pattern }));
  return (
    <SheetField id={id} label={label} hint={hint} error={error}>
      <Input
        id={id}
        value={text}
        disabled={disabled}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-error`)}
        onChange={(event) => {
          setText(event.target.value);
          const items = parseListText(event.target.value);
          if (listFieldError(items, { min, max, itemMax, pattern })) return;
          accept(items);
          if (stableStringify(items) !== stableStringify(value)) props.onCommit(items);
        }}
      />
    </SheetField>
  );
}

export interface CheckGroupOption {
  value: string;
  label: string;
}

/** Wybór wielu wartości (pola wyboru w `fieldset` z legendą; cel ≥ 24 px). */
export function CheckGroup({
  id,
  legend,
  options,
  value,
  disabled,
  error,
  onChange,
}: {
  id: string;
  legend: string;
  options: readonly CheckGroupOption[];
  value: readonly string[];
  disabled?: boolean;
  error?: string | null;
  onChange: (next: string[]) => void;
}) {
  // Wartość spoza listy (np. zapisana przed zmianą katalogu) zostaje widoczna,
  // żeby można ją było świadomie odznaczyć.
  const extra = value
    .filter((v) => !options.some((o) => o.value === v))
    .map((v) => ({ value: v, label: v }));
  const all = [...options, ...extra];
  return (
    <fieldset
      className="space-y-1"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="text-xs font-medium">{legend}</legend>
      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        {all.map((option) => {
          const optionId = `${id}-${option.value}`;
          const checked = value.includes(option.value);
          return (
            <div key={option.value} className="flex min-h-6 items-center gap-2">
              <Checkbox
                id={optionId}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(state) => {
                  const on = state === true;
                  onChange(
                    on
                      ? [...value, option.value]
                      : value.filter((selected) => selected !== option.value),
                  );
                }}
              />
              <Label htmlFor={optionId} className="cursor-pointer text-sm font-normal">
                {option.label}
              </Label>
            </div>
          );
        })}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

// ── Wyzwalacze i warunki zdarzeń ────────────────────────────────────────────

const TRIGGER_GROUPS: readonly TriggerGroup[] = [
  ...new Set(JOURNEY_TRIGGERS.map((trigger) => trigger.group)),
];

export interface TriggerEventSelectProps {
  id: string;
  value: string;
  disabled?: boolean;
  invalid?: boolean;
  ariaDescribedBy?: string;
  /** Pozycja „brak” (`value=""`) - np. „Bez celu”. */
  noneLabel?: string;
  /** Zdarzenia, przy których ścieżka nie wysyła maili, są niedostępne (graf ma mail). */
  emailBlocked?: boolean;
  onChange: (eventType: string) => void;
}

/** Katalog zdarzeń S5 pogrupowany jak w tworzeniu ścieżki (`JourneyCreateDialog`). */
export function TriggerEventSelect(props: TriggerEventSelectProps) {
  ensureJourneysI18n();
  const { t } = useTranslation();
  return (
    <PlatformSelect
      id={props.id}
      value={props.value}
      disabled={props.disabled}
      aria-invalid={props.invalid ? true : undefined}
      aria-describedby={props.ariaDescribedBy}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.noneLabel !== undefined ? <option value="">{props.noneLabel}</option> : null}
      {TRIGGER_GROUPS.map((group) => (
        <optgroup key={group} label={t(journeyLabelKey("triggerGroup", group))}>
          {JOURNEY_TRIGGERS.filter((def) => def.group === group).map((def) => (
            <option
              key={def.eventType}
              value={def.eventType}
              disabled={props.emailBlocked === true && def.emailForbidden === true}
            >
              {t(journeyTriggerLabelKey(def.eventType))}
            </option>
          ))}
        </optgroup>
      ))}
    </PlatformSelect>
  );
}

/** Etykieta pola warunku (klucz ładunku zdarzenia). */
export function conditionFieldLabelKey(key: string): string {
  return `adminJourneys.sheetField.condition.${key}`;
}

const SUBSCRIPTION_STATUS_KEYS: Readonly<Record<string, string>> = {
  trialing: "adminJourneys.sheetField.value.subscription.trialing",
  active: "adminJourneys.sheetField.value.subscription.active",
  past_due: "adminJourneys.sheetField.value.subscription.past_due",
  canceled: "adminJourneys.sheetField.value.subscription.canceled",
  unpaid: "adminJourneys.sheetField.value.subscription.unpaid",
  incomplete: "adminJourneys.sheetField.value.subscription.incomplete",
};

/**
 * Klucz etykiety wartości pola warunku. Etapy CRM czytamy ze słownika CRM
 * (ten sam napis co karta kontaktu); źródła rejestracji i powody paywalla mają
 * kopię w `sheetField.value` ŚWIADOMIE - słownik lejka (~21 KB) wszedłby do
 * chunku edytora dla 16 etykiet (budżet D-08). `null` = wartość bez etykiety.
 */
export function conditionValueLabelKey(
  eventType: string,
  key: string,
  value: string,
): string | null {
  if (key === "stage" || key === "new_stage" || key === "old_stage") {
    return `adminCrm.lifecycle.crmStages.${value}`;
  }
  if (eventType === "crm_lead.lifecycle_changed.v1" && (key === "to" || key === "from")) {
    return `adminCrm.lifecycle.stages.${value}`;
  }
  if (key === "signup_source") return `adminJourneys.sheetField.value.signupSource.${value}`;
  if (eventType === "paywall.hit.v1" && key === "reason") {
    return `adminJourneys.sheetField.value.paywallReason.${value}`;
  }
  if (key === "new_status" || key === "old_status") return SUBSCRIPTION_STATUS_KEYS[value] ?? null;
  const group: Readonly<Record<string, string>> = {
    language: "language",
    kind: "checkoutKind",
    entity_type: "entityType",
    outcome: "retentionOutcome",
    by: "cancelledBy",
  };
  if (group[key]) return `adminJourneys.sheetField.value.${group[key]}.${value}`;
  if (eventType === "subscription.expired.v1" && key === "reason") {
    return `adminJourneys.sheetField.value.expiredReason.${value}`;
  }
  if (key === "status") {
    return eventType === "club_application.decided.v1"
      ? `adminJourneys.sheetField.value.applicationStatus.${value}`
      : `adminJourneys.sheetField.value.registrationStatus.${value}`;
  }
  return null;
}

type ConditionRecord = Record<string, string | number | boolean>;

export interface ConditionFieldsProps {
  idPrefix: string;
  eventType: string;
  value: Readonly<ConditionRecord> | undefined;
  disabled?: boolean;
  /** Warunek zbudowany przez `buildTriggerCondition` (pusty = każde zdarzenie typu). */
  onCommit: (condition: ConditionRecord) => void;
}

/**
 * Pola warunku zdarzenia (`payload @> condition`) z katalogu wyzwalaczy:
 * wybór z opcji, tak/nie albo tekst ≤ 200. Warunek składa `buildTriggerCondition`
 * - pole spoza katalogu albo wartość spoza opcji to błąd przy polu, nie
 * cichy warunek, który nigdy nikogo nie zapisze.
 */
export function ConditionFields(props: ConditionFieldsProps) {
  ensureI18n();
  const { t } = useTranslation();
  const { idPrefix, eventType, disabled } = props;
  const fields = journeyTrigger(eventType)?.conditionFields ?? [];
  const value: ConditionRecord = { ...(props.value ?? {}) };
  const [failure, setFailure] = useState<string | null>(null);

  const commit = (key: string, raw: unknown) => {
    const next: Record<string, unknown> = { ...value, [key]: raw };
    try {
      const condition = buildTriggerCondition(eventType, next);
      setFailure(null);
      props.onCommit(condition);
    } catch (error) {
      if (!(error instanceof TriggerConditionError)) throw error;
      setFailure(error.field);
    }
  };

  if (fields.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{t("adminJourneys.sheetField.conditionNone")}</p>
    );
  }
  const failureText = (key: string) =>
    failure === key
      ? t("adminJourneys.sheetField.error.condition", { field: t(conditionFieldLabelKey(key)) })
      : null;

  return (
    <div className="space-y-3">
      {fields.map((field: TriggerConditionField) => {
        const id = `${idPrefix}-${field.key}`;
        const label = t(conditionFieldLabelKey(field.key));
        const current = value[field.key];
        if (field.type === "string") {
          return (
            <BufferedTextField
              key={field.key}
              id={id}
              label={label}
              value={current === undefined ? "" : String(current)}
              max={200}
              disabled={disabled}
              externalError={failureText(field.key)}
              onCommit={(text) => commit(field.key, text)}
            />
          );
        }
        const error = failureText(field.key);
        const selected =
          field.type === "boolean" ? (current === undefined ? "" : String(current)) : current;
        return (
          <SheetField key={field.key} id={id} label={label} error={error}>
            <PlatformSelect
              id={id}
              value={selected === undefined ? "" : String(selected)}
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy(error && `${id}-error`)}
              onChange={(event) => {
                const raw = event.target.value;
                commit(
                  field.key,
                  field.type === "boolean" ? (raw === "" ? "" : raw === "true") : raw,
                );
              }}
            >
              <option value="">{t("adminJourneys.sheetField.any")}</option>
              {field.type === "boolean" ? (
                <>
                  <option value="true">{t("adminJourneys.sheetField.yes")}</option>
                  <option value="false">{t("adminJourneys.sheetField.no")}</option>
                </>
              ) : (
                (field.options ?? []).map((option) => {
                  const labelKey = conditionValueLabelKey(eventType, field.key, option);
                  return (
                    <option key={option} value={option}>
                      {labelKey ? t(labelKey) : option}
                    </option>
                  );
                })
              )}
            </PlatformSelect>
          </SheetField>
        );
      })}
    </div>
  );
}

// ── Wiersz warunku ──────────────────────────────────────────────────────────

/** E-mail, na który może wskazywać warunek otwarcia/kliknięcia. */
export interface PredicateEmailOption {
  id: string;
  label: string;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Pozycje e-maili do warunku: numer kroku i temat wariantu A (PL). Kolejność
 * = kolejność kroków na kanwie i w liście (numeracja z `viewModel`).
 */
export function emailNodeOptions(
  t: Translate,
  graph: JourneyGraph,
  contents: readonly Pick<JourneyEmailContentDto, "nodeId" | "variant" | "subjectPl">[],
  allowed?: ReadonlySet<string>,
): PredicateEmailOption[] {
  const view = buildJourneyView(graph);
  return view.order
    .map((id) => view.nodes.get(id))
    .filter(
      (node): node is NonNullable<typeof node> =>
        node !== undefined && node.type === "send_email" && (allowed?.has(node.id) ?? true),
    )
    .map((node) => {
      const subject = contents
        .find((c) => c.nodeId === node.id && c.variant === "A")
        ?.subjectPl.trim();
      const number = node.number || "-";
      return {
        id: node.id,
        label: subject
          ? t("adminJourneys.predicateRow.emailOption", { number, subject })
          : t("adminJourneys.predicateRow.emailOptionNoSubject", { number }),
      };
    });
}

/** Wiersz w trakcie edycji - może być chwilowo niekompletny (patrz nagłówek). */
export type PredicateDraft = { kind: JourneyPredicateKind } & Record<string, unknown>;

export interface PredicateContext {
  emailNodes: readonly PredicateEmailOption[];
  triggerEventType: string | null;
}

const EMAIL_KINDS: readonly JourneyPredicateKind[] = ["email_opened", "email_clicked"];
/** Pasma oceny leada - lista CRM (`score_band`), nie kopia. */
const SCORE_BANDS = LeadBandSchema.options;
const PLAN_OPS = ["has_paid", "none", "tier_at_least", "tier_in"] as const;
const SHORT_TEXT_MAX = 64;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Godziny „w ciągu” warunku otwarcia/kliknięcia (`WITHIN_HOURS` w predicates.ts). */
const WITHIN_HOURS_MAX = 8760;

/** Klucze ładunku wyzwalacza, po których wolno warunkować (`trigger_field`). */
function triggerPayloadKeys(triggerEventType: string | null): readonly string[] {
  return triggerEventType ? (journeyTrigger(triggerEventType)?.payloadKeys ?? []) : [];
}

/**
 * Wiersz startowy rodzaju. Wartości do wybrania (etapy, statusy, tag) są
 * puste - wiersz czeka na wybór administratora, zamiast zgadywać za niego.
 */
export function defaultPredicateDraft(
  kind: JourneyPredicateKind,
  context: PredicateContext,
): PredicateDraft {
  switch (kind) {
    case "email_opened":
    case "email_clicked":
      return { kind, nodeId: context.emailNodes[0]?.id ?? "" };
    case "plan":
      return { kind, op: "has_paid" };
    case "consent":
      return { kind, marketing: true };
    case "has_tag":
      return { kind, tag: "" };
    case "event_since_enrollment":
      return { kind, eventType: DEFAULT_WAIT_EVENT };
    case "club_member":
    case "event_registered":
      return { kind };
    case "trigger_field":
      return {
        kind,
        key: triggerPayloadKeys(context.triggerEventType)[0] ?? "",
        op: "in",
        values: [],
      };
    default:
      return { kind, in: [] };
  }
}

/**
 * Błąd wiersza: kształt (`PredicateSchema`) albo e-mail spoza dozwolonych.
 * `null` = wiersz gotowy do szkicu.
 */
export function predicateDraftIssue(
  draft: PredicateDraft,
  context: PredicateContext,
): JourneyFieldError | null {
  if (EMAIL_KINDS.includes(draft.kind)) {
    const ref = typeof draft.nodeId === "string" ? draft.nodeId : "";
    if (!context.emailNodes.some((option) => option.id === ref)) {
      return { key: journeyLabelKey("graphIssue", "predicate_not_ancestor_email") };
    }
  }
  return PredicateSchema.safeParse(draft).success
    ? null
    : { key: "adminJourneys.predicateRow.incomplete" };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export interface PredicateRowProps {
  id: string;
  index: number;
  draft: PredicateDraft;
  context: PredicateContext;
  disabled?: boolean;
  removeDisabled?: boolean;
  onChange: (next: PredicateDraft) => void;
  onRemove: () => void;
}

/** Jeden warunek: rodzaj + pola rodzaju (parametry z `PredicateSchema`). */
export function PredicateRow(props: PredicateRowProps) {
  ensureJourneysI18n();
  ensureListI18n();
  ensureI18n();
  const { t } = useTranslation();
  const { id, index, draft, context, disabled } = props;
  const set = (patch: Record<string, unknown>) => {
    const next: PredicateDraft = { ...draft, ...patch };
    // `undefined` = pole opcjonalne wyczyszczone (`.strict()` nie zna `null`).
    for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key];
    props.onChange(next);
  };
  const issue = predicateDraftIssue(draft, context);
  const kindId = `${id}-kind`;
  const noEmails = context.emailNodes.length === 0;
  const number = index + 1;

  return (
    <fieldset
      className="space-y-3 rounded-[6px] border border-border p-3"
      data-testid="journey-predicate-row"
      data-kind={draft.kind}
    >
      <legend className="px-1 text-xs font-medium">
        {t("adminJourneys.predicateRow.legend", { number })}
      </legend>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <SheetField
            id={kindId}
            label={t("adminJourneys.predicateRow.kind")}
            hint={
              noEmails && !EMAIL_KINDS.includes(draft.kind)
                ? t("adminJourneys.predicateRow.noEmails")
                : undefined
            }
          >
            <PlatformSelect
              id={kindId}
              value={draft.kind}
              disabled={disabled}
              aria-describedby={describedBy(
                noEmails && !EMAIL_KINDS.includes(draft.kind) && `${kindId}-hint`,
              )}
              onChange={(event) =>
                props.onChange(
                  defaultPredicateDraft(event.target.value as JourneyPredicateKind, context),
                )
              }
            >
              {JOURNEY_PREDICATE_KINDS.map((kind) => (
                <option
                  key={kind}
                  value={kind}
                  disabled={EMAIL_KINDS.includes(kind) && noEmails && draft.kind !== kind}
                >
                  {t(journeyLabelKey("predicate", kind))}
                </option>
              ))}
            </PlatformSelect>
          </SheetField>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          disabled={disabled || props.removeDisabled}
          aria-label={t("adminJourneys.predicateRow.remove", { number })}
          onClick={props.onRemove}
        >
          <XCircle className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <PredicateFields
        id={id}
        draft={draft}
        context={context}
        disabled={disabled}
        issue={issue}
        set={set}
      />
    </fieldset>
  );
}

function PredicateFields({
  id,
  draft,
  context,
  disabled,
  issue,
  set,
}: {
  id: string;
  draft: PredicateDraft;
  context: PredicateContext;
  disabled?: boolean;
  issue: JourneyFieldError | null;
  set: (patch: Record<string, unknown>) => void;
}) {
  ensureMeasurementHintI18n();
  const { t } = useTranslation();
  const issueText = issue ? t(issue.key, issue.values) : null;
  const inValues = stringList(draft.in);
  const checks = (options: readonly CheckGroupOption[], legendKey: string) => (
    <CheckGroup
      id={`${id}-in`}
      legend={t(legendKey)}
      options={options}
      value={inValues}
      disabled={disabled}
      error={inValues.length === 0 ? t("adminJourneys.sheetField.error.pickOne") : null}
      onChange={(next) => set({ in: next })}
    />
  );

  switch (draft.kind) {
    case "email_opened":
    case "email_clicked": {
      const emailId = `${id}-email`;
      const ref = typeof draft.nodeId === "string" ? draft.nodeId : "";
      const known = context.emailNodes.some((option) => option.id === ref);
      return (
        <div className="space-y-3">
          <SheetField id={emailId} label={t("adminJourneys.predicateRow.email")} error={issueText}>
            <PlatformSelect
              id={emailId}
              value={ref}
              disabled={disabled}
              aria-invalid={issueText ? true : undefined}
              aria-describedby={describedBy(issueText && `${emailId}-error`)}
              onChange={(event) => set({ nodeId: event.target.value })}
            >
              {!known ? (
                <option value={ref}>
                  {ref
                    ? t("adminJourneys.predicateRow.emailUnknown", { id: ref })
                    : t("adminJourneys.predicateRow.emailPick")}
                </option>
              ) : null}
              {context.emailNodes.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </PlatformSelect>
          </SheetField>
          <BufferedIntField
            id={`${id}-within`}
            label={t("adminJourneys.predicateRow.withinHours")}
            hint={t("adminJourneys.predicateRow.withinHoursHint")}
            value={typeof draft.withinHours === "number" ? draft.withinHours : null}
            min={1}
            max={WITHIN_HOURS_MAX}
            optional
            disabled={disabled}
            onCommit={(value) => set({ withinHours: value ?? undefined })}
          />
          {draft.kind === "email_opened" ? (
            <div className="flex min-h-6 items-center gap-2">
              <Checkbox
                id={`${id}-machine`}
                checked={draft.excludeMachine === true}
                disabled={disabled}
                aria-describedby={`${id}-machine-hint`}
                onCheckedChange={(state) =>
                  set({ excludeMachine: state === true ? true : undefined })
                }
              />
              <div className="min-w-0">
                <Label htmlFor={`${id}-machine`} className="cursor-pointer text-sm font-normal">
                  {t("adminJourneys.predicateRow.excludeMachine")}
                </Label>
                <p id={`${id}-machine-hint`} className="text-xs text-muted-foreground">
                  {t("adminJourneys.predicateRow.excludeMachineHint")}
                </p>
              </div>
            </div>
          ) : (
            <BufferedTextField
              id={`${id}-url`}
              label={t("adminJourneys.predicateRow.urlContains")}
              hint={t("adminJourneys.predicateRow.urlContainsHint")}
              value={typeof draft.urlContains === "string" ? draft.urlContains : ""}
              max={200}
              disabled={disabled}
              onCommit={(value) => set({ urlContains: value === "" ? undefined : value })}
            />
          )}
          <p
            role="note"
            data-measurement-warning=""
            className="flex items-start gap-1.5 text-xs text-muted-foreground"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("adminMeasurementHint.predicate")}
          </p>
        </div>
      );
    }
    case "plan": {
      const opId = `${id}-op`;
      const op = typeof draft.op === "string" ? draft.op : "has_paid";
      const needsTiers = op === "tier_at_least" || op === "tier_in";
      return (
        <div className="space-y-3">
          <SheetField id={opId} label={t("adminJourneys.predicateRow.planOp")}>
            <PlatformSelect
              id={opId}
              value={op}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value;
                const tiers = next === "tier_at_least" || next === "tier_in";
                set({ op: next, tierKeys: tiers ? stringList(draft.tierKeys) : undefined });
              }}
            >
              {PLAN_OPS.map((value) => (
                <option key={value} value={value}>
                  {t(`adminJourneys.predicateRow.plan.${value}`)}
                </option>
              ))}
            </PlatformSelect>
          </SheetField>
          {needsTiers ? (
            <BufferedListField
              id={`${id}-tiers`}
              label={t("adminJourneys.predicateRow.tierKeys")}
              hint={t("adminJourneys.predicateRow.tierKeysHint")}
              value={stringList(draft.tierKeys)}
              min={1}
              max={20}
              itemMax={SHORT_TEXT_MAX}
              disabled={disabled}
              onCommit={(values) => set({ tierKeys: values })}
            />
          ) : null}
        </div>
      );
    }
    case "subscription_status":
      return checks(
        PREDICATE_SUBSCRIPTION_STATUSES.map((value) => ({
          value,
          label: t(SUBSCRIPTION_STATUS_KEYS[value] ?? value),
        })),
        "adminJourneys.predicateRow.subscriptionStatuses",
      );
    case "crm_stage":
      return checks(
        CRM_STAGES.map((value) => ({ value, label: t(`adminCrm.lifecycle.crmStages.${value}`) })),
        "adminJourneys.predicateRow.crmStages",
      );
    case "lifecycle_stage":
      return checks(
        LIFECYCLE_STAGES.map((value) => ({
          value,
          label: t(`adminCrm.lifecycle.stages.${value}`),
        })),
        "adminJourneys.predicateRow.lifecycleStages",
      );
    case "score_band":
      return checks(
        SCORE_BANDS.map((value) => ({
          value,
          label: t(`adminJourneys.predicateRow.scoreBand.${value}`),
        })),
        "adminJourneys.predicateRow.scoreBands",
      );
    case "consent":
      return (
        <p className="text-xs text-muted-foreground">
          {t("adminJourneys.predicateRow.consentHint")}
        </p>
      );
    case "newsletter_status":
      return (
        <BufferedListField
          id={`${id}-statuses`}
          label={t("adminJourneys.predicateRow.newsletterStatuses")}
          hint={t("adminJourneys.predicateRow.newsletterStatusesHint")}
          value={inValues}
          min={1}
          max={10}
          itemMax={SHORT_TEXT_MAX}
          disabled={disabled}
          onCommit={(values) => set({ in: values })}
        />
      );
    case "has_tag":
      return (
        <BufferedTextField
          id={`${id}-tag`}
          label={t("adminJourneys.predicateRow.tag")}
          value={typeof draft.tag === "string" ? draft.tag : ""}
          min={1}
          max={SHORT_TEXT_MAX}
          disabled={disabled}
          onCommit={(value) => set({ tag: value })}
        />
      );
    case "event_since_enrollment": {
      const eventId = `${id}-event`;
      const eventType = typeof draft.eventType === "string" ? draft.eventType : DEFAULT_WAIT_EVENT;
      return (
        <div className="space-y-3">
          <SheetField
            id={eventId}
            label={t("adminJourneys.predicateRow.eventType")}
            hint={t("adminJourneys.predicateRow.eventSinceHint")}
          >
            <TriggerEventSelect
              id={eventId}
              value={eventType}
              disabled={disabled}
              ariaDescribedBy={`${eventId}-hint`}
              onChange={(next) => set({ eventType: next, condition: undefined })}
            />
          </SheetField>
          <ConditionFields
            idPrefix={`${id}-condition`}
            eventType={eventType}
            value={draft.condition as ConditionRecord | undefined}
            disabled={disabled}
            onCommit={(condition) =>
              set({ condition: Object.keys(condition).length > 0 ? condition : undefined })
            }
          />
        </div>
      );
    }
    case "club_member":
    case "event_registered": {
      const field = draft.kind === "club_member" ? "clubId" : "eventId";
      const current = typeof draft[field] === "string" ? (draft[field] as string) : "";
      return (
        <BufferedTextField
          id={`${id}-${field}`}
          label={t(`adminJourneys.predicateRow.${field}`)}
          hint={t(`adminJourneys.predicateRow.${field}Hint`)}
          value={current}
          max={36}
          pattern={UUID_RE}
          patternKey="adminJourneys.sheetField.error.uuid"
          mono
          disabled={disabled}
          onCommit={(value) => set({ [field]: value === "" ? undefined : value.toLowerCase() })}
        />
      );
    }
    case "trigger_field":
      return (
        <TriggerFieldPredicate
          id={id}
          draft={draft}
          context={context}
          disabled={disabled}
          set={set}
        />
      );
    default:
      return null;
  }
}

function TriggerFieldPredicate({
  id,
  draft,
  context,
  disabled,
  set,
}: {
  id: string;
  draft: PredicateDraft;
  context: PredicateContext;
  disabled?: boolean;
  set: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const keys = triggerPayloadKeys(context.triggerEventType);
  const key = typeof draft.key === "string" ? draft.key : "";
  const values = stringList(draft.values);
  const keyId = `${id}-key`;
  const opId = `${id}-op`;
  const outside = key !== "" && !keys.includes(key);
  const enumField = context.triggerEventType
    ? journeyTrigger(context.triggerEventType)?.conditionFields.find(
        (field) => field.key === key && field.type === "enum",
      )
    : undefined;
  const keyHint = outside
    ? t("adminJourneys.predicateRow.fieldOutside")
    : t("adminJourneys.predicateRow.fieldHint");
  return (
    <div className="space-y-3">
      <SheetField id={keyId} label={t("adminJourneys.predicateRow.field")} hint={keyHint}>
        <PlatformSelect
          id={keyId}
          value={key}
          disabled={disabled}
          placeholder={t("adminJourneys.predicateRow.fieldPick")}
          aria-describedby={`${keyId}-hint`}
          onChange={(event) => set({ key: event.target.value, values: [] })}
        >
          {outside ? <option value={key}>{key}</option> : null}
          {keys.map((payloadKey) => (
            <option key={payloadKey} value={payloadKey}>
              {payloadKey}
            </option>
          ))}
        </PlatformSelect>
      </SheetField>
      <SheetField id={opId} label={t("adminJourneys.predicateRow.fieldOp")}>
        <PlatformSelect
          id={opId}
          value={draft.op === "not_in" ? "not_in" : "in"}
          disabled={disabled}
          onChange={(event) => set({ op: event.target.value === "not_in" ? "not_in" : "in" })}
        >
          <option value="in">{t("adminJourneys.predicateRow.opIn")}</option>
          <option value="not_in">{t("adminJourneys.predicateRow.opNotIn")}</option>
        </PlatformSelect>
      </SheetField>
      {enumField && context.triggerEventType ? (
        <CheckGroup
          id={`${id}-values`}
          legend={t("adminJourneys.predicateRow.fieldValues")}
          options={(enumField.options ?? []).map((option) => {
            const labelKey = conditionValueLabelKey(
              context.triggerEventType ?? "",
              enumField.key,
              option,
            );
            return { value: option, label: labelKey ? t(labelKey) : option };
          })}
          value={values}
          disabled={disabled}
          error={values.length === 0 ? t("adminJourneys.sheetField.error.pickOne") : null}
          onChange={(next) => set({ values: next })}
        />
      ) : (
        <BufferedListField
          id={`${id}-values`}
          label={t("adminJourneys.predicateRow.fieldValues")}
          hint={t("adminJourneys.predicateRow.fieldValuesHint")}
          value={values}
          min={1}
          max={20}
          itemMax={200}
          disabled={disabled}
          onCommit={(next) => set({ values: next })}
        />
      )}
    </div>
  );
}

// ── Lista warunków ──────────────────────────────────────────────────────────

interface PredicateRowState {
  key: number;
  draft: PredicateDraft;
}

export interface PredicateListProps {
  id: string;
  legend: string;
  hint?: string;
  value: readonly JourneyPredicate[];
  min: number;
  max: number;
  context: PredicateContext;
  /** Filtr wejścia: warunki historii są tam zawsze fałszem - ostrzegamy. */
  entryFilter?: boolean;
  disabled?: boolean;
  onCommit: (predicates: JourneyPredicate[]) => void;
}

/**
 * Lista warunków (`if_else` 1-20, filtr wejścia 0-20). Oddaje warunki do
 * szkicu tylko w komplecie poprawnych (patrz nagłówek).
 */
export function PredicateList(props: PredicateListProps) {
  ensureJourneysI18n();
  ensureI18n();
  const { t } = useTranslation();
  const { id, value, min, max, context, disabled } = props;
  const nextKey = useRef(0);
  const toRows = (): PredicateRowState[] =>
    value.map((predicate) => ({
      key: nextKey.current++,
      draft: JSON.parse(JSON.stringify(predicate)) as PredicateDraft,
    }));
  const { form: rows, setForm: setRows, markCommitted } = useFormBuffer(value, toRows);
  const hintId = useId();

  const update = (next: PredicateRowState[]) => {
    setRows(next);
    if (next.length < min || next.length > max) return;
    if (next.some((row) => predicateDraftIssue(row.draft, context) !== null)) return;
    const predicates = next.map((row) => PredicateSchema.parse(row.draft));
    markCommitted(predicates);
    props.onCommit(predicates);
  };

  const history =
    props.entryFilter === true &&
    rows.some((row) => {
      const parsed = PredicateSchema.safeParse(row.draft);
      return parsed.success && isHistoryPredicate(parsed.data);
    });
  const pending = rows.some((row) => predicateDraftIssue(row.draft, context) !== null);

  return (
    <section
      className="space-y-3"
      aria-labelledby={`${id}-legend`}
      data-testid="journey-predicates"
    >
      <div className="space-y-0.5">
        <h3 id={`${id}-legend`} className="text-sm font-medium">
          {props.legend}
        </h3>
        {props.hint ? (
          <p id={hintId} className="text-xs text-muted-foreground">
            {props.hint}
          </p>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("adminJourneys.predicateRow.empty")}</p>
      ) : null}
      {rows.map((row, index) => (
        <PredicateRow
          key={row.key}
          id={`${id}-${row.key}`}
          index={index}
          draft={row.draft}
          context={context}
          disabled={disabled}
          removeDisabled={rows.length <= min}
          onChange={(draft) =>
            update(
              rows.map((current) => (current.key === row.key ? { ...current, draft } : current)),
            )
          }
          onRemove={() => update(rows.filter((current) => current.key !== row.key))}
        />
      ))}
      {history ? (
        <p role="note" className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t(journeyLabelKey("graphIssue", "entry_filter_history"))}
        </p>
      ) : null}
      {pending ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("adminJourneys.predicateRow.pending")}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || rows.length >= max}
        onClick={() =>
          update([
            ...rows,
            { key: nextKey.current++, draft: defaultPredicateDraft("consent", context) },
          ])
        }
      >
        {rows.length >= max
          ? t("adminJourneys.predicateRow.max", { max })
          : t("adminJourneys.predicateRow.add")}
      </Button>
    </section>
  );
}
