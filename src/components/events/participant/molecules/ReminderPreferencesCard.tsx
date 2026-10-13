// Molekuła: przypomnienia o wydarzeniu dla JEDNEGO zgłoszenia (REG-09 / REG-10).
//
// PODPRZEŁĄCZNIKI POD GŁÓWNYMI. `notify_email` / `notify_sms` (sekcja kanałów)
// są głównymi przełącznikami kanału, a ta karta steruje `remind_*`. Wysyłka
// przypomnień czyta OBA (`_event_reminder_candidates`), więc karta mówi to
// wprost: przy wyłączonym e-mailu przełącznik przypomnień mailowych jest
// nieaktywny z podpowiedzią, zamiast udawać, że coś wyśle.
//
// SMS TYLKO ZA ZGODĄ. Włączenie przypomnień SMS otwiera `SmsConsentConfirm`;
// dopiero zgoda wysyła `remind_sms` (i `notify_sms`, gdy kanał był wyłączony -
// zgoda dotyczy SMS-ów o całym zgłoszeniu) razem z `sms_consent: true`. Gość
// na stronie samoobsługi nie ma sekcji kanałów, więc to jest jego jedyna droga
// do SMS-ów. Pole pokazujemy tylko wtedy, gdy platforma wysyła SMS-y
// i organizator je włączył; bez numeru jest nieaktywne.
//
// KAŻDY PRZEŁĄCZNIK WYSYŁA TYLKO SWÓJ KLUCZ - baza czyta obecność klucza,
// a brak znaczy „zostaw jak było".
//
// ZWINIĘTA DOMYŚLNIE: preferencje pobieramy dopiero po rozwinięciu.
import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SmsConsentConfirm } from "@/components/events/participant/molecules/SmsConsentConfirm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  channelErrorKey,
  setRegistrationChannels,
  type ChannelPrefs,
  type ChannelPrefsInput,
  type RegistrationPreferences,
  type RegistrationPreferencesData,
} from "@/lib/events/registrationChannelsApi";
import {
  registrationPreferencesKey,
  useParticipantSmsAvailable,
  useRegistrationPreferences,
} from "@/lib/events/useRegistrationPreferences";
import { ensureI18n } from "@/lib/i18n-participant-tickets";

ensureI18n();

/** Zgłoszenie zamknięte - przypomnienia nie wychodzą, przełączniki nic by nie zmieniły. */
const CLOSED_STATUSES: ReadonlySet<string> = new Set(["cancelled", "rejected"]);

/** Klucz listy „Moich zgłoszeń" - sekcja kanałów czyta `notify_sms` stamtąd. */
const MY_REGISTRATIONS_KEY = ["profile", "event-registrations"] as const;

type ReminderPatch = Pick<
  ChannelPrefsInput,
  "remindEmail" | "remindPush" | "remindSms" | "remindSessions" | "notifySms" | "smsConsent"
>;

function ReminderSwitch({
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  hint?: string | null;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <li className="space-y-1">
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          onCheckedChange={onCheckedChange}
        />
        <label htmlFor={id} className="text-sm text-foreground">
          {label}
        </label>
      </div>
      {hint ? (
        <p id={hintId} className="pl-11 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </li>
  );
}

function PreferencesBody({
  prefs,
  smsAvailable,
  pending,
  onChange,
  onEnableSms,
}: {
  prefs: RegistrationPreferencesData;
  smsAvailable: boolean;
  pending: boolean;
  onChange: (patch: ReminderPatch) => void;
  onEnableSms: () => void;
}) {
  const { t } = useTranslation();
  if (CLOSED_STATUSES.has(prefs.status)) {
    return (
      <p className="text-sm text-muted-foreground">{t("participantTickets.reminders.closed")}</p>
    );
  }
  if (!prefs.remindersEnabled) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("participantTickets.reminders.organizerOff")}
      </p>
    );
  }
  const smsOn = prefs.remindSms && prefs.notifySms;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t("participantTickets.reminders.lead")}</p>
      <ul className="space-y-2">
        <ReminderSwitch
          label={t("participantTickets.reminders.email")}
          hint={prefs.notifyEmail ? null : t("participantTickets.reminders.emailOff")}
          checked={prefs.remindEmail && prefs.notifyEmail}
          disabled={pending || !prefs.notifyEmail}
          onCheckedChange={(checked) => onChange({ remindEmail: checked })}
        />
        {prefs.hasAccount && (
          <ReminderSwitch
            label={t("participantTickets.reminders.push")}
            checked={prefs.remindPush}
            disabled={pending}
            onCheckedChange={(checked) => onChange({ remindPush: checked })}
          />
        )}
        {smsAvailable && prefs.reminderSmsEnabled && (
          <ReminderSwitch
            label={t("participantTickets.reminders.sms")}
            hint={
              !prefs.hasPhone
                ? t("participantTickets.reminders.smsNoPhone")
                : smsOn
                  ? null
                  : t("participantTickets.reminders.smsHint")
            }
            checked={smsOn}
            disabled={pending || !prefs.hasPhone}
            onCheckedChange={(checked) =>
              checked ? onEnableSms() : onChange({ remindSms: false })
            }
          />
        )}
        {prefs.sessionRemindersEnabled && (
          <ReminderSwitch
            label={t("participantTickets.reminders.sessions")}
            checked={prefs.remindSessions}
            disabled={pending}
            onCheckedChange={(checked) => onChange({ remindSessions: checked })}
          />
        )}
      </ul>
    </div>
  );
}

