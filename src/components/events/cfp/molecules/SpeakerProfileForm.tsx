// Molekuła: „Profil prelegenta" - nakładka sceniczna prelegenta w tym
// wydarzeniu (tytuł zawodowy, biogram, tematy, języki, zdjęcie).
//
// TYLKO WŁASNA NAKŁADKA. Zapis idzie przez `event_my_speaker_profile_set`,
// który sam znajduje profil wołającego (`speaker_profiles.user_id` albo jego
// karta uczestnika) - formularz nie wysyła żadnego identyfikatora profilu.
//
// ZDJĘCIE TO ADRES https. Wrzutu plików świadomie nie ma w v1 (poza zakresem
// naboru); adres sprawdza ta sama reguła, co baza.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CfpTextField } from "@/components/events/cfp/molecules/CfpFormFields";
import type { SpeakerPanelProfile } from "@/lib/events/cfpSurface";
import { publicCfpErrorMessage } from "@/lib/events/publicCfpErrors";
import {
  speakerProfileDraftFrom,
  speakerProfileIssue,
  speakerProfilePayload,
  type SpeakerProfileDraft,
} from "@/lib/events/speakerPanelDraft";
import { useSaveSpeakerProfile } from "@/lib/events/useCfpMe";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";

export function SpeakerProfileForm({
  slug,
  profile,
}: {
  slug: string;
  profile: SpeakerPanelProfile;
}) {
  ensureEventCfpI18n();
  const { t } = useTranslation();
  const save = useSaveSpeakerProfile(slug);
  const [draft, setDraft] = useState<SpeakerProfileDraft>(() => speakerProfileDraftFrom(profile));
  const [touched, setTouched] = useState(false);
  // Nowy stan z bazy (po zapisie) zastępuje formularz - ale tylko ZMIANA TREŚCI.
  // Odświeżenie w tle daje nowy obiekt o tej samej treści i nie może zamieść
  // tego, co prelegent właśnie wpisuje.
  const signature = JSON.stringify(profile);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  useEffect(() => setDraft(speakerProfileDraftFrom(profileRef.current)), [signature]);

  const issue = speakerProfileIssue(draft);
  const errorKey = touched ? issue : null;
  const set = <K extends keyof SpeakerProfileDraft>(key: K, value: SpeakerProfileDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const errorWhen = (key: string): string | null => (errorKey === key ? t(key) : null);

  const submit = () => {
    setTouched(true);
    if (issue !== null) return;
    save.mutate(speakerProfilePayload(slug, draft), {
      onSuccess: () => {
        setTouched(false);
        toast.success(t("eventCfp.speaker.profile.saved"));
      },
      onError: (error) => toast.error(publicCfpErrorMessage(error)),
    });
  };

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="text-sm text-muted-foreground">{t("eventCfp.speaker.profile.lead")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <CfpTextField
          label={t("eventCfp.speaker.profile.headlinePl")}
          value={draft.headlinePl}
          maxLength={200}
          error={errorWhen("eventCfp.speaker.profile.validation.headline")}
          onChange={(value) => set("headlinePl", value)}
        />
        <CfpTextField
          label={t("eventCfp.speaker.profile.headlineEn")}
          value={draft.headlineEn}
          maxLength={200}
          onChange={(value) => set("headlineEn", value)}
        />
        <CfpTextField
          label={t("eventCfp.speaker.profile.bioPl")}
          value={draft.bioPl}
          rows={6}
          maxLength={4000}
          error={errorWhen("eventCfp.speaker.profile.validation.bio")}
          onChange={(value) => set("bioPl", value)}
        />
        <CfpTextField
          label={t("eventCfp.speaker.profile.bioEn")}
          value={draft.bioEn}
          rows={6}
          maxLength={4000}
          onChange={(value) => set("bioEn", value)}
        />
        <CfpTextField
          label={t("eventCfp.speaker.profile.topicsPl")}
          value={draft.topicsPl}
          hint={t("eventCfp.speaker.profile.topicsHint")}
          error={errorWhen("eventCfp.speaker.profile.validation.topics")}
          onChange={(value) => set("topicsPl", value)}
        />
        <CfpTextField
          label={t("eventCfp.speaker.profile.topicsEn")}
          value={draft.topicsEn}
          hint={t("eventCfp.speaker.profile.topicsHint")}
          onChange={(value) => set("topicsEn", value)}
        />
        <CfpTextField
          label={t("eventCfp.speaker.profile.languages")}
          value={draft.languages}
          hint={t("eventCfp.speaker.profile.languagesHint")}
          error={errorWhen("eventCfp.speaker.profile.validation.languages")}
          onChange={(value) => set("languages", value)}
        />
        <CfpTextField
          label={t("eventCfp.speaker.profile.photo")}
          value={draft.cardPhotoUrl}
          type="url"
          maxLength={2048}
          hint={t("eventCfp.speaker.profile.photoHint")}
          error={errorWhen("eventCfp.speaker.profile.validation.photo")}
          onChange={(value) => set("cardPhotoUrl", value)}
        />
      </div>
      <Button type="submit" disabled={save.isPending}>
        {t(save.isPending ? "eventCfp.common.saving" : "eventCfp.common.save")}
      </Button>
    </form>
  );
}
