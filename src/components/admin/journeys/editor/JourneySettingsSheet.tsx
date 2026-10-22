// Arkusz ustawień ścieżki (S8, SPEC §6.3) - KIM ścieżka jest i JAK się kończy:
// nazwa, opis, kategoria z podstawą prawną, ponowne wejście, cel, zdarzenia
// wyjścia oraz (tylko do odczytu) okno wysyłki i nadawca z ustawień silnika.
//
// KOMPONENT STEROWANY. Wartość trzyma sesja edytora (`editorSession.ts`):
// pola definicji idą przez `onChangeDefinition` (sesja woła
// `updateDefinition`), ustawienia szkicu przez `onChangeSettings` - OBA
// trafiają do tego samego `saveJourneyDraft` (autozapis 2 s z CAS), więc
// nazwa i graf nigdy nie rozjadą się między dwoma zapisami.
//
// ODRZUCENIE, NIE PRZYCIĘCIE. Nazwa 1-160, opis ≤ 2000, podstawa prawna ≤ 500
// (wymagana przy kategorii usługowej), karencja 1-730 dni - wartość spoza
// limitu zostaje w polu z komunikatem i licznikiem i nie trafia do szkicu
// (limity z `JOURNEY_LIMITS`, te same co walidator `saveJourneyDraft` i CHECK-i
// `journey_definitions`). Zmiana kategorii na usługową bez podstawy prawnej
// jest przyjęta, ale autozapis czeka (sesja: `legalBasisRequired`), a pole
// mówi, czego brakuje - inaczej nie dałoby się zmienić kolejności kroków.
//
// OKNO WYSYŁKI NIE JEST USTAWIENIEM ŚCIEŻKI. Limit maili na 7 dni, ciszę nocną,
// strefę i nazwę nadawcy ma silnik (`journey_settings`, edycja: administrator
// w „Ustawieniach ścieżek” nad listą). Arkusz pokazuje je, bo od kategorii
// zależy, czy w ogóle obowiązują - zdania są wspólne z dialogiem publikacji.
import { useId, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Lock, Plus, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { Button } from "@/components/ui/button";
import { PlatformSelect } from "@/components/ui/platform-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { isMfaRequiredError, type JourneyCapabilities } from "@/lib/admin/journeys/access";
import type {
  JourneyDefinitionFields,
  JourneyUpdateOptions,
} from "@/lib/admin/journeys/editorSession";
import {
  JOURNEY_CATEGORY_HINT_KEY,
  JOURNEY_CATEGORY_LABEL_KEY,
  JOURNEY_REENTRY_LABEL_KEY,
} from "@/lib/admin/journeys/summaries";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n as ensurePublishI18n } from "@/lib/i18n-admin-journeys-publish";
import { ensureI18n } from "@/lib/i18n-admin-journeys-steps";
import type { JourneySettings } from "@/lib/journeys/graph";
import {
  JOURNEY_CATEGORIES,
  JOURNEY_LIMITS,
  JOURNEY_REENTRY,
  type JourneyCategory,
  type JourneyReentry,
} from "@/lib/journeys/limits";
import { journeySettingsQueryOptions } from "@/lib/journeys/queries";
import {
  BufferedIntField,
  BufferedTextField,
  ConditionFields,
  SheetField,
  TriggerEventSelect,
} from "./PredicateRow";

/**
 * Karencja wpisywana przy wyborze „ponownie po karencji” - ta sama wartość,
 * którą `admin_journey_publish` przyjmuje, gdy szkic jej nie poda
 * (`COALESCE(reentryCooldownDays, 30)`), więc szkic i wersja mówią to samo.
 */
export const JOURNEY_DEFAULT_COOLDOWN_DAYS = 30;

/** Najwięcej zdarzeń wyjścia (`JourneySettingsSchema.exitEvents.max(10)`). */
export const JOURNEY_EXIT_EVENTS_MAX = 10;

type ConditionRecord = Record<string, string | number | boolean>;

