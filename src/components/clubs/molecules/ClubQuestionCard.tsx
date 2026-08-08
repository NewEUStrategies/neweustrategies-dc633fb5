// Molekuła: jedno pytanie w kolejce Q&A.
//
// PYTANIE BEZ ODPOWIEDZI WYGLĄDA INACZEJ NIŻ ODPOWIEDZIANE - i to jest cały
// sens tego panelu. W drzewie odpowiedzi brak reakcji jest niewidoczny; tutaj
// jest stanem, który widać z odległości metra (V1 §5.2: wątek bez odpowiedzi
// to porażka klubu, nie neutralny stan).
//
// Głos na ważność jest przyciskiem przełącznym z `aria-pressed`, a nie dwoma
// przyciskami "zagłosuj"/"cofnij": to jedna decyzja o dwóch stanach.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, CornerDownRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubStatusPill, questionTone } from "@/components/clubs/atoms/ClubStatusPill";
import { formatDateTime } from "@/lib/i18n/format";
import { toClubQuestionStatus, type ClubThreadQuestionRow } from "@/lib/clubs/threadWorkspaceTypes";

const ANSWER_MAX = 10000;

export function ClubQuestionCard({
  row,
  lang,
  votePending,
  answerPending,
  onVote,
  onAnswer,
}: {
  row: ClubThreadQuestionRow;
  lang: "pl" | "en";
  votePending: boolean;
  answerPending: boolean;
  onVote: (on: boolean) => void;
  onAnswer: (body: string) => void;
}) {
  const { t } = useTranslation();
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState(row.answer_body ?? "");
  const status = toClubQuestionStatus(row.status);
  const answered = status === "answered";

  const askerName =
    row.author_name !== null && row.author_name.length > 0
      ? row.author_name
      : row.author_alias !== null && row.author_alias.length > 0
        ? t("club.anonymousAuthor").replace("{{alias}}", row.author_alias)
        : t("club.deletedAuthor");

  return (
    <li
      className={
        "rounded-lg border p-3 transition-colors sm:p-4 " +
        (answered ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/60 bg-card")
      }
    >
      <div className="flex gap-3">
        {/* Kolumna głosu: przycisk i licznik jako jeden obiekt, bo to jedna
            informacja - "ilu jeszcze o to pyta". */}
        <div className="flex shrink-0 flex-col items-center">
          <Button
            size="sm"
            variant={row.my_vote ? "default" : "outline"}
            className="h-8 w-8 p-0"
            aria-pressed={row.my_vote}
            aria-label={t("club.threadHub.questions.vote")}
            disabled={votePending}
            onClick={() => onVote(!row.my_vote)}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <span className="mt-1 text-xs font-semibold tabular-nums">{row.vote_count}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ClubAuthorAvatar
              name={askerName}
              avatarUrl={row.author_avatar}
              muted={row.author_name === null}
            />
            <span className="text-sm font-medium">{askerName}</span>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(row.created_at, lang)}
            </span>
            <ClubStatusPill
              label={t(`club.threadHub.questionStatus.${status}`)}
              tone={questionTone(status)}
            />
          </div>

          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{row.body}</p>

          {row.answer_body !== null && row.answer_body.length > 0 ? (
            <div className="mt-3 rounded-lg border-l-2 border-emerald-500/60 bg-background/60 py-2 pl-3">
              <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CornerDownRight className="h-3 w-3" aria-hidden="true" />
                {/* Odpowiadający jest jawny TAKŻE w trybie chatham - odpowiedź
                    prowadzącego jest aktem oficjalnym, a anonimowa "odpowiedź
                    klubu" nie zobowiązuje nikogo. */}
                {row.answered_by_name !== null
                  ? t("club.threadHub.questions.answeredBy", { name: row.answered_by_name })
                  : t("club.threadHub.questions.answer")}
                {row.answered_at !== null ? ` · ${formatDateTime(row.answered_at, lang)}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{row.answer_body}</p>
            </div>
          ) : null}

          {row.can_answer ? (
            drafting ? (
              <div className="mt-3">
                <Label htmlFor={`club-answer-${row.id}`} className="text-xs">
                  {t("club.threadHub.questions.answerLabel")}
                </Label>
                <Textarea
                  id={`club-answer-${row.id}`}
                  className="mt-1"
                  rows={3}
                  maxLength={ANSWER_MAX}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={answerPending || draft.trim().length === 0}
                    onClick={() => onAnswer(draft.trim())}
                  >
                    {t("club.threadHub.questions.publishAnswer")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDrafting(false)}>
                    {t("club.threadHub.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 h-7 px-2 text-xs"
                onClick={() => {
                  setDraft(row.answer_body ?? "");
                  setDrafting(true);
                }}
              >
                {answered
                  ? t("club.threadHub.questions.editAnswer")
                  : t("club.threadHub.questions.answerCta")}
              </Button>
            )
          ) : null}
        </div>
      </div>
    </li>
  );
}
