// Organizm: szuflada „Zgłoszenie" - wszystko, czego organizator potrzebuje do
// decyzji: prelegenci (z kartą CRM), wystąpienie, odpowiedzi, oceny recenzentów,
// decyzja, przyjęcie z planem i mail do prelegenta.
//
// UWAGI PRYWATNE RECENZENTÓW WIDZI TYLKO PANEL. Szczegół z bazy niesie
// `comment_private`, bo decyzję podejmuje organizator; prelegent dostaje
// wyłącznie `feedback_to_speaker` - pole, które organizator pisze sam.
//
// MAIL IDZIE NA ŻĄDANIE, NIE SAM. Decyzja bywa poprawiana (odrzucenie ->
// rezerwa -> przyjęcie), a każdy mail dociera do prelegenta. Organizator
// zapisuje decyzję, sprawdza ją i dopiero wtedy wysyła - panel pokazuje, czy
// prelegent zna AKTUALNĄ decyzję (`cfpNotifyState`).
//
// KARTA CRM PER OSOBA. Zgłaszający ma kartę od wysłania zgłoszenia;
// współprelegenci dopiero od przyjęcia (wcześniej nie ma ich w `event_people`).
// Nieudana synchronizacja ma przycisk ponowienia - most CRM nigdy nie blokuje
// zapisu w module, więc bez tego przycisku błąd zostałby w bazie na zawsze.
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { CfpAcceptDialog } from "@/components/admin/events/molecules/CfpAcceptDialog";
import { CfpAnswerValue } from "@/components/events/cfp/atoms/CfpAnswerValue";
import { CfpStatusBadge } from "@/components/events/cfp/atoms/CfpStatusBadge";
import { adminCfpErrorMessage } from "@/lib/events/adminCfpErrors";
import type { CfpAcceptInput } from "@/lib/events/cfpApi";
import {
  asOneOf,
  CFP_DECISION_STATUSES,
  CFP_RECOMMENDATION_LABEL_KEYS,
  CFP_SPEAKER_ROLE_LABEL_KEYS,
  CFP_SUBMISSION_STATUS_LABEL_KEYS,
  CFP_SUBMISSION_STATUSES,
  CFP_TALK_LANGUAGE_LABEL_KEYS,
  localizedPair,
  type CfpDecisionStatus,
} from "@/lib/events/cfpEnums";
import { cfpDecisionIssue, cfpDecisionPayload, type CfpDecisionDraft } from "@/lib/events/cfpReviewDraft";
import {
  cfpNotifyFeedback,
  cfpNotifyState,
  formatCfpScore,
  isCfpDecidable,
  type CfpNotifyState,
} from "@/lib/events/cfpRows";
import type { CfpCrmLink, CfpSettings, CfpSpeakerEntry, CfpSubmissionDetail } from "@/lib/events/cfpSurface";
import { notifyCfpDecision } from "@/lib/events/cfpNotify.functions";
import { formatEventDateTime } from "@/lib/events/timezone";
import {
  cfpKeys,
  useAcceptCfpSubmission,
  useCfpSubmissionDetail,
  useDecideCfpSubmission,
  useRetryCfpCrm,
} from "@/lib/events/useEventCfp";
import { uiLang } from "@/lib/i18n/format";
import { ensureAdminEventCfpI18n } from "@/lib/i18n-admin-event-cfp";

const CRM_STATUS_KEYS: Record<CfpCrmLink["syncStatus"], string> = {
  ok: "adminEventCfp.crm.status.ok",
  error: "adminEventCfp.crm.status.error",
  skipped: "adminEventCfp.crm.status.skipped",
};

const NOTIFY_STATE_KEYS: Record<CfpNotifyState, string> = {
  notApplicable: "adminEventCfp.notify.notApplicable",
  upToDate: "adminEventCfp.notify.upToDate",
  failed: "adminEventCfp.notify.failed",
  pending: "adminEventCfp.notify.pending",
};

