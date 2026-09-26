// Molekuła: KIEDY PRZYPOMINAĆ O WYDARZENIU - wybór do czterech wyprzedzeń.
//
// GRUPA PÓL WYBORU, NIE LISTA ROZWIJANA (R-A11Y). Organizator wybiera kilka
// terminów naraz („24 godziny przed" i „1 godzina przed"), więc kontrolką jest
// `fieldset` z `legend` i natywną semantyką pól wyboru z `Label htmlFor`.
//
// LIMIT JEST WIDOCZNY, NIE CICHY. Baza przyjmuje najwyżej cztery wyprzedzenia
// (`event_participant_settings_leads_shape`). Przy czterech zaznaczonych
// pozostałe pola są wyłączone, a podpowiedź mówi DLACZEGO - wyłączone pole bez
// zdania wygląda na zepsute.
//
// WARTOŚĆ SPOZA LISTY GOTOWYCH (np. 90 min z importu) nie znika z ekranu:
// dostaje własne pole z etykietą „N min przed", żeby dało się ją odznaczyć.
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  PARTICIPANT_SETTINGS_LIMITS,
  REMINDER_LEAD_PRESETS_MINUTES,
  type LeadPreset,
} from "@/lib/events/participantSettings";
import { LEAD_PRESET_LABEL_KEYS, reminderLeadOptions } from "@/lib/events/participantSettingsDraft";
import { ensureI18n as ensureAdminEventParticipantI18n } from "@/lib/i18n-admin-event-participant";

function isLeadPreset(minutes: number): minutes is LeadPreset {
  return (REMINDER_LEAD_PRESETS_MINUTES as readonly number[]).includes(minutes);
}

export function ReminderLeadsField({
  value,
  onChange,
  disabled = false,
  error = null,
}: {
  value: readonly number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
  /** Gotowy komunikat walidacji - wiąże `aria-invalid` i `aria-describedby`. */
  error?: string | null;
}) {
  ensureAdminEventParticipantI18n();
  const { t } = useTranslation();
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-err`;
  const atLimit = value.length >= PARTICIPANT_SETTINGS_LIMITS.leadsMax;
  const describedBy = error === null ? hintId : `${errorId} ${hintId}`;

  return (
    <fieldset
      className="space-y-2"
      disabled={disabled}
      aria-describedby={describedBy}
      aria-invalid={error === null ? undefined : true}
    >
      <legend className="text-sm font-medium">
        {t("adminEventParticipant.communications.reminders.leadsLegend")}
      </legend>
      <p id={hintId} className="text-xs text-muted-foreground">
        {t(
          atLimit
            ? "adminEventParticipant.communications.reminders.leadsLimit"
            : "adminEventParticipant.communications.reminders.leadsHint",
        )}
      </p>
      <div className="grid gap-1 sm:grid-cols-2">
        {reminderLeadOptions(value).map((minutes) => {
          const checked = value.includes(minutes);
          const id = `${baseId}-${minutes}`;
          return (
            <div key={minutes} className="flex items-center gap-2 rounded px-1 py-1">
              <Checkbox
                id={id}
                checked={checked}
                disabled={disabled || (atLimit && !checked)}
                onCheckedChange={(next) =>
                  onChange(
                    next === true ? [...value, minutes] : value.filter((lead) => lead !== minutes),
                  )
                }
              />
              <Label htmlFor={id} className="text-[13px] font-normal">
                {isLeadPreset(minutes)
                  ? t(LEAD_PRESET_LABEL_KEYS[minutes])
                  : t("adminEventParticipant.communications.leads.custom", { minutes })}
              </Label>
            </div>
          );
        })}
      </div>
      {error === null ? null : (
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