export function ReminderPreferencesCard({
  registrationId,
  manageToken = null,
}: {
  registrationId: string;
  /** Klucz z maila (strona samoobsługi); `null` = sesja właściciela. */
  manageToken?: string | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const titleId = useId();
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const smsAvailable = useParticipantSmsAvailable();
  const query = useRegistrationPreferences({ registrationId, manageToken, enabled: open });

  const save = useMutation({
    mutationFn: (patch: ReminderPatch) =>
      setRegistrationChannels(
        manageToken !== null ? { manageToken, ...patch } : { registrationId, ...patch },
      ),
    onSuccess: (saved: ChannelPrefs) => {
      queryClient.setQueryData<RegistrationPreferences>(
        registrationPreferencesKey(registrationId),
        (previous) =>
          previous?.kind === "ok"
            ? {
                ...previous,
                notifyEmail: saved.notifyEmail,
                notifySms: saved.notifySms,
                remindEmail: saved.remindEmail,
                remindPush: saved.remindPush,
                remindSms: saved.remindSms,
                remindSessions: saved.remindSessions,
                smsConsentAt: saved.smsConsentAt,
              }
            : previous,
      );
      // Włączenie SMS-a mogło przestawić też kanał na karcie zgłoszenia.
      void queryClient.invalidateQueries({ queryKey: MY_REGISTRATIONS_KEY });
      toast.success(t("participantTickets.reminders.saved"));
    },
    onError: (error: unknown) => toast.error(t(channelErrorKey(error))),
    onSettled: () => setConsentOpen(false),
  });

  const data = query.data;
  const prefs = data?.kind === "ok" ? data : null;

  return (
    <section
      className="space-y-2 rounded-[6px] border border-border/60 p-3"
      aria-labelledby={titleId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="text-sm font-semibold text-foreground">
          {t("participantTickets.reminders.title")}
        </h3>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t("participantTickets.reminders.hide") : t("participantTickets.reminders.show")}
        </Button>
      </div>
      {open && (
        <div id={bodyId}>
          {query.isPending ? (
            <Skeleton className="h-16 w-full rounded-[6px]" />
          ) : query.isError || data?.kind === "not_found" ? (
            <p className="text-sm text-muted-foreground" role="alert">
              {t("participantTickets.reminders.loadError")}
            </p>
          ) : data?.kind === "expired" ? (
            <p className="text-sm text-muted-foreground">
              {t("participantTickets.reminders.expired")}
            </p>
          ) : data?.kind === "unavailable" ? (
            <p className="text-sm text-muted-foreground">
              {t("participantTickets.reminders.unavailable")}
            </p>
          ) : prefs !== null ? (
            <>
              <PreferencesBody
                prefs={prefs}
                smsAvailable={smsAvailable}
                pending={save.isPending}
                onChange={(patch) => save.mutate(patch)}
                onEnableSms={() => setConsentOpen(true)}
              />
              <SmsConsentConfirm
                open={consentOpen}
                phoneHint={prefs.phoneHint}
                pending={save.isPending}
                onConfirm={() =>
                  save.mutate(
                    prefs.notifySms
                      ? { remindSms: true, smsConsent: true }
                      : { remindSms: true, notifySms: true, smsConsent: true },
                  )
                }
                onCancel={() => setConsentOpen(false)}
              />
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
