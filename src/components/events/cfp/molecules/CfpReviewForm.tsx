// Molekuła: formularz OCENY zgłoszenia w panelu recenzenta.
//
// OCENA OGÓLNA JEST WYMAGANA, CHYBA ŻE recenzent się wstrzymuje albo zgłasza
// konflikt interesów - ta sama reguła co `score_required` w bazie. Kryteria są
// opcjonalne (organizator może ich nie mieć); skala 1..`score_max` z ustawień.
//
// PRZYCISKI SKALI, NIE POLE LICZBOWE. Pięć albo dziesięć przycisków z
// `aria-pressed` jest szybsze od wpisywania i nie przyjmie liczby spoza skali.
//
// ZAPIS ZASTĘPUJE CAŁĄ OCENĘ (`event_cfp_review_save`), więc formularz zawsze
// wysyła komplet pól - także puste komentarze.
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CfpSelectField, CfpTextField } from "@/components/events/cfp/molecules/CfpFormFields";
import {
  CFP_RECOMMENDATION_LABEL_KEYS,
  CFP_RECOMMENDATIONS,
  localizedPair,
  type CfpRecommendation,
} from "@/lib/events/cfpEnums";
import type { CfpReviewInput } from "@/lib/events/cfpPublicApi";
import {
  cfpReviewDraftFrom,
  cfpReviewIssue,
  cfpReviewPayload,
  scoreScale,
  type CfpReviewDraft,
} from "@/lib/events/cfpReviewDraft";
import type { CfpReviewDetail } from "@/lib/events/cfpSurface";
import { uiLang } from "@/lib/i18n/format";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";

/** Wartownik „bez rekomendacji" - Radix Select zabrania pustego `value`. */
const NO_RECOMMENDATION = "__none__";

function ScoreButtons({
  label,
  value,
  max,
  onChange,
  clearLabel,
}: {
  label: string;
  value: number | null;
  max: number;
  onChange: (value: number | null) => void;
  clearLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {scoreScale(max).map((score) => (
          <Button
            key={score}
            type="button"
            size="sm"
            variant={value === score ? "default" : "outline"}
            aria-pressed={value === score}
            aria-label={t("eventCfp.review.scoreButton", { label, score })}
            onClick={() => onChange(score)}
          >
            {score}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={value === null}
          onClick={() => onChange(null)}
        >
          {clearLabel}
        </Button>
      </div>
    </fieldset>
  );
}

export function CfpReviewForm({
  detail,
  isSaving,
  onSubmit,
}: {
  detail: CfpReviewDetail;
  isSaving: boolean;
  onSubmit: (input: CfpReviewInput) => void;
}) {
  ensureEventCfpI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [draft, setDraft] = useState<CfpReviewDraft>(() =>
    cfpReviewDraftFrom(detail.review, detail.reviewCriteria),
  );
  const [touched, setTouched] = useState(false);
  const issue = cfpReviewIssue(draft);
  const set = <K extends keyof CfpReviewDraft>(key: K, value: CfpReviewDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (issue !== null) return;
    onSubmit(cfpReviewPayload(detail.submission.id, draft));
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
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={draft.conflictOfInterest}
          onCheckedChange={(checked) => set("conflictOfInterest", checked === true)}
        />
        <span>
          {t("eventCfp.review.conflict")}
          <span className="block text-xs text-muted-foreground">
            {t("eventCfp.review.conflictHint")}
          </span>
        </span>
      </label>

      <ScoreButtons
        label={t("eventCfp.review.overall")}
        value={draft.overall}
        max={detail.scoreMax}
        clearLabel={t("eventCfp.review.clearScore")}
        onChange={(value) => set("overall", value)}
      />
      {touched && issue === "eventCfp.review.validation.overall" ? (
        <p className="text-xs text-destructive" role="alert">
          {t(issue)}
        </p>
      ) : null}

      {detail.reviewCriteria.length === 0 ? null : (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">{t("eventCfp.review.criteria")}</h3>
          {detail.reviewCriteria.map((criterion) => (
            <ScoreButtons
              key={criterion.key}
              label={localizedPair(lang, criterion.labelPl, criterion.labelEn)}
              value={draft.scores[criterion.key] ?? null}
              max={detail.scoreMax}
              clearLabel={t("eventCfp.review.clearScore")}
              onChange={(value) => set("scores", { ...draft.scores, [criterion.key]: value })}
            />
          ))}
        </div>
      )}

      <CfpSelectField<string>
        label={t("eventCfp.review.recommendation")}
        value={draft.recommendation ?? NO_RECOMMENDATION}
        options={[NO_RECOMMENDATION, ...CFP_RECOMMENDATIONS]}
        labelFor={(option) => {
          const known = CFP_RECOMMENDATIONS.find((entry) => entry === option);
          return known === undefined
            ? t("eventCfp.review.noRecommendation")
            : t(CFP_RECOMMENDATION_LABEL_KEYS[known]);
        }}
        onChange={(option) => {
          const known: CfpRecommendation | undefined = CFP_RECOMMENDATIONS.find(
            (entry) => entry === option,
          );
          set("recommendation", known ?? null);
        }}
      />
      <CfpTextField
        label={t("eventCfp.review.commentPrivate")}
        hint={t("eventCfp.review.commentPrivateHint")}
        value={draft.commentPrivate}
        rows={4}
        maxLength={4000}
        onChange={(value) => set("commentPrivate", value)}
      />
      <CfpTextField
        label={t("eventCfp.review.commentToSpeaker")}
        hint={t("eventCfp.review.commentToSpeakerHint")}
        value={draft.commentToSpeaker}
        rows={4}
        maxLength={4000}
        error={touched && issue === "eventCfp.review.validation.comments" ? t(issue) : null}
        onChange={(value) => set("commentToSpeaker", value)}
      />
      <Button type="submit" disabled={isSaving}>
        {t(isSaving ? "eventCfp.common.saving" : "eventCfp.review.save")}
      </Button>
    </form>
  );
}
