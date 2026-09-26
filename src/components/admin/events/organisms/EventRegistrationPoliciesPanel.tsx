// Organizm: „Zasady biletów" studia wydarzenia (F1-F5, spec B.12).
//
// TRZY PYTANIA O KUPIONY BILET. (1) Czy posiadacz może go PRZEKAZAĆ i do kiedy;
// (2) czy płacący może go sam ZWRÓCIĆ i do kiedy; (3) ile czasu na zapłatę ma
// osoba, której zwolniło się miejsce z LISTY REZERWOWEJ. Zapis wysyła wyłącznie
// klucze ekranu `policies` (`SCREEN_FIELDS`) - reguła „brak klucza = bez zmian"
// chroni ustawienia komunikacji i certyfikatu edytowane gdzie indziej.
//
// ZASADA ZWROTU JEST WYBOREM Z UZASADNIENIEM, NIE LISTĄ ROZWIJANĄ (R-A11Y):
// dwie karty `EventStudioChoiceCard` w `fieldset`/`legend`, każda ze zdaniem,
// co znaczy dla uczestnika. Pod spodem stoją STAŁE zdania o tym, jak liczy się
// termin (`LEAST(start - godziny, zapłata + 30 dni)`), że zasada zapisuje się
// przy bilecie w chwili zapłaty i że uczestnik zawsze dostaje korzystniejszy
// z dwóch terminów (R-7). Tryb „bez zwrotu" dostaje ostrzeżenie: wymaga
// zgodnego zapisu w regulaminie wydarzenia.
//
// Wczytywanie i odmowa mają własne stany - formularz na wartościach domyślnych
// nadpisałby przy zapisie prawdziwe ustawienia organizatora.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import {
  EventStudioChoiceCard,
  EventStudioPage,
  EventStudioRow,
  EventStudioSaveBar,
} from "@/components/admin/events/studio/EventStudioSection";
import { adminEventStudioErrorMessage } from "@/lib/events/adminEventStudioErrors";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import { REFUND_MODES, type ParticipantSettings } from "@/lib/events/participantSettings";
import {
  participantSettingsDirty,
  participantSettingsDraftFromSettings,
  participantSettingsPayload,
  REFUND_MODE_HINT_KEYS,
  REFUND_MODE_LABEL_KEYS,
  validateParticipantSettings,
  type ParticipantSettingsDraft,
  type ParticipantSettingsField,
} from "@/lib/events/participantSettingsDraft";
import {
  useParticipantSettings,
  useSaveParticipantSettings,
} from "@/lib/events/useParticipantSettings";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureI18n as ensureAdminEventParticipantI18n } from "@/lib/i18n-admin-event-participant";

const SCREEN = "policies";

export function EventRegistrationPoliciesPanel({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  ensureAdminEventParticipantI18n();
  const { t } = useTranslation();
  const settingsQ = useParticipantSettings(row.id);

  return (
    <EventStudioPage
      title={t("adminEvents.studio.sections.registrationPolicies")}
      description={t("adminEventParticipant.policies.description")}
    >
      {settingsQ.isPending ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : settingsQ.isError ? (
        <div role="alert" className="space-y-3 rounded-md border border-destructive/40 p-4">
          <p className="text-sm">{t("adminEventParticipant.loadError")}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void settingsQ.refetch()}
          >
            {t("adminEventParticipant.retry")}
          </Button>
        </div>
      ) : (
        <PoliciesForm row={row} settings={settingsQ.data} />
      )}
    </EventStudioPage>
  );
}

