// Molekuła: „Zgłoszenia" w panelu prelegenta - stan, informacja od
// organizatora i dozwolone kroki.
//
// PRELEGENT WIDZI TYLKO TO, CO ORGANIZATOR MU PRZEKAZAŁ. Z ocen dostaje
// wyłącznie liczbę i średnią - i dopiero po decyzji (baza nie oddaje ich
// wcześniej). Komentarze recenzentów i notatka wewnętrzna nie wychodzą poza
// panel organizatora; zdanie dla prelegenta to `feedback_to_speaker`.
//
// PRZYCISKI Z REGUŁ STANU (`cfpRows`): edycja szkicu i prośby o zmiany,
// wycofanie (szkic = usunięcie), odpowiedź na przyjęcie. Każda nieodwracalna
// zmiana pyta o potwierdzenie.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CfpStatusBadge } from "@/components/events/cfp/atoms/CfpStatusBadge";
import { confirmDialog } from "@/lib/appDialogs";
import { localizedPair } from "@/lib/events/cfpEnums";
import {
  countsTowardsCfpLimit,
  formatCfpScore,
  isCfpEditable,
  isCfpRespondable,
  isCfpWithdrawable,
} from "@/lib/events/cfpRows";
import type { CfpMySubmission, CfpMySubmissions } from "@/lib/events/cfpSurface";
import { formatEventDateTime } from "@/lib/events/timezone";
import { publicCfpErrorMessage } from "@/lib/events/publicCfpErrors";
import { useRespondCfpSubmission, useWithdrawCfpSubmission } from "@/lib/events/useCfpMe";
import { uiLang } from "@/lib/i18n/format";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";

export function SpeakerSubmissionsList({
  slug,
  data,
  canSubmit,
}: {
  slug: string;
  data: CfpMySubmissions;
  /** Nabór otwarty (z bazy) - przycisk „Nowe zgłoszenie". */
  canSubmit: boolean;
}) {
  ensureEventCfpI18n();
  const { t } = useTranslation();
  const sent = data.items.filter((item) => countsTowardsCfpLimit(item.status)).length;
  const underLimit = sent < data.maxPerSubmitter;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t("eventCfp.speaker.submissions.limit", { count: sent, max: data.maxPerSubmitter })}
        </p>
        {canSubmit && underLimit ? (
          <Button asChild size="sm">
            <Link to="/events/$slug/cfp-submit" params={{ slug }}>
              {t("eventCfp.speaker.submissions.new")}
            </Link>
          </Button>
        ) : null}
      </div>
      {data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("eventCfp.speaker.submissions.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {data.items.map((item) => (
            <SubmissionCard
              key={item.id}
              slug={slug}
              item={item}
              timezone={data.timezone}
              scoreMax={data.scoreMax}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SubmissionCard({
  slug,
  item,
  timezone,
  scoreMax,
}: {
  slug: string;
  item: CfpMySubmission;
  timezone: string;
  scoreMax: number;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const withdraw = useWithdrawCfpSubmission(slug);
  const respond = useRespondCfpSubmission(slug);
  const busy = withdraw.isPending || respond.isPending;
  const title = localizedPair(lang, item.titlePl, item.titleEn);
  const avg = formatCfpScore(item.overallAvg, lang);
  const isDraft = item.status === "draft";

  const runWithdraw = async () => {
    const confirmed = await confirmDialog({
      title: t(
        isDraft
          ? "eventCfp.speaker.submissions.deleteDraftTitle"
          : "eventCfp.speaker.submissions.withdrawTitle",
      ),
      description: t(
        isDraft
          ? "eventCfp.speaker.submissions.deleteDraftDescription"
          : "eventCfp.speaker.submissions.withdrawDescription",
      ),
      confirmLabel: t(
        isDraft
          ? "eventCfp.speaker.submissions.deleteDraft"
          : "eventCfp.speaker.submissions.withdraw",
      ),
      cancelLabel: t("eventCfp.common.cancel"),
      destructive: true,
    });
    if (!confirmed) return;
    withdraw.mutate(item.id, {
      onSuccess: (result) =>
        toast.success(
          t(
            result.status === "deleted"
              ? "eventCfp.speaker.submissions.deleted"
              : "eventCfp.speaker.submissions.withdrawn",
          ),
        ),
      onError: (error) => toast.error(publicCfpErrorMessage(error)),
    });
  };

  const runRespond = async (confirm: boolean) => {
    if (!confirm) {
      const confirmed = await confirmDialog({
        title: t("eventCfp.speaker.submissions.declineTitle"),
        description: t("eventCfp.speaker.submissions.declineDescription"),
        confirmLabel: t("eventCfp.speaker.submissions.decline"),
        cancelLabel: t("eventCfp.common.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
    }
    respond.mutate(
      { id: item.id, confirm },
      {
        onSuccess: () =>
          toast.success(
            t(
              confirm
                ? "eventCfp.speaker.submissions.confirmed"
                : "eventCfp.speaker.submissions.declined",
            ),
          ),
        onError: (error) => toast.error(publicCfpErrorMessage(error)),
      },
    );
  };

  return (
    <li className="space-y-2 rounded-[6px] border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{title === "" ? "-" : title}</h3>
        <CfpStatusBadge status={item.status} />
      </div>
      <p className="text-xs text-muted-foreground">
        {item.submittedAt === null
          ? t("eventCfp.speaker.submissions.updatedAt", {
              date: formatEventDateTime(item.updatedAt, timezone, lang),
            })
          : t("eventCfp.speaker.submissions.submittedAt", {
              date: formatEventDateTime(item.submittedAt, timezone, lang),
            })}
      </p>
      {item.status === "accepted" ? (
        <p className="text-sm">{t("eventCfp.speaker.submissions.acceptedHint")}</p>
      ) : null}
      {item.status === "confirmed" ? (
        <p className="text-sm">{t("eventCfp.speaker.submissions.confirmedHint")}</p>
      ) : null}
      {item.feedbackToSpeaker === "" ? null : (
        <div className="space-y-1 rounded-[6px] bg-muted/40 p-3">
          <p className="text-xs font-medium">{t("eventCfp.speaker.submissions.feedback")}</p>
          <p className="whitespace-pre-line text-sm">{item.feedbackToSpeaker}</p>
        </div>
      )}
      {item.reviewsCount > 0 && avg !== null ? (
        <p className="text-xs text-muted-foreground">
          {t("eventCfp.speaker.submissions.reviewsInfo", {
            count: item.reviewsCount,
            avg,
            max: scoreMax,
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {isCfpEditable(item.status) ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/events/$slug/cfp-submit" params={{ slug }} search={{ id: item.id }}>
              {t(
                isDraft
                  ? "eventCfp.speaker.submissions.continueDraft"
                  : "eventCfp.speaker.submissions.edit",
              )}
            </Link>
          </Button>
        ) : null}
        {isCfpRespondable(item.status) ? (
          <>
            <Button type="button" size="sm" disabled={busy} onClick={() => void runRespond(true)}>
              {t("eventCfp.speaker.submissions.confirm")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void runRespond(false)}
            >
              {t("eventCfp.speaker.submissions.decline")}
            </Button>
          </>
        ) : null}
        {/* Przyjęte: odpowiedź to „rezygnuję"; potwierdzone może jeszcze wycofać. */}
        {isCfpWithdrawable(item.status) && !isCfpRespondable(item.status) ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void runWithdraw()}
          >
            {t(
              isDraft
                ? "eventCfp.speaker.submissions.deleteDraft"
                : "eventCfp.speaker.submissions.withdraw",
            )}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
