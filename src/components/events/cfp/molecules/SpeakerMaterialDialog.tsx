// Molekuła: okno „Materiał prelegenta" (dodanie i edycja).
//
// ADRES, NIE PLIK. Prezentację, dokument czy nagranie prelegent trzyma tam,
// gdzie chce (dysk, kanał wideo) i podaje adres https; wrzut plików jest poza
// zakresem v1. Każda zmiana wycofuje publikację - okno mówi to w opisie, żeby
// zniknięcie materiału ze strony wydarzenia nie było zaskoczeniem.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CfpSelectField, CfpTextField } from "@/components/events/cfp/molecules/CfpFormFields";
import {
  localizedPair,
  SPEAKER_MATERIAL_KIND_LABEL_KEYS,
  SPEAKER_MATERIAL_KINDS,
  SPEAKER_MATERIAL_VISIBILITIES,
  SPEAKER_MATERIAL_VISIBILITY_LABEL_KEYS,
  type SpeakerMaterialKind,
  type SpeakerMaterialVisibility,
} from "@/lib/events/cfpEnums";
import type { SpeakerMaterialInput } from "@/lib/events/cfpPublicApi";
import type { SpeakerPanelMaterial, SpeakerPanelSession } from "@/lib/events/cfpSurface";
import {
  emptySpeakerMaterialDraft,
  speakerMaterialDraftFrom,
  speakerMaterialIssue,
  speakerMaterialPayload,
  type SpeakerMaterialDraft,
} from "@/lib/events/speakerPanelDraft";
import { uiLang } from "@/lib/i18n/format";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";

/** Wartownik „bez przypisania" - Radix Select zabrania pustego `value`. */
const NO_SESSION = "__none__";

export function SpeakerMaterialDialog({
  open,
  onOpenChange,
  slug,
  material,
  sessions,
  isSaving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  /** `null` = nowy materiał. */
  material: SpeakerPanelMaterial | null;
  sessions: readonly SpeakerPanelSession[];
  isSaving: boolean;
  onSubmit: (input: SpeakerMaterialInput) => void;
}) {
  ensureEventCfpI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [draft, setDraft] = useState<SpeakerMaterialDraft>(emptySpeakerMaterialDraft);
  const [touched, setTouched] = useState(false);
  // Tożsamość materiału, nie obiekt - odświeżenie listy nie zamiata wpisanej pracy.
  const materialRef = useRef(material);
  materialRef.current = material;
  const materialId = material?.id ?? null;
  useEffect(() => {
    if (!open) return;
    const current = materialRef.current;
    setDraft(current === null ? emptySpeakerMaterialDraft() : speakerMaterialDraftFrom(current));
    setTouched(false);
  }, [open, materialId]);

  const issue = speakerMaterialIssue(draft);
  const set = <K extends keyof SpeakerMaterialDraft>(key: K, value: SpeakerMaterialDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const errorWhen = (key: string): string | null => (touched && issue === key ? t(key) : null);

  const submit = () => {
    setTouched(true);
    if (issue !== null) return;
    onSubmit(speakerMaterialPayload(slug, draft));
  };

  const sessionOptions = [NO_SESSION, ...sessions.map((session) => session.sessionId)];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("eventCfp.speaker.materials.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("eventCfp.speaker.materials.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <CfpSelectField<SpeakerMaterialKind>
            label={t("eventCfp.speaker.materials.kind")}
            value={draft.kind}
            options={SPEAKER_MATERIAL_KINDS}
            labelFor={(kind) => t(SPEAKER_MATERIAL_KIND_LABEL_KEYS[kind])}
            onChange={(kind) => set("kind", kind)}
          />
          <CfpTextField
            label={t("eventCfp.speaker.materials.titlePl")}
            value={draft.titlePl}
            maxLength={200}
            error={errorWhen("eventCfp.speaker.materials.validation.title")}
            onChange={(value) => set("titlePl", value)}
          />
          <CfpTextField
            label={t("eventCfp.speaker.materials.titleEn")}
            value={draft.titleEn}
            maxLength={200}
            onChange={(value) => set("titleEn", value)}
          />
          <CfpTextField
            label={t("eventCfp.speaker.materials.url")}
            value={draft.url}
            type="url"
            maxLength={2008}
            required
            error={errorWhen("eventCfp.speaker.materials.validation.url")}
            onChange={(value) => set("url", value)}
          />
          <CfpSelectField<SpeakerMaterialVisibility>
            label={t("eventCfp.speaker.materials.visibility")}
            value={draft.visibility}
            options={SPEAKER_MATERIAL_VISIBILITIES}
            labelFor={(visibility) => t(SPEAKER_MATERIAL_VISIBILITY_LABEL_KEYS[visibility])}
            onChange={(visibility) => set("visibility", visibility)}
          />
          {sessions.length === 0 ? null : (
            <CfpSelectField<string>
              label={t("eventCfp.speaker.materials.session")}
              value={draft.sessionId === "" ? NO_SESSION : draft.sessionId}
              options={sessionOptions}
              labelFor={(id) => {
                const session = sessions.find((entry) => entry.sessionId === id);
                return session === undefined
                  ? t("eventCfp.speaker.materials.noSession")
                  : localizedPair(lang, session.titlePl, session.titleEn);
              }}
              onChange={(id) => set("sessionId", id === NO_SESSION ? "" : id)}
            />
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("eventCfp.common.cancel")}
          </Button>
          <Button type="button" disabled={isSaving} onClick={submit}>
            {t(isSaving ? "eventCfp.common.saving" : "eventCfp.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