function PoliciesForm({
  row,
  settings,
}: {
  row: AdminEventDetailRow;
  settings: ParticipantSettings;
}) {
  const { t } = useTranslation();
  const saved = useMemo(() => participantSettingsDraftFromSettings(settings), [settings]);
  const [draft, setDraft] = useState<ParticipantSettingsDraft>(saved);
  const [touched, setTouched] = useState(false);
  useEffect(() => setDraft(saved), [saved]);

  const save = useSaveParticipantSettings(row.id);
  const errors = validateParticipantSettings(draft, SCREEN);
  const dirty = participantSettingsDirty(draft, saved, SCREEN) || errors.length > 0;

  const set = <K extends keyof ParticipantSettingsDraft>(
    key: K,
    value: ParticipantSettingsDraft[K],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));

  const errorFor = (field: ParticipantSettingsField): string | null => {
    if (!touched) return null;
    const found = errors.find((issue) => issue.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    save.mutate(participantSettingsPayload(row.id, draft, SCREEN), {
      onSuccess: () => toast.success(t("adminEventParticipant.save.saved")),
      onError: (error) => toast.error(adminEventStudioErrorMessage(error)),
    });
  };

  return (
    <>
      {/* ------------------------------------------------------ Przekazanie */}
      <EventStudioRow
        label={t("adminEventParticipant.policies.transfer.title")}
        description={t("adminEventParticipant.policies.transfer.description")}
      >
        <AdminFormSwitchRow
          id="event-transfer-enabled"
          label={t("adminEventParticipant.policies.transfer.enabled")}
          hint={t("adminEventParticipant.policies.transfer.enabledHint")}
          checked={draft.transferEnabled}
          onCheckedChange={(checked) => set("transferEnabled", checked)}
        />
        <AdminFormTextRow
          id="event-transfer-deadline-hours"
          label={t("adminEventParticipant.policies.transfer.deadline")}
          hint={t("adminEventParticipant.policies.transfer.deadlineHint")}
          value={draft.transferDeadlineHours}
          inputMode="numeric"
          error={errorFor("transferDeadlineHours")}
          onValueChange={(value) => set("transferDeadlineHours", value)}
        />
      </EventStudioRow>

      {/* ------------------------------------------------------------ Zwrot */}
      <EventStudioRow
        label={t("adminEventParticipant.policies.refund.title")}
        description={t("adminEventParticipant.policies.refund.description")}
      >
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">
            {t("adminEventParticipant.policies.refund.modeLegend")}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {REFUND_MODES.map((mode) => (
              <EventStudioChoiceCard
                key={mode}
                id={`event-refund-mode-${mode}`}
                name="event-refund-mode"
                checked={draft.refundMode === mode}
                label={t(REFUND_MODE_LABEL_KEYS[mode])}
                description={t(REFUND_MODE_HINT_KEYS[mode])}
                onSelect={() => set("refundMode", mode)}
              />
            ))}
          </div>
        </fieldset>
        {draft.refundMode === "none" ? (
          <p role="note" className="text-xs text-amber-600 dark:text-amber-400">
            {t("adminEventParticipant.policies.refund.noneWarning")}
          </p>
        ) : null}
        <AdminFormTextRow
          id="event-refund-deadline-hours"
          label={t("adminEventParticipant.policies.refund.deadline")}
          hint={t("adminEventParticipant.policies.refund.deadlineHint")}
          value={draft.refundDeadlineHours}
          inputMode="numeric"
          error={errorFor("refundDeadlineHours")}
          onValueChange={(value) => set("refundDeadlineHours", value)}
        />
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>{t("adminEventParticipant.policies.refund.rule")}</li>
          <li>{t("adminEventParticipant.policies.refund.snapshot")}</li>
          <li>{t("adminEventParticipant.policies.refund.favourable")}</li>
        </ul>
      </EventStudioRow>

      {/* ---------------------------------------------- Lista rezerwowa */}
      <EventStudioRow
        label={t("adminEventParticipant.policies.waitlist.title")}
        description={t("adminEventParticipant.policies.waitlist.description")}
        hint={
          <p className="text-xs text-muted-foreground">
            {t("adminEventParticipant.policies.waitlist.ticketNote")}
          </p>
        }
      >
        <AdminFormTextRow
          id="event-waitlist-offer-hours"
          label={t("adminEventParticipant.policies.waitlist.hours")}
          hint={t("adminEventParticipant.policies.waitlist.hoursHint")}
          value={draft.waitlistOfferHours}
          inputMode="numeric"
          error={errorFor("waitlistOfferHours")}
          onValueChange={(value) => set("waitlistOfferHours", value)}
        />
      </EventStudioRow>

      <EventStudioSaveBar
        dirty={dirty}
        saving={save.isPending}
        disabled={touched && errors.length > 0}
        saveLabel={t("adminEvents.studio.actions.save")}
        discardLabel={t("adminEvents.studio.actions.discard")}
        savingLabel={t("adminEvents.studio.actions.saving")}
        onSave={submit}
        onDiscard={() => {
          setDraft(saved);
          setTouched(false);
        }}
      />
    </>
  );
}