export interface JourneySettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  /** Pola definicji z sesji (`session.value.definition`). */
  definition: JourneyDefinitionFields;
  /** Ustawienia szkicu z sesji (`session.draft.settings`). */
  settings: JourneySettings;
  /** `journeyCapabilities(roles)` - bez `canEdit` arkusz jest podglądem. */
  capabilities: Pick<JourneyCapabilities, "canEdit">;
  /** `session.editable` (konflikt, podgląd wersji, archiwum = tylko odczyt). */
  editable: boolean;
  /** Przyjęta zmiana pól definicji - edytor woła `session.updateDefinition(patch, options)`. */
  onChangeDefinition: (
    patch: Partial<JourneyDefinitionFields>,
    options: JourneyUpdateOptions,
  ) => void;
  /** Przyjęte ustawienia - edytor woła `session.updateDraft(d => withJourneySettings(d, s), options)`. */
  onChangeSettings: (settings: JourneySettings, options: JourneyUpdateOptions) => void;
}

export function JourneySettingsSheet(props: JourneySettingsSheetProps) {
  ensureJourneysI18n();
  ensureListI18n();
  ensurePublishI18n();
  ensureI18n();
  const { t } = useTranslation();
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md"
        data-testid="journey-settings-sheet"
      >
        <SheetHeader className="pr-6">
          <SheetTitle>{t("adminJourneys.settingsSheet.title")}</SheetTitle>
          <SheetDescription>{t("adminJourneys.settingsSheet.description")}</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <SettingsForm {...props} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SettingsForm(props: JourneySettingsSheetProps) {
  const { t } = useTranslation();
  const id = useId();
  const { definition, settings, capabilities } = props;
  const canChange = capabilities.canEdit && props.editable;
  const disabled = !canChange;

  const changeDefinition = (
    patch: Partial<JourneyDefinitionFields>,
    labelKey: string,
    field: string,
  ) => {
    if (!canChange) return;
    props.onChangeDefinition(patch, { label: t(labelKey), coalesceKey: `settings:${field}` });
  };
  const changeSettings = (next: JourneySettings, labelKey: string, field: string) => {
    if (!canChange) return;
    props.onChangeSettings(next, { label: t(labelKey), coalesceKey: `settings:${field}` });
  };

  const categoryId = `${id}-category`;
  const service = definition.category === "service";

  return (
    <div className="space-y-6">
      {!canChange ? (
        <p role="note" className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {capabilities.canEdit
            ? t("adminJourneys.stepSheet.readOnly")
            : t("adminJourneys.stepSheet.roleReadOnly")}
        </p>
      ) : null}

      <SettingsSection id={`${id}-general`} title={t("adminJourneys.settingsSheet.general")}>
        <BufferedTextField
          id={`${id}-name`}
          label={t("adminJourneys.create.name")}
          value={definition.name}
          min={JOURNEY_LIMITS.nameMin}
          max={JOURNEY_LIMITS.nameMax}
          disabled={disabled}
          onCommit={(name) =>
            changeDefinition({ name }, "adminJourneys.settingsSheet.history.name", "name")
          }
        />
        <BufferedTextField
          id={`${id}-description`}
          label={t("adminJourneys.create.description")}
          value={definition.description}
          max={JOURNEY_LIMITS.descriptionMax}
          multiline
          rows={4}
          disabled={disabled}
          onCommit={(description) =>
            changeDefinition(
              { description },
              "adminJourneys.settingsSheet.history.description",
              "description",
            )
          }
        />
      </SettingsSection>

      <SettingsSection id={`${id}-consent`} title={t("adminJourneys.settingsSheet.consent")}>
        <SheetField
          id={categoryId}
          label={t("adminJourneys.create.category")}
          hint={t(JOURNEY_CATEGORY_HINT_KEY[definition.category])}
        >
          <PlatformSelect
            id={categoryId}
            value={definition.category}
            disabled={disabled}
            aria-describedby={`${categoryId}-hint`}
            onChange={(event) => {
              const category = event.target.value as JourneyCategory;
              if (category === definition.category) return;
              changeDefinition(
                { category },
                "adminJourneys.settingsSheet.history.category",
                "category",
              );
            }}
          >
            {JOURNEY_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(JOURNEY_CATEGORY_LABEL_KEY[category])}
              </option>
            ))}
          </PlatformSelect>
        </SheetField>
        <BufferedTextField
          id={`${id}-legal`}
          label={t("adminJourneys.create.legalBasis")}
          hint={
            service
              ? t("adminJourneys.create.legalBasisHint")
              : t("adminJourneys.settingsSheet.legalBasisOptional")
          }
          value={definition.legalBasis}
          // Usługa bez podstawy prawnej nie przejdzie zapisu (`legalBasisRequired`).
          min={service ? 1 : 0}
          max={JOURNEY_LIMITS.legalBasisMax}
          multiline
          disabled={disabled}
          onCommit={(legalBasis) =>
            changeDefinition(
              { legalBasis },
              "adminJourneys.settingsSheet.history.legalBasis",
              "legalBasis",
            )
          }
        />
      </SettingsSection>

      <SettingsSection
        id={`${id}-reentry`}
        title={t("adminJourneys.settingsSheet.reentry")}
        hint={t("adminJourneys.settingsSheet.reentryHint")}
      >
        <ReentryFields
          id={`${id}-reentry-fields`}
          settings={settings}
          disabled={disabled}
          onChange={(next) =>
            changeSettings(next, "adminJourneys.settingsSheet.history.reentry", "reentry")
          }
        />
      </SettingsSection>

      <SettingsSection
        id={`${id}-goal`}
        title={t("adminJourneys.settingsSheet.goal")}
        hint={t("adminJourneys.settingsSheet.goalHint")}
      >
        <GoalFields
          id={`${id}-goal-fields`}
          settings={settings}
          disabled={disabled}
          onChange={(next, field) =>
            changeSettings(next, "adminJourneys.settingsSheet.history.goal", `goal:${field}`)
          }
        />
      </SettingsSection>

      <SettingsSection
        id={`${id}-exits`}
        title={t("adminJourneys.settingsSheet.exits")}
        hint={t("adminJourneys.settingsSheet.exitsHint")}
      >
        <ExitEventsFields
          id={`${id}-exit`}
          settings={settings}
          marketing={!service}
          disabled={disabled}
          onChange={(next, field) =>
            changeSettings(next, "adminJourneys.settingsSheet.history.exits", `exits:${field}`)
          }
        />
      </SettingsSection>

      <SettingsSection id={`${id}-policy`} title={t("adminJourneys.settingsSheet.policy")}>
        <SendingPolicy tenantId={props.tenantId} open={props.open} category={definition.category} />
      </SettingsSection>
    </div>
  );
}

