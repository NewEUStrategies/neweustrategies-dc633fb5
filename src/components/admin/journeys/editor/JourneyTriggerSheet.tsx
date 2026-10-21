// Arkusz wyzwalacza ścieżki (S8, SPEC §6.3) - KTO wchodzi na ścieżkę:
// zdarzenie startowe z katalogu S5, warunek ładunku (`payload @> condition`),
// filtr wejścia i szacunek odbiorców.
//
// KOMPONENT STEROWANY: dostaje szkic sesji i oddaje NOWE ustawienia
// (`onChangeSettings`) z etykietą do historii. Szkic bez wyzwalacza (pusty
// szkic z `createJourney` nie przechodzi `JourneyDraftSchema`) dostaje tryb
// „wybierz wyzwalacz”: wybór idzie przez `onChooseTrigger` (sesja zapisuje go
// od razu - inaczej szkicu nie da się zapisać wcale).
//
// ZMIANA ZDARZENIA czyści warunek (pola ładunku są inne dla każdego typu),
// a warunki „pole zdarzenia wejścia” w filtrze, które wskazują klucz spoza
// nowego ładunku, dostają ostrzeżenie - nie znikają po cichu.
//
// MAILE PRZY WINDYKACJI. Przy `billing_subscription.payment_failed.v1` ścieżka
// nie wysyła maili (należą do `dunning.server.ts`). Gdy szkic ma krok maila,
// to zdarzenie jest na liście, ale wyłączone z wyjaśnieniem - inaczej wybór
// dałby graf, którego walidator nie przepuści (`email_on_payment_failed`).
//
// SZACUNEK = `estimateJourneyTrigger` (RPC S5, 30 dni) z kluczem
// `journeyKeys.triggerEstimate(tenant, typ, skrót warunku)` - ten sam, którego
// używa dialog publikacji, więc liczba się nie rozjeżdża. Liczy ZDARZENIA
// i kontakty, nie przyszłe zapisy (filtr, zgoda i ponowne wejście odsieją
// część) - mówi to podpis. Brak `aal2` -> `MfaRequiredNotice`.
import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { isMfaRequiredError, type JourneyCapabilities } from "@/lib/admin/journeys/access";
import type {
  JourneySessionActionResult,
  JourneyUpdateOptions,
} from "@/lib/admin/journeys/editorSession";
import { conditionHash } from "@/lib/admin/journeys/hash";
import type { JourneyEmailContentDto } from "@/lib/admin/journeys/journeyEditor.functions";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n as ensurePublishI18n } from "@/lib/i18n-admin-journeys-publish";
import { ensureI18n } from "@/lib/i18n-admin-journeys-steps";
import type { JourneyDraft, JourneySettings } from "@/lib/journeys/graph";
import { journeyTriggerEstimateQueryOptions } from "@/lib/journeys/queries";
import { journeyTrigger } from "@/lib/journeys/triggers";
import {
  ConditionFields,
  PredicateList,
  SheetField,
  TriggerEventSelect,
  emailNodeOptions,
} from "./PredicateRow";

/** Szkic z nowymi ustawieniami - przepis dla `session.updateDraft`. */
export function withJourneySettings(draft: JourneyDraft, settings: JourneySettings): JourneyDraft {
  return { ...draft, settings };
}

export interface JourneyTriggerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  /** Szkic sesji; `null` = szkic bez wyzwalacza (tryb „wybierz wyzwalacz”). */
  draft: JourneyDraft | null;
  /** Treści szkicu - tematy maili w warunkach otwarcia/kliknięcia filtra. */
  contents: readonly JourneyEmailContentDto[];
  capabilities: JourneyCapabilities;
  /** `session.editable`. */
  editable: boolean;
  /** Przyjęte ustawienia - edytor woła `session.updateDraft(d => withJourneySettings(d, s), options)`. */
  onChangeSettings: (settings: JourneySettings, options: JourneyUpdateOptions) => void;
  /** `session.chooseTrigger` - zapis szkicu z wyzwalaczem (tryb „wybierz wyzwalacz”). */
  onChooseTrigger?: (eventType: string) => Promise<JourneySessionActionResult>;
}

export function JourneyTriggerSheet(props: JourneyTriggerSheetProps) {
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
        data-testid="journey-trigger-sheet"
      >
        <SheetHeader className="pr-6">
          <SheetTitle>{t("adminJourneys.triggerSheet.title")}</SheetTitle>
          <SheetDescription>{t("adminJourneys.triggerSheet.description")}</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {props.draft === null ? <ChooseTrigger {...props} /> : <TriggerForm {...props} draft={props.draft} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ChooseTrigger({ capabilities, editable, onChooseTrigger }: JourneyTriggerSheetProps) {
  const { t } = useTranslation();
  const id = useId();
  const [eventType, setEventType] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const canChange = capabilities.canEdit && editable && onChooseTrigger !== undefined;
  const selectId = `${id}-trigger`;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!onChooseTrigger || eventType === "") return;
        setBusy(true);
        setFailure(null);
        void onChooseTrigger(eventType).then((result) => {
          setBusy(false);
          if (!result.ok) setFailure(result.message);
        });
      }}
    >
      <p className="text-sm text-muted-foreground">{t("adminJourneys.triggerSheet.chooseIntro")}</p>
      <SheetField id={selectId} label={t("adminJourneys.create.trigger")} hint={t("adminJourneys.create.triggerHint")}>
        <TriggerEventSelect
          id={selectId}
          value={eventType}
          disabled={!canChange || busy}
          noneLabel={t("adminJourneys.create.triggerPlaceholder")}
          ariaDescribedBy={`${selectId}-hint`}
          onChange={setEventType}
        />
      </SheetField>
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}
      <Button type="submit" disabled={!canChange || busy || eventType === ""}>
        {busy ? t("adminJourneys.triggerSheet.choosing") : t("adminJourneys.triggerSheet.choose")}
      </Button>
    </form>
  );
}