export function CfpSubmissionSheet({
  eventId,
  submissionId,
  settings,
  onOpenChange,
}: {
  eventId: string;
  /** `null` = szuflada zamknięta. */
  submissionId: string | null;
  settings: CfpSettings;
  onOpenChange: (open: boolean) => void;
}) {
  ensureAdminEventCfpI18n();
  const { t } = useTranslation();
  const detailQ = useCfpSubmissionDetail(eventId, submissionId);
  const detail = detailQ.data;

  return (
    <Sheet open={submissionId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t("adminEventCfp.detail.title")}</SheetTitle>
          <SheetDescription>{t("adminEventCfp.detail.description")}</SheetDescription>
        </SheetHeader>
        {detail === undefined || detail.id !== submissionId ? (
          <div className="pt-4">
            <AdminCatalogListState
              isLoading={detailQ.isLoading || detailQ.isFetching}
              loadingLabel={t("adminEventCfp.common.loading")}
              errorMessage={detailQ.error ? adminCfpErrorMessage(detailQ.error) : null}
              isEmpty={false}
              emptyLabel=""
            >
              {null}
            </AdminCatalogListState>
          </div>
        ) : (
          <CfpSubmissionBody eventId={eventId} detail={detail} settings={settings} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function CfpSubmissionBody({
  eventId,
  detail,
  settings,
}: {
  eventId: string;
  detail: CfpSubmissionDetail;
  settings: CfpSettings;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const tz = detail.eventTimezone;
  const when = (iso: string | null) => formatEventDateTime(iso, tz, lang);
  const queryClient = useQueryClient();

  const decide = useDecideCfpSubmission(eventId);
  const accept = useAcceptCfpSubmission(eventId);
  const retryCrm = useRetryCfpCrm(eventId);
  const notify = useServerFn(notifyCfpDecision);
  const [notifying, setNotifying] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);

  const initialStatus = asOneOf<CfpDecisionStatus>(CFP_DECISION_STATUSES, detail.status, "under_review");
  const [decision, setDecision] = useState<CfpDecisionDraft>({
    status: initialStatus,
    decisionNote: detail.decisionNote,
    feedbackToSpeaker: detail.feedbackToSpeaker,
  });
  const [touched, setTouched] = useState(false);
  // Świeży szczegół (po decyzji, po odświeżeniu) staje się nowym punktem wyjścia.
  useEffect(() => {
    setDecision({
      status: initialStatus,
      decisionNote: detail.decisionNote,
      feedbackToSpeaker: detail.feedbackToSpeaker,
    });
    setTouched(false);
  }, [detail.id, detail.status, detail.decisionNote, detail.feedbackToSpeaker, initialStatus]);

  const decisionIssue = cfpDecisionIssue(decision);
  const decidable = isCfpDecidable(detail.status);
  const notifyState = cfpNotifyState(detail);
  const format = detail.formats.find((entry) => entry.key === detail.formatKey) ?? null;

  const applyDecision = () => {
    setTouched(true);
    if (decisionIssue !== null) return;
    decide.mutate(cfpDecisionPayload(detail.id, decision), {
      onSuccess: () => toast.success(t("adminEventCfp.toasts.decisionSaved")),
      onError: (error) => toast.error(adminCfpErrorMessage(error)),
    });
  };

  const submitAccept = (input: CfpAcceptInput) =>
    accept.mutate(input, {
      onSuccess: (result) => {
        setAcceptOpen(false);
        toast.success(t("adminEventCfp.toasts.accepted", { count: result.speakersEnrolled }));
      },
      onError: (error) => toast.error(adminCfpErrorMessage(error)),
    });

  const sendNotice = async () => {
    setNotifying(true);
    try {
      const result = await notify({ data: { submissionId: detail.id } });
      const feedback = cfpNotifyFeedback(result);
      if (feedback === "sent") toast.success(t("adminEventCfp.toasts.notified"));
      else if (feedback === "skipped") toast.info(t("adminEventCfp.toasts.notifySkipped"));
      else toast.error(t("adminEventCfp.notify.failed"));
    } catch {
      toast.error(t("adminEventCfp.notify.failed"));
    } finally {
      setNotifying(false);
      void queryClient.invalidateQueries({ queryKey: cfpKeys.event(eventId) });
    }
  };

  const retry = (personId: string) =>
    retryCrm.mutate(personId, {
      onSuccess: () => toast.success(t("adminEventCfp.toasts.crmRetried")),
      onError: (error) => toast.error(adminCfpErrorMessage(error)),
    });

  const title = localizedPair(lang, detail.titlePl, detail.titleEn);

  return (
    <div className="space-y-4 pt-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <CfpStatusBadge status={detail.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          {detail.submittedAt === null
            ? null
            : t("adminEventCfp.detail.submittedAt", { date: when(detail.submittedAt) })}
          {detail.decidedAt === null
            ? null
            : ` · ${t("adminEventCfp.detail.decidedAt", { date: when(detail.decidedAt) })}`}
        </p>
      </div>

      <Section title={t("adminEventCfp.detail.sections.speakers")}>
        <ul className="space-y-3">
          {detail.speakers.map((speaker) => (
            <SpeakerRow
              key={speaker.id}
              speaker={speaker}
              detail={detail}
              retrying={retryCrm.isPending}
              onRetry={retry}
              when={when}
            />
          ))}
        </ul>
      </Section>

      <Section title={t("adminEventCfp.detail.sections.talk")}>
        <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">{t("adminEventCfp.detail.titlePl")}</dt>
          <dd>{detail.titlePl || "-"}</dd>
          <dt className="text-muted-foreground">{t("adminEventCfp.detail.titleEn")}</dt>
          <dd>{detail.titleEn || "-"}</dd>
          <dt className="text-muted-foreground">{t("adminEventCfp.detail.format")}</dt>
          <dd>
            {format === null
              ? t("adminEventCfp.detail.noFormat")
              : `${localizedPair(lang, format.labelPl, format.labelEn)} · ${t("adminEventCfp.detail.duration", { count: format.durationMin })}`}
          </dd>
          <dt className="text-muted-foreground">{t("adminEventCfp.detail.track")}</dt>
          <dd>
            {detail.track === null
              ? t("adminEventCfp.detail.noTrack")
              : localizedPair(lang, detail.track.namePl, detail.track.nameEn)}
          </dd>
          <dt className="text-muted-foreground">{t("adminEventCfp.detail.language")}</dt>
          <dd>{t(CFP_TALK_LANGUAGE_LABEL_KEYS[detail.talkLanguage])}</dd>
          {detail.topics.length === 0 ? null : (
            <>
              <dt className="text-muted-foreground">{t("adminEventCfp.detail.topics")}</dt>
              <dd className="flex flex-wrap gap-1">
                {detail.topics.map((topic) => (
                  <Badge key={topic} variant="outline">
                    {topic}
                  </Badge>
                ))}
              </dd>
            </>
          )}
        </dl>
        {detail.abstractPl === "" ? null : (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t("adminEventCfp.detail.abstractPl")}</p>
            <p className="whitespace-pre-line text-sm">{detail.abstractPl}</p>
          </div>
        )}
        {detail.abstractEn === "" ? null : (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t("adminEventCfp.detail.abstractEn")}</p>
            <p className="whitespace-pre-line text-sm">{detail.abstractEn}</p>
          </div>
        )}
      </Section>

      <Section title={t("adminEventCfp.detail.sections.answers")}>
        {detail.fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("adminEventCfp.detail.noAnswers")}</p>
        ) : (
          <dl className="space-y-2 text-sm">
            {detail.fields.map((field) => (
              <div key={field.key}>
                <dt className="text-xs font-medium text-muted-foreground">
                  {localizedPair(lang, field.labelPl, field.labelEn)}
                </dt>
                <dd>
                  <CfpAnswerValue field={field} value={detail.answers[field.key]} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section title={t("adminEventCfp.detail.sections.reviews")}>
        <div className="space-y-1 text-sm">
          <p>
            {t("adminEventCfp.detail.reviewsSummary", {
              count: detail.summary.reviewsCount,
              min: detail.minReviews,
            })}
          </p>
          {formatCfpScore(detail.summary.overallAvg, lang) === null ? null : (
            <p>
              {t("adminEventCfp.detail.overallAvg", {
                value: formatCfpScore(detail.summary.overallAvg, lang),
              })}
            </p>
          )}
          {formatCfpScore(detail.summary.weightedAvg, lang) === null ? null : (
            <p>
              {t("adminEventCfp.detail.weightedAvg", {
                value: formatCfpScore(detail.summary.weightedAvg, lang),
              })}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t("adminEventCfp.detail.recommendationsSummary", { ...detail.summary.recommendations })}
          </p>
          {detail.summary.reviewsCount < detail.minReviews ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t("adminEventCfp.detail.belowMin")}</p>
          ) : null}
        </div>
        {detail.reviews.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("adminEventCfp.detail.noReviews")}</p>
        ) : (
          <ul className="space-y-3">
            {detail.reviews.map((review) => (
              <li key={review.id} className="space-y-1 rounded-[6px] border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{review.reviewerName}</span>
                  <span className="text-xs text-muted-foreground">{when(review.updatedAt)}</span>
                </div>
                {review.conflictOfInterest ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">{t("adminEventCfp.detail.conflict")}</p>
                ) : (
                  <p>
                    {review.overall === null
                      ? t("adminEventCfp.detail.noOverall")
                      : t("adminEventCfp.detail.overall", { value: `${review.overall}/${detail.scoreMax}` })}
                    {review.recommendation === null
                      ? null
                      : ` · ${t("adminEventCfp.detail.recommendation")}: ${t(CFP_RECOMMENDATION_LABEL_KEYS[review.recommendation])}`}
                  </p>
                )}
                {detail.reviewCriteria.length === 0 ? null : (
                  <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {detail.reviewCriteria.map((criterion) =>
                      review.scores[criterion.key] === undefined ? null : (
                        <li key={criterion.key}>
                          {localizedPair(lang, criterion.labelPl, criterion.labelEn)}: {review.scores[criterion.key]}
                        </li>
                      ),
                    )}
                  </ul>
                )}
                {review.commentPrivate === "" ? null : (
                  <p className="whitespace-pre-line text-xs">
                    <span className="font-medium">{t("adminEventCfp.detail.commentPrivate")}: </span>
                    {review.commentPrivate}
                  </p>
                )}
                {review.commentToSpeaker === "" ? null : (
                  <p className="whitespace-pre-line text-xs">
                    <span className="font-medium">{t("adminEventCfp.detail.commentToSpeaker")}: </span>
                    {review.commentToSpeaker}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {detail.session === null ? null : (
        <Section title={t("adminEventCfp.detail.sections.session")}>
          <p className="text-sm">
            {localizedPair(lang, detail.session.titlePl, detail.session.titleEn)}
            {detail.session.startsAt === null ? null : ` · ${when(detail.session.startsAt)}`}
          </p>
          <Button asChild type="button" variant="outline" size="sm">
            <Link to="/admin/events/$eventId/content/sessions" params={{ eventId }}>
              {t("adminEventCfp.detail.openAgenda")}
            </Link>
          </Button>
        </Section>
      )}

      <Section title={t("adminEventCfp.detail.sections.decision")}>
        {decidable ? (
          <div className="space-y-3">
            <AdminFormEnumRow<CfpDecisionStatus>
              id="cfp-decision-status"
              label={t("adminEventCfp.detail.decisionStatus")}
              value={decision.status}
              options={CFP_DECISION_STATUSES}
              labelFor={(option) => t(CFP_SUBMISSION_STATUS_LABEL_KEYS[option])}
              onValueChange={(status) => setDecision((previous) => ({ ...previous, status }))}
            />
            <AdminFormTextRow
              id="cfp-decision-note"
              label={t("adminEventCfp.detail.decisionNote")}
              hint={t("adminEventCfp.detail.decisionNoteHint")}
              value={decision.decisionNote}
              rows={3}
              maxLength={2000}
              error={touched && decisionIssue === "adminEventCfp.detail.validation.noteRequired" ? t(decisionIssue) : null}
              onValueChange={(decisionNote) => setDecision((previous) => ({ ...previous, decisionNote }))}
            />
            <AdminFormTextRow
              id="cfp-decision-feedback"
              label={t("adminEventCfp.detail.feedback")}
              hint={t("adminEventCfp.detail.feedbackHint")}
              value={decision.feedbackToSpeaker}
              rows={4}
              maxLength={4000}
              error={touched && decisionIssue === "adminEventCfp.detail.validation.tooLong" ? t(decisionIssue) : null}
              onValueChange={(feedbackToSpeaker) =>
                setDecision((previous) => ({ ...previous, feedbackToSpeaker }))
              }
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={decide.isPending} onClick={applyDecision}>
                {t(decide.isPending ? "adminEventCfp.common.saving" : "adminEventCfp.detail.applyDecision")}
              </Button>
              <Button type="button" onClick={() => setAcceptOpen(true)}>
                {t("adminEventCfp.detail.accept")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("adminEventCfp.detail.notDecidable")}</p>
        )}
      </Section>

      <Section title={t("adminEventCfp.detail.sections.notify")}>
        <p className="text-xs text-muted-foreground">{t(NOTIFY_STATE_KEYS[notifyState])}</p>
        {detail.notifiedAt === null || detail.notifiedStatus === null ? null : (
          <p className="text-xs text-muted-foreground">
            {t("adminEventCfp.notify.sentAt", {
              status: t(
                CFP_SUBMISSION_STATUS_LABEL_KEYS[
                  asOneOf(CFP_SUBMISSION_STATUSES, detail.notifiedStatus, "accepted")
                ],
              ),
              date: when(detail.notifiedAt),
            })}
          </p>
        )}
        {notifyState === "notApplicable" || notifyState === "upToDate" ? null : (
          <Button type="button" size="sm" disabled={notifying} onClick={() => void sendNotice()}>
            {t(notifying ? "adminEventCfp.notify.sending" : "adminEventCfp.notify.send")}
          </Button>
        )}
      </Section>

      <CfpAcceptDialog
        open={acceptOpen}
        onOpenChange={setAcceptOpen}
        submissionId={detail.id}
        decisionNote={decision.decisionNote}
        feedbackToSpeaker={decision.feedbackToSpeaker}
        trackId={detail.trackId}
        tracks={settings.tracks}
        rooms={settings.rooms}
        isSaving={accept.isPending}
        onSubmit={submitAccept}
      />
    </div>
  );
}

function SpeakerRow({
  speaker,
  detail,
  retrying,
  onRetry,
  when,
}: {
  speaker: CfpSpeakerEntry;
  detail: CfpSubmissionDetail;
  retrying: boolean;
  onRetry: (personId: string) => void;
  when: (iso: string | null) => string;
}) {
  const { t } = useTranslation();
  const affiliation = [speaker.jobTitle, speaker.companyText].filter(Boolean).join(", ");
  const personId = speaker.personId;
  return (
    <li className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {speaker.firstName} {speaker.lastName}
        </span>
        <Badge variant="outline">{t(CFP_SPEAKER_ROLE_LABEL_KEYS[speaker.role])}</Badge>
        <span className="text-xs text-muted-foreground">
          {t(speaker.isPrimary ? "adminEventCfp.detail.primary" : "adminEventCfp.detail.coSpeaker")}
        </span>
      </div>
      {affiliation === "" ? null : <p className="text-xs text-muted-foreground">{affiliation}</p>}
      {speaker.email === null ? null : <p className="text-xs">{speaker.email}</p>}
      {speaker.isPrimary ? (
        <p className="text-xs text-muted-foreground">
          {t(detail.person.consentMarketing ? "adminEventCfp.detail.consentYes" : "adminEventCfp.detail.consentNo")}
        </p>
      ) : null}
      {personId === null ? (
        <p className="text-xs text-muted-foreground">{t("adminEventCfp.detail.pendingPerson")}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={speaker.crm?.syncStatus === "error" ? "destructive" : "secondary"}>
            {speaker.crm === null ? t("adminEventCfp.crm.none") : t(CRM_STATUS_KEYS[speaker.crm.syncStatus])}
          </Badge>
          {speaker.crm?.syncedAt ? (
            <span className="text-muted-foreground">
              {t("adminEventCfp.crm.syncedAt", { date: when(speaker.crm.syncedAt) })}
            </span>
          ) : null}
          {speaker.crm === null || speaker.crm.syncStatus === "error" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={retrying}
              onClick={() => onRetry(personId)}
            >
              {t("adminEventCfp.crm.retry")}
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}