function SettingsSection({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3" aria-labelledby={`${id}-title`}>
      <div className="space-y-0.5">
        <h3 id={`${id}-title`} className="text-sm font-medium">
          {title}
        </h3>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

// ── Ponowne wejście ─────────────────────────────────────────────────────────

/** Ustawienia z nową polityką wejścia; karencja tylko przy `cooldown`. */
export function withReentry(settings: JourneySettings, reentry: JourneyReentry): JourneySettings {
  const { reentry: _reentry, reentryCooldownDays, ...rest } = settings;
  if (reentry === "cooldown") {
    return {
      ...rest,
      reentry,
      reentryCooldownDays: reentryCooldownDays ?? JOURNEY_DEFAULT_COOLDOWN_DAYS,
    };
  }
  // „Nigdy” to domyślna polityka RPC (`COALESCE(reentry, 'never')`) - zapisujemy
  // ją jawnie, żeby szkic, publikacja i wynik mówiły to samo słowami.
  return { ...rest, reentry };
}

function ReentryFields({
  id,
  settings,
  disabled,
  onChange,
}: {
  id: string;
  settings: JourneySettings;
  disabled: boolean;
  onChange: (next: JourneySettings) => void;
}) {
  const { t } = useTranslation();
  const selectId = `${id}-policy`;
  const reentry = settings.reentry ?? "never";
  return (
    <div className="space-y-3">
      <SheetField id={selectId} label={t("adminJourneys.settingsSheet.reentryPolicy")}>
        <PlatformSelect
          id={selectId}
          value={reentry}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value as JourneyReentry;
            if (next === reentry) return;
            onChange(withReentry(settings, next));
          }}
        >
          {JOURNEY_REENTRY.map((policy) => (
            <option key={policy} value={policy}>
              {t(JOURNEY_REENTRY_LABEL_KEY[policy])}
            </option>
          ))}
        </PlatformSelect>
      </SheetField>
      {reentry === "cooldown" ? (
        <BufferedIntField
          id={`${id}-cooldown`}
          label={t("adminJourneys.settingsSheet.cooldownDays")}
          hint={t("adminJourneys.settingsSheet.cooldownHint")}
          value={settings.reentryCooldownDays ?? JOURNEY_DEFAULT_COOLDOWN_DAYS}
          min={JOURNEY_LIMITS.cooldownDaysMin}
          max={JOURNEY_LIMITS.cooldownDaysMax}
          disabled={disabled}
          onCommit={(days) =>
            onChange({
              ...settings,
              reentryCooldownDays: days ?? JOURNEY_DEFAULT_COOLDOWN_DAYS,
            })
          }
        />
      ) : null}
    </div>
  );
}