function TriggerForm(props: JourneyTriggerSheetProps & { draft: JourneyDraft }) {
  const { t } = useTranslation();
  const id = useId();
  const { draft, capabilities } = props;
  const settings = draft.settings;
  const canChange = capabilities.canEdit && props.editable;
  const disabled = !canChange;
  const def = journeyTrigger(settings.triggerEventType);
  const hasEmail = draft.graph.nodes.some((node) => node.type === "send_email");
  const selectId = `${id}-trigger`;
  const emailNodes = useMemo(
    () => emailNodeOptions(t, draft.graph, props.contents),
    [t, draft.graph, props.contents],
  );
  const commit = (next: JourneySettings, labelKey: string, field: string) => {
    if (!canChange) return;
    props.onChangeSettings(next, { label: t(labelKey), coalesceKey: `trigger:${field}` });
  };
  // Warunki „pole zdarzenia wejścia” z kluczem spoza ładunku bieżącego zdarzenia.
  const payloadKeys = def?.payloadKeys ?? [];
  const staleFields = (settings.entryFilter ?? []).filter(
    (predicate) => predicate.kind === "trigger_field" && !payloadKeys.includes(predicate.key),
  ).length;

  return (
    <div className="space-y-5">
      {!canChange ? (
        <p role="note" className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {capabilities.canEdit
            ? t("adminJourneys.stepSheet.readOnly")
            : t("adminJourneys.stepSheet.roleReadOnly")}
        </p>
      ) : null}
      <SheetField
        id={selectId}
        label={t("adminJourneys.create.trigger")}
        hint={
          def?.emailForbidden
            ? t("adminJourneys.create.triggerEmailForbidden")
            : hasEmail
              ? t("adminJourneys.triggerSheet.emailBlockedHint")
              : t("adminJourneys.create.triggerHint")
        }
      >
        <TriggerEventSelect
          id={selectId}
          value={settings.triggerEventType}
          disabled={disabled}
          emailBlocked={hasEmail}
          ariaDescribedBy={`${selectId}-hint`}
          onChange={(eventType) => {
            if (!eventType || eventType === settings.triggerEventType) return;
            const { triggerCondition: _condition, ...rest } = settings;
            commit({ ...rest, triggerEventType: eventType }, "adminJourneys.triggerSheet.history.trigger", "event");
          }}
        />
      </SheetField>

      <section className="space-y-3" aria-labelledby={`${id}-condition-title`}>
        <div className="space-y-0.5">
          <h3 id={`${id}-condition-title`} className="text-sm font-medium">
            {t("adminJourneys.triggerSheet.condition")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("adminJourneys.triggerSheet.conditionHint")}</p>
        </div>
        <ConditionFields
          idPrefix={`${id}-condition`}
          eventType={settings.triggerEventType}
          value={settings.triggerCondition}
          disabled={disabled}
          onCommit={(condition) => {
            const { triggerCondition: _previous, ...rest } = settings;
            commit(
              Object.keys(condition).length > 0 ? { ...rest, triggerCondition: condition } : rest,
              "adminJourneys.triggerSheet.history.condition",
              "condition",
            );
          }}
        />
      </section>

      <TriggerEstimate
        tenantId={props.tenantId}
        enabled={props.open}
        eventType={settings.triggerEventType}
        condition={settings.triggerCondition ?? {}}
      />

      <PredicateList
        id={`${id}-filter`}
        legend={t("adminJourneys.triggerSheet.entryFilter")}
        hint={t("adminJourneys.triggerSheet.entryFilterHint")}
        value={settings.entryFilter ?? []}
        min={0}
        max={20}
        entryFilter
        context={{ emailNodes, triggerEventType: settings.triggerEventType }}
        disabled={disabled}
        onCommit={(predicates) => {
          const { entryFilter: _previous, ...rest } = settings;
          commit(
            predicates.length > 0 ? { ...rest, entryFilter: predicates } : rest,
            "adminJourneys.triggerSheet.history.entryFilter",
            "filter",
          );
        }}
      />
      {staleFields > 0 ? (
        <p role="note" className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("adminJourneys.triggerSheet.staleFields", { count: staleFields })}
        </p>
      ) : null}
    </div>
  );
}

function TriggerEstimate({
  tenantId,
  enabled,
  eventType,
  condition,
}: {
  tenantId: string | null;
  enabled: boolean;
  eventType: string;
  condition: Record<string, string | number | boolean>;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const estimate = useQuery({
    ...journeyTriggerEstimateQueryOptions(tenantId, eventType, condition, conditionHash(condition)),
    enabled: enabled && Boolean(tenantId),
  });
  const data = estimate.data;
  const text =
    data?.state === "ready"
      ? t("adminJourneys.publishDialog.estimateValue", {
          count: data.data.contacts,
          days: data.data.days,
          events: data.data.events,
        })
      : estimate.isLoading
        ? t("adminJourneys.publishDialog.estimateLoading")
        : t("adminJourneys.publishDialog.estimateUnavailable");
  return (
    <section
      className="space-y-1 rounded-[6px] border border-border p-3"
      aria-labelledby={titleId}
      aria-live="polite"
    >
      <h3 id={titleId} className="text-sm font-medium">
        {t("adminJourneys.publishDialog.estimate")}
      </h3>
      {estimate.error && isMfaRequiredError(estimate.error) ? (
        <MfaRequiredNotice />
      ) : (
        <p className="text-sm" data-testid="journey-trigger-estimate">
          {text}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t("adminJourneys.publishDialog.estimateHint")}</p>
    </section>
  );
}

