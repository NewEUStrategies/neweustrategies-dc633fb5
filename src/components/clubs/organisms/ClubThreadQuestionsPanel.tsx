// Organizm: panel „Pytania" (Q&A).
//
// Sort domyślny to „najważniejsze", nie „najnowsze". Prowadzący, który ma
// dziesięć minut i dwadzieścia pytań, ma zacząć od tego, co ludzi obchodzi
// najbardziej - kolejność wpisywania jest tu informacją bezużyteczną.
//
// Nad listą stoi licznik pytań BEZ ODPOWIEDZI, bo to jedyna liczba w tym
// panelu, która wymaga działania.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClubWorkspaceEmpty } from "@/components/clubs/atoms/ClubWorkspaceEmpty";
import { ClubThreadListSkeleton } from "@/components/clubs/atoms/ClubSkeletons";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { ClubQuestionCard } from "@/components/clubs/molecules/ClubQuestionCard";
import {
  useAnswerClubThreadQuestion,
  useAskClubThreadQuestion,
  useClubThreadQuestions,
  useVoteClubThreadQuestion,
} from "@/lib/clubs/useThreadWorkspace";
import {
  CLUB_QUESTION_SORTS,
  toClubWorkspaceError,
  type ClubQuestionSort,
} from "@/lib/clubs/threadWorkspaceTypes";

const QUESTION_MAX = 2000;

export function ClubThreadQuestionsPanel({
  threadId,
  lang,
  canContribute,
  /** Tryb atrybucji klubu dopuszcza wpis pod aliasem - baza odrzuci pytanie
   *  anonimowe tam, gdzie klub tego nie przewiduje, więc przełącznik ma się
   *  wtedy w ogóle nie pokazywać. */
  canGoAnonymous,
}: {
  threadId: string;
  lang: "pl" | "en";
  canContribute: boolean;
  canGoAnonymous: boolean;
}) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<ClubQuestionSort>("top");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);

  const query = useClubThreadQuestions({ threadId, sort });
  const ask = useAskClubThreadQuestion(threadId);
  const answer = useAnswerClubThreadQuestion(threadId);
  const vote = useVoteClubThreadQuestion(threadId);

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const openCount = useMemo(() => rows.filter((row) => row.status === "open").length, [rows]);

  const failed = (error: unknown) =>
    toast.error(t(`club.threadHub.error.${toClubWorkspaceError(error)}`));

  if (query.isPending) return <ClubThreadListSkeleton count={3} />;
  if (query.isError) return <ClubErrorNotice onRetry={() => void query.refetch()} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {openCount > 0
            ? t("club.threadHub.questions.openCount", { count: openCount })
            : t("club.threadHub.questions.allAnswered")}
        </p>
        {rows.length > 1 ? (
          <Select value={sort} onValueChange={(value) => setSort(value as ClubQuestionSort)}>
            <SelectTrigger
              className="h-8 w-auto min-w-40"
              aria-label={t("club.threadHub.questions.sortLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLUB_QUESTION_SORTS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`club.threadHub.questionSort.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <ClubWorkspaceEmpty
          icon={<HelpCircle className="h-5 w-5" />}
          title={t("club.threadHub.questions.empty")}
          hint={
            canContribute
              ? t("club.threadHub.questions.emptyHint")
              : t("club.threadHub.questions.emptyReadonly")
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <ClubQuestionCard
              key={row.id}
              row={row}
              lang={lang}
              votePending={vote.isPending}
              answerPending={answer.isPending}
              onVote={(on) => vote.mutate({ questionId: row.id, on }, { onError: failed })}
              onAnswer={(text) =>
                answer.mutate(
                  { questionId: row.id, body: text },
                  {
                    onSuccess: () => toast.success(t("club.threadHub.questions.answerSaved")),
                    onError: failed,
                  },
                )
              }
            />
          ))}
        </ul>
      )}

      {canContribute ? (
        <section className="rounded-lg border border-border/60 bg-card p-4 shadow-sm">
          <Label htmlFor="club-question-body" className="text-sm font-medium">
            {t("club.threadHub.questions.askLabel")}
          </Label>
          <Textarea
            id="club-question-body"
            className="mt-2"
            rows={3}
            maxLength={QUESTION_MAX}
            placeholder={t("club.threadHub.questions.askPlaceholder")}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {canGoAnonymous ? (
                <div className="flex items-center gap-2">
                  <Switch
                    id="club-question-anon"
                    checked={anonymous}
                    disabled={ask.isPending}
                    onCheckedChange={setAnonymous}
                  />
                  <Label htmlFor="club-question-anon" className="text-sm font-normal">
                    {t("club.postAnonymously")}
                  </Label>
                </div>
              ) : null}
              <span className="text-xs text-muted-foreground tabular-nums">
                {body.trim().length} / {QUESTION_MAX}
              </span>
            </div>
            <Button
              size="sm"
              disabled={ask.isPending || body.trim().length < 5}
              onClick={() =>
                ask.mutate(
                  { body: body.trim(), anonymous },
                  {
                    onSuccess: () => {
                      setBody("");
                      setAnonymous(false);
                      toast.success(t("club.threadHub.questions.asked"));
                    },
                    onError: failed,
                  },
                )
              }
            >
              {t("club.threadHub.questions.ask")}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