// ── Cel ─────────────────────────────────────────────────────────────────────

function GoalFields({
  id,
  settings,
  disabled,
  onChange,
}: {
  id: string;
  settings: JourneySettings;
  disabled: boolean;
  onChange: (next: JourneySettings, field: string) => void;
}) {
  const { t } = useTranslation();
  const selectId = `${id}-event`;
  const goal = settings.goal;
  const { goal: _goal, ...rest } = settings;
  return (
    <div className="space-y-3">
      <SheetField id={selectId} label={t("adminJourneys.settingsSheet.goalEvent")}>
        <TriggerEventSelect
          id={selectId}
          value={goal?.eventType ?? ""}
          disabled={disabled}
          noneLabel={t("adminJourneys.settingsSheet.goalNone")}
          onChange={(eventType) => {
            if (eventType === (goal?.eventType ?? "")) return;
            // Inne zdarzenie = inne pola ładunku - stary warunek nie ma sensu.
            onChange(eventType ? { ...rest, goal: { eventType } } : rest, "event");
          }}
        />
      </SheetField>
      {goal ? (
        <ConditionFields
          idPrefix={`${id}-condition`}
          eventType={goal.eventType}
          value={goal.condition}
          disabled={disabled}
          onCommit={(condition) =>
            onChange(
              {
                ...rest,
                goal: withCondition(goal, condition),
              },
              "condition",
            )
          }
        />
      ) : null}
    </div>
  );
}

type ExitEvent = NonNullable<JourneySettings["goal"]>;

/** Zdarzenie z warunkiem; pusty warunek znika (każde zdarzenie typu). */
function withCondition(event: ExitEvent, condition: ConditionRecord): ExitEvent {
  return Object.keys(condition).length > 0
    ? { eventType: event.eventType, condition }
    : { eventType: event.eventType };
}

// ── Zdarzenia wyjścia ───────────────────────────────────────────────────────

/** Ustawienia z nową listą wyjść; pusta lista znika ze szkicu. */
export function withExitEvents(
  settings: JourneySettings,
  exits: readonly ExitEvent[],
): JourneySettings {
  const { exitEvents: _exits, ...rest } = settings;
  return exits.length > 0 ? { ...rest, exitEvents: [...exits] } : rest;
}

