// Molekuła: współprelegenci zgłoszenia (do pięciu osób).
//
// DANE WPISANE, NIE KONTA. Współprelegent nie musi mieć konta ani karty
// uczestnika - organizator zakłada ją (i kontakt w CRM) dopiero przy przyjęciu
// wystąpienia. Do tego czasu to kilka pól tekstu w zgłoszeniu; e-mail jest
// opcjonalny, bo zgłaszający nie zawsze go zna.
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { CfpSelectField, CfpTextField } from "@/components/events/cfp/molecules/CfpFormFields";
import {
  CFP_SPEAKER_ROLE_LABEL_KEYS,
  CFP_SPEAKER_ROLES,
  type CfpSpeakerRole,
} from "@/lib/events/cfpEnums";
import {
  CFP_MAX_CO_SPEAKERS,
  emptyCoSpeakerDraft,
  type CfpCoSpeakerDraft,
} from "@/lib/events/cfpSubmissionDraft";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";

export function CfpCoSpeakersEditor({
  speakers,
  onChange,
  error,
}: {
  speakers: readonly CfpCoSpeakerDraft[];
  onChange: (speakers: CfpCoSpeakerDraft[]) => void;
  error: string | null;
}) {
  ensureEventCfpI18n();
  const { t } = useTranslation();
  const update = (index: number, patch: Partial<CfpCoSpeakerDraft>) =>
    onChange(speakers.map((speaker, i) => (i === index ? { ...speaker, ...patch } : speaker)));

  return (
    <div className="space-y-3">
      {speakers.map((speaker, index) => (
        <fieldset
          key={`co-speaker-${index}`}
          className="space-y-3 rounded-[6px] border border-border p-3"
        >
          <legend className="px-1 text-sm font-medium">
            {t("eventCfp.submit.coSpeaker.legend", { index: index + 1 })}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <CfpTextField
              label={t("eventCfp.submit.coSpeaker.firstName")}
              value={speaker.firstName}
              maxLength={100}
              required
              onChange={(firstName) => update(index, { firstName })}
            />
            <CfpTextField
              label={t("eventCfp.submit.coSpeaker.lastName")}
              value={speaker.lastName}
              maxLength={100}
              required
              onChange={(lastName) => update(index, { lastName })}
            />
            <CfpTextField
              label={t("eventCfp.submit.coSpeaker.email")}
              value={speaker.email}
              type="email"
              maxLength={254}
              hint={t("eventCfp.submit.coSpeaker.emailHint")}
              onChange={(email) => update(index, { email })}
            />
            <CfpSelectField<CfpSpeakerRole>
              label={t("eventCfp.submit.coSpeaker.role")}
              value={speaker.role}
              options={CFP_SPEAKER_ROLES}
              labelFor={(role) => t(CFP_SPEAKER_ROLE_LABEL_KEYS[role])}
              onChange={(role) => update(index, { role })}
            />
            <CfpTextField
              label={t("eventCfp.submit.coSpeaker.jobTitle")}
              value={speaker.jobTitle}
              maxLength={200}
              onChange={(jobTitle) => update(index, { jobTitle })}
            />
            <CfpTextField
              label={t("eventCfp.submit.coSpeaker.company")}
              value={speaker.companyText}
              maxLength={200}
              onChange={(companyText) => update(index, { companyText })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(speakers.filter((_, i) => i !== index))}
          >
            {t("eventCfp.submit.coSpeaker.remove")}
          </Button>
        </fieldset>
      ))}
      {error === null ? null : (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={speakers.length >= CFP_MAX_CO_SPEAKERS}
          onClick={() => onChange([...speakers, emptyCoSpeakerDraft()])}
        >
          {t("eventCfp.submit.coSpeaker.add")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("eventCfp.submit.coSpeaker.max")}</span>
      </div>
    </div>
  );
}
