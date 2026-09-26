// Organizm: PANEL RECENZENTA naboru (`/events/<slug>/review[?id=<zgłoszenie>]`).
//
// KOLEJKA I OCENA NA JEDNEJ STRONIE. Lista zgłoszeń do oceny, a po wyborze -
// zgłoszenie i formularz oceny; `?id=` w adresie pozwala wrócić do tej samej
// oceny po odświeżeniu.
//
// CO WIDZI RECENZENT, ROZSTRZYGA BAZA. Przy ocenie w ciemno `speakers`
// przychodzi jako `null` (chyba że organizator dał temu recenzentowi wgląd),
// własne zgłoszenia recenzenta w kolejce się nie pojawiają, a zakres ścieżek
// zawęża listę. Panel niczego nie filtruje sam - tylko pokazuje to, co dostał.
//
// UWAGI PRYWATNE IDĄ DO ORGANIZATORA, NIE DO PRELEGENTA - formularz mówi to
// przy polu, bo to jest jedyne miejsce, w którym recenzent o tym decyduje.
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CfpSignInButton } from "@/components/events/cfp/atoms/CfpSignInButton";
import { CfpAnswerValue } from "@/components/events/cfp/atoms/CfpAnswerValue";
import { CfpStatusBadge } from "@/components/events/cfp/atoms/CfpStatusBadge";
import { CfpReviewForm } from "@/components/events/cfp/molecules/CfpReviewForm";
import { useAuth } from "@/hooks/useAuth";
import {
  CFP_SPEAKER_ROLE_LABEL_KEYS,
  CFP_TALK_LANGUAGE_LABEL_KEYS,
  localizedPair,
} from "@/lib/events/cfpEnums";
import type { CfpReviewInput } from "@/lib/events/cfpPublicApi";
import type { CfpReviewDetail, CfpReviewQueue, CfpReviewerSpeaker } from "@/lib/events/cfpSurface";
import { publicCfpErrorMessage, publicCfpFailure } from "@/lib/events/publicCfpErrors";
import { formatEventDateTime } from "@/lib/events/timezone";
import { useCfpReview, useCfpReviewQueue, useSaveCfpReview } from "@/lib/events/useCfpMe";
import { uiLang } from "@/lib/i18n/format";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";

export function ReviewerPanelPage({ slug, submissionId }: { slug: string; submissionId: string | null }) {
  ensureEventCfpI18n();
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const signedIn = session !== null;
  const queueQ = useCfpReviewQueue(slug, signedIn);

  if (loading) return <ReviewSkeleton />;
  if (!signedIn) {
    return (
      <section className="space-y-3 rounded-[6px] border border-border bg-muted/30 p-6">
        <h1 className="text-lg font-bold">{t("eventCfp.review.signInTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("eventCfp.review.signInBody")}</p>
        <CfpSignInButton
          label={t("eventCfp.common.signIn")}
          title={t("eventCfp.review.signInTitle")}
          description={t("eventCfp.review.signInBody")}
        />
      </section>
    );
  }
  if (queueQ.isLoading) return <ReviewSkeleton />;
  if (queueQ.error) {
    const notReviewer = publicCfpFailure(queueQ.error).key === "eventCfp.errors.notReviewer";
    return (
      <p className="text-sm text-muted-foreground" role="alert">
        {t(notReviewer ? "eventCfp.review.notReviewer" : "eventCfp.common.loadFailed")}
      </p>
    );
  }
  const queue = queueQ.data ?? null;
  if (queue === null) {
    return <p className="text-sm text-muted-foreground">{t("eventCfp.submit.notFound")}</p>;
  }
  return submissionId === null ? (
    <ReviewQueue slug={slug} queue={queue} />
  ) : (
    <ReviewDetail slug={slug} queue={queue} submissionId={submissionId} />
  );
}

function ReviewSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-6 w-1/3 rounded-[6px]" />
      <Skeleton className="h-32 w-full rounded-[6px]" />
    </div>
  );
}