function ExitEventsFields({
  id,
  settings,
  marketing,
  disabled,
  onChange,
}: {
  id: string;
  settings: JourneySettings;
  marketing: boolean;
  disabled: boolean;
  onChange: (next: JourneySettings, field: string) => void;
}) {
  const { t } = useTranslation();
  const exits = settings.exitEvents ?? [];
  // Nowe wyjście czeka na wybór zdarzenia lokalnie - nie zgadujemy go za
  // administratora, a szkic dostaje tylko kompletne wyjście.
  const [adding, setAdding] = useState(false);
  const full = exits.length >= JOURNEY_EXIT_EVENTS_MAX;
  const replace = (index: number, next: ExitEvent | null, field: string) => {
    const list = exits.flatMap((exit, i) => (i === index ? (next ? [next] : []) : [exit]));
    onChange(withExitEvents(settings, list), field);
  };

  return (
    <div className="space-y-3">
      {marketing ? (
        <p className="text-xs text-muted-foreground">
          {t("adminJourneys.publishDialog.exitUnsubscribe")}
        </p>
      ) : null}
      {exits.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground">
          {t("adminJourneys.publishDialog.exitsNone")}
        </p>
      ) : null}
      <ol className="space-y-3">
        {exits.map((exit, index) => {
          const rowId = `${id}-${index}`;
          const number = index + 1;
          return (
            <li
              key={`${index}-${exit.eventType}`}
              className="space-y-3 rounded-[6px] border border-border p-3"
              data-testid="journey-exit-event"
            >
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <SheetField
                    id={`${rowId}-event`}
                    label={t("adminJourneys.settingsSheet.exitEvent", { number })}
                  >
                    <TriggerEventSelect
                      id={`${rowId}-event`}
                      value={exit.eventType}
                      disabled={disabled}
                      onChange={(eventType) => {
                        if (!eventType || eventType === exit.eventType) return;
                        replace(index, { eventType }, `${index}:event`);
                      }}
                    />
                  </SheetField>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  disabled={disabled}
                  aria-label={t("adminJourneys.settingsSheet.exitRemove", { number })}
                  onClick={() => replace(index, null, `${index}:remove`)}
                >
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              <ConditionFields
                idPrefix={`${rowId}-condition`}
                eventType={exit.eventType}
                value={exit.condition}
                disabled={disabled}
                onCommit={(condition) =>
                  replace(index, withCondition(exit, condition), `${index}:condition`)
                }
              />
            </li>
          );
        })}
      </ol>
      {adding && !full ? (
        <SheetField
          id={`${id}-new`}
          label={t("adminJourneys.settingsSheet.exitEvent", { number: exits.length + 1 })}
        >
          <TriggerEventSelect
            id={`${id}-new`}
            value=""
            disabled={disabled}
            noneLabel={t("adminJourneys.create.triggerPlaceholder")}
            onChange={(eventType) => {
              if (!eventType) return;
              setAdding(false);
              onChange(withExitEvents(settings, [...exits, { eventType }]), "add");
            }}
          />
        </SheetField>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || full || adding}
        onClick={() => setAdding(true)}
      >
        <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {full
          ? t("adminJourneys.settingsSheet.exitsMax", { max: JOURNEY_EXIT_EVENTS_MAX })
          : t("adminJourneys.settingsSheet.exitAdd")}
      </Button>
    </div>
  );
}

// ── Okno wysyłki (silnik, tylko odczyt) ─────────────────────────────────────

function SendingPolicy({
  tenantId,
  open,
  category,
}: {
  tenantId: string | null;
  open: boolean;
  category: JourneyCategory;
}) {
  const { t } = useTranslation();
  const hydrated = useHydrated();
  const query = useQuery({
    ...journeySettingsQueryOptions(tenantId),
    enabled: hydrated && open && Boolean(tenantId),
  });
  if (query.error && isMfaRequiredError(query.error)) return <MfaRequiredNotice />;
  const engine = query.data?.state === "ready" ? query.data.data : null;
  const policy = !engine
    ? query.isPending && hydrated && open && Boolean(tenantId)
      ? t("adminJourneys.settingsSheet.policyLoading")
      : t("adminJourneys.publishDialog.policyUnknown")
    : category === "marketing"
      ? t("adminJourneys.publishDialog.policyMarketing", {
          cap: engine.marketingCapPer7d,
          start: engine.quietStart,
          end: engine.quietEnd,
          timezone: engine.timezone,
        })
      : t("adminJourneys.publishDialog.policyService");
  return (
    <div className="space-y-2 text-sm" data-testid="journey-settings-policy">
      <p>{policy}</p>
      {engine ? (
        <p>
          {engine.senderName
            ? t("adminJourneys.publishDialog.sender", { name: engine.senderName })
            : t("adminJourneys.publishDialog.senderDefault")}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("adminJourneys.settingsSheet.policyHint")}</p>
    </div>
  );
}
