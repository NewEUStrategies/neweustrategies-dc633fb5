// Organizm: „Komunikacja" studia wydarzenia (F1-F5, spec B.12).
//
// CZTERY RZĘDY, JEDEN ZAPIS. (1) Przypomnienia - włącznik, do czterech
// wyprzedzeń, przypomnienia o sesjach z wyprzedzeniem i przełącznik SMS;
// (2) eksport do kalendarza; (3) dziennik doręczeń (tylko do odczytu);
// (4) wiersz-drogowskaz do kampanii i newslettera w module globalnym. Zapis
// wysyła WYŁĄCZNIE klucze ekranu `communications` (`SCREEN_FIELDS`) - RPC ma
// regułę „brak klucza = bez zmian", więc ten ekran nie nadpisze zasad biletów
// ani certyfikatu, które ktoś edytuje w innej karcie.
//
// SMS WYMAGA PLATFORMY, NIE TYLKO ORGANIZATORA (R-6, S11). O tym, czy operator
// SMS jest skonfigurowany (`SMSAPI_TOKEN` + `EVENT_SMS_ENABLED`), wie tylko
// serwer - pytamy `getParticipantSmsAvailability`. Gdy SMS-ów nie ma,
// przełącznik jest wyłączony, a podpowiedź mówi dlaczego (i że przed
// włączeniem musi się zmienić polityka prywatności - notatka w docs).
//
// USTAWIENIA WCZYTUJE SAM PANEL (admin-only RPC, `assert_event_admin_tenant`).
// Wczytywanie i odmowa mają własne stany: formularz na wartościach domyślnych
// udawałby, że wydarzenie nie ma ustawień, i przy zapisie nadpisałby prawdziwe.
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { MessageDeliveryStatsTable } from "@/components/admin/events/molecules/MessageDeliveryStatsTable";
import { ReminderLeadsField } from "@/components/admin/events/molecules/ReminderLeadsField";
import {
  EventStudioPage,
  EventStudioRow,
  EventStudioSaveBar,
} from "@/components/admin/events/studio/EventStudioSection";
import { adminEventStudioErrorMessage } from "@/lib/events/adminEventStudioErrors";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import type { ParticipantSettings } from "@/lib/events/participantSettings";
import {
  participantSettingsDirty,
  participantSettingsDraftFromSettings,
  participantSettingsPayload,
  sessionLeadOptions,
  validateParticipantSettings,
  type ParticipantSettingsDraft,
  type ParticipantSettingsField,
} from "@/lib/events/participantSettingsDraft";
import { getParticipantSmsAvailability } from "@/lib/events/smsAvailability.functions";
import {
  PARTICIPANT_SMS_AVAILABILITY_KEY,
  useMessageDeliveryStats,
  useParticipantSettings,
  useSaveParticipantSettings,
} from "@/lib/events/useParticipantSettings";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureI18n as ensureAdminEventParticipantI18n } from "@/lib/i18n-admin-event-participant";

const SCREEN = "communications";

export function EventCommunicationsPanel({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  ensureAdminEventParticipantI18n();
  const { t } = useTranslation();
  const settingsQ = useParticipantSettings(row.id);

  return (
    <EventStudioPage
      title={t("adminEvents.studio.sections.communications")}
      description={t("adminEventParticipant.communications.description")}
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
        <CommunicationsForm row={row} settings={settingsQ.data} />
      )}
    </EventStudioPage>
  );
}