function ReviewQueue({ slug, queue }: { slug: string; queue: CfpReviewQueue }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const reviewed = queue.items.filter((item) => item.myReview !== null).length;

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-bold">{t("eventCfp.review.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("eventCfp.review.lead")}</p>
        {queue.identityVisible ? null : <p className="text-xs">{t("eventCfp.review.blind")}</p>}
        <p className="text-xs text-muted-foreground">
          {t("eventCfp.review.progress", { count: reviewed, total: queue.items.length })}
        </p>
      </header>
      {queue.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("eventCfp.review.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {queue.items.map((item) => {
            const track = localizedPair(lang, item.trackNamePl ?? "", item.trackNameEn ?? "");
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-border p-3"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{localizedPair(lang, item.titlePl, item.titleEn)}</span>
                    <CfpStatusBadge status={item.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[track, t(CFP_TALK_LANGUAGE_LABEL_KEYS[item.talkLanguage]), formatEventDateTime(item.submittedAt, queue.timezone, lang)]
                      .filter((part) => part !== "")
                      .join(" · ")}
                  </p>
                  {item.speakers === null ? null : (
                    <p className="text-xs">
                      {item.speakers.map((speaker) => `${speaker.firstName} ${speaker.lastName}`).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={item.myReview === null ? "outline" : "secondary"}>
                    {t(
                      item.myReview === null
                        ? "eventCfp.review.toReview"
                        : item.myReview.conflictOfInterest
                          ? "eventCfp.review.conflictDeclared"
                          : "eventCfp.review.reviewed",
                    )}
                  </Badge>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/events/$slug/review" params={{ slug }} search={{ id: item.id }}>
                      {t("eventCfp.review.open")}
                    </Link>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SpeakersBlock({ speakers }: { speakers: CfpReviewerSpeaker[] }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1 text-sm">
      {speakers.map((speaker, index) => (
        <li key={`${speaker.lastName}-${index}`}>
          <span className="font-medium">
            {speaker.firstName} {speaker.lastName}
          </span>{" "}
          <span className="text-xs text-muted-foreground">
            {t(CFP_SPEAKER_ROLE_LABEL_KEYS[speaker.role])}
            {[speaker.jobTitle, speaker.companyText].filter(Boolean).length > 0
              ? ` · ${[speaker.jobTitle, speaker.companyText].filter(Boolean).join(", ")}`
              : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReviewDetail({
  slug,
  queue,
  submissionId,
}: {
  slug: string;
  queue: CfpReviewQueue;
  submissionId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reviewQ = useCfpReview(slug, submissionId);
  const save = useSaveCfpReview(slug);

  const back = (
    <Button asChild size="sm" variant="ghost">
      <Link to="/events/$slug/review" params={{ slug }} search={{}}>
        {t("eventCfp.review.back")}
      </Link>
    </Button>
  );

  if (reviewQ.isLoading) return <ReviewSkeleton />;
  if (reviewQ.error || reviewQ.data === undefined) {
    return (
      <section className="space-y-3">
        <p className="text-sm text-muted-foreground" role="alert">
          {reviewQ.error ? publicCfpErrorMessage(reviewQ.error) : t("eventCfp.common.loadFailed")}
        </p>
        {back}
      </section>
    );
  }

  const submit = (input: CfpReviewInput) =>
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t("eventCfp.review.saved"));
        void navigate({ to: "/events/$slug/review", params: { slug }, search: {} });
      },
      onError: (error) => toast.error(publicCfpErrorMessage(error)),
    });

  return (
    <section className="space-y-6">
      {back}
      <ReviewSubmission detail={reviewQ.data} timezone={queue.timezone} />
      <CfpReviewForm key={reviewQ.data.submission.id} detail={reviewQ.data} isSaving={save.isPending} onSubmit={submit} />
    </section>
  );
}

function ReviewSubmission({ detail, timezone }: { detail: CfpReviewDetail; timezone: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const sub = detail.submission;
  const format = detail.formats.find((entry) => entry.key === sub.formatKey) ?? null;
  const meta = [
    detail.track === null ? "" : localizedPair(lang, detail.track.namePl, detail.track.nameEn),
    format === null ? "" : localizedPair(lang, format.labelPl, format.labelEn),
    t(CFP_TALK_LANGUAGE_LABEL_KEYS[sub.talkLanguage]),
    formatEventDateTime(sub.submittedAt, timezone, lang),
  ].filter((part) => part !== "");
  const abstract = localizedPair(lang, sub.abstractPl, sub.abstractEn);

  return (
    <article className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">{localizedPair(lang, sub.titlePl, sub.titleEn)}</h1>
        <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>
        {detail.identityVisible ? null : <p className="text-xs">{t("eventCfp.review.blind")}</p>}
      </header>
      {detail.speakers === null ? null : (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">{t("eventCfp.review.speakers")}</h2>
          <SpeakersBlock speakers={detail.speakers} />
        </section>
      )}
      <section className="space-y-1">
        <h2 className="text-sm font-semibold">{t("eventCfp.review.abstract")}</h2>
        <p className="whitespace-pre-line text-sm leading-relaxed">{abstract}</p>
      </section>
      {sub.topics.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1">
          {sub.topics.map((topic) => (
            <li key={topic}>
              <Badge variant="outline">{topic}</Badge>
            </li>
          ))}
        </ul>
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("eventCfp.review.answers")}</h2>
        {detail.fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("eventCfp.review.noAnswers")}</p>
        ) : (
          <dl className="space-y-2 text-sm">
            {detail.fields.map((field) => (
              <div key={field.key}>
                <dt className="text-xs font-medium text-muted-foreground">
                  {localizedPair(lang, field.labelPl, field.labelEn)}
                </dt>
                <dd>
                  <CfpAnswerValue field={field} value={sub.answers[field.key]} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </article>
  );
}