function CommunicationsForm({
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
  // Wiersz z serwera wygrywa po zapisie i po unieważnieniu (drugi redaktor).
  useEffect(() => setDraft(saved), [saved]);

  const save = useSaveParticipantSettings(row.id);
  const deliveriesQ = useMessageDeliveryStats(row.id);
  const readSmsAvailability = useServerFn(getParticipantSmsAvailability);
  const smsQ = useQuery({
    queryKey: PARTICIPANT_SMS_AVAILABILITY_KEY,
    queryFn: () => readSmsAvailability(),
    staleTime: 5 * 60_000,
  });
  const smsAvailable = smsQ.data?.smsEnabled === true;

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
      {/* ------------------------------------------------------ Przypomnienia */}
      <EventStudioRow
        label={t("adminEventParticipant.communications.reminders.title")}
        description={t("adminEventParticipant.communications.reminders.description")}
      >
        <AdminFormSwitchRow
          id="event-reminders-enabled"
          label={t("adminEventParticipant.communications.reminders.enabled")}
          hint={t("adminEventParticipant.communications.reminders.enabledHint")}
          checked={draft.remindersEnabled}
          onCheckedChange={(checked) => set("remindersEnabled", checked)}
        />
        <ReminderLeadsField
          value={draft.reminderEventLeadsMinutes}
          disabled={!draft.remindersEnabled}
          error={errorFor("reminderEventLeadsMinutes")}
          onChange={(next) => set("reminderEventLeadsMinutes", next)}
        />
        <AdminFormSwitchRow
          id="event-session-reminders-enabled"
          label={t("adminEventParticipant.communications.reminders.sessionEnabled")}
          hint={t("adminEventParticipant.communications.reminders.sessionEnabledHint")}
          checked={draft.sessionRemindersEnabled}
          onCheckedChange={(checked) => set("sessionRemindersEnabled", checked)}
        />
        <AdminFormEnumRow<string>
          id="event-session-reminder-lead"
          label={t("adminEventParticipant.communications.reminders.sessionLead")}
          hint={t("adminEventParticipant.communications.reminders.sessionLeadHint")}
          value={draft.sessionReminderLeadMinutes}
          options={sessionLeadOptions(draft.sessionReminderLeadMinutes)}
          labelFor={(minutes) =>
            t("adminEventParticipant.communications.reminders.sessionLeadOption", { minutes })
          }
          error={errorFor("sessionReminderLeadMinutes")}
          onValueChange={(value) => set("sessionReminderLeadMinutes", value)}
        />
        <AdminFormSwitchRow
          id="event-reminder-sms-enabled"
          label={t("adminEventParticipant.communications.reminders.sms")}
          hint={t(
            smsAvailable
              ? "adminEventParticipant.communications.reminders.smsHint"
              : "adminEventParticipant.communications.reminders.smsUnavailable",
          )}
          checked={draft.reminderSmsEnabled}
          disabled={!smsAvailable}
          onCheckedChange={(checked) => set("reminderSmsEnabled", checked)}
        />
      </EventStudioRow>

      {/* ---------------------------------------------------------- Kalendarz */}
      <EventStudioRow
        label={t("adminEventParticipant.communications.calendar.title")}
        description={t("adminEventParticipant.communications.calendar.description")}
      >
        <AdminFormSwitchRow
          id="event-calendar-export-enabled"
          label={t("adminEventParticipant.communications.calendar.enabled")}
          hint={t("adminEventParticipant.communications.calendar.enabledHint")}
          checked={draft.calendarExportEnabled}
          onCheckedChange={(checked) => set("calendarExportEnabled", checked)}
        />
      </EventStudioRow>

      {/* -------------------------------------------------- Dziennik doręczeń */}
      <EventStudioRow
        label={t("adminEventParticipant.communications.deliveries.title")}
        description={t("adminEventParticipant.communications.deliveries.description")}
      >
        {deliveriesQ.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : deliveriesQ.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("adminEventParticipant.communications.deliveries.loadError")}
          </p>
        ) : (
          <MessageDeliveryStatsTable stats={deliveriesQ.data} timezone={row.timezone} />
        )}
      </EventStudioRow>

      {/* ---------------------------------------- Kampanie (moduł globalny) */}
      <EventStudioRow
        label={t("adminEvents.studio.external.communicationsTitle")}
        description={t("adminEvents.studio.external.communicationsDescription")}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/newsletter/campaigns">
              {t("adminEvents.studio.external.openModule")}
            </Link>
          </Button>
        </div>
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
