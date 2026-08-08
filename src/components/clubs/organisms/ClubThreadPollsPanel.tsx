// Organizm: panel „Głosowania" - wiele ankiet na jeden wątek.
//
// Do A20 wątek niósł DOKŁADNIE JEDNĄ ankietę i tylko rodzaj `poll`. To
// wystarcza sondażowi, nie wystarcza dyskusji, która po trzech tygodniach
// potrzebuje rozstrzygnięcia w trzech sprawach naraz. A28 dokłada tabelę
// łączącą - i ani jednej linii nowej mechaniki głosowania: każdą ankietę
// rysuje ten sam `ClubThreadPoll`, czyli ten sam `PollCard`, co /polls,
// z anti-anchoringiem włącznie.
//
// Zakładanie ankiety jest jednym wywołaniem RPC (`club_thread_poll_create`),
// bo ankieta i krawędź muszą powstać w jednej transakcji - rozdzielenie
// zostawiałoby przy błędzie ankietę-sierotę.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClubWorkspaceEmpty } from "@/components/clubs/atoms/ClubWorkspaceEmpty";
import { ClubStatusPill } from "@/components/clubs/atoms/ClubStatusPill";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { ClubThreadPoll } from "@/components/clubs/organisms/ClubThreadPoll";
import {
  useClubThreadPolls,
  useCreateClubThreadPoll,
  useDetachClubThreadPoll,
} from "@/lib/clubs/useThreadWorkspace";
import { toClubWorkspaceError } from "@/lib/clubs/threadWorkspaceTypes";

/** Baza przyjmuje 2-8 wariantów (CHECK w `club_thread_poll_create`). Formularz
 *  zna tę samą granicę, więc odmowa nie przychodzi dopiero po wysłaniu. */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;

function PollComposer({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: { questionPl: string; questionEn: string; options: string[] }) => void;
}) {
  const { t } = useTranslation();
  const [questionPl, setQuestionPl] = useState("");
  const [questionEn, setQuestionEn] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);

  const filled = options.map((option) => option.trim()).filter((option) => option.length > 0);
  // Oba języki są WYMAGANE: ankieta zapisana tylko po polsku wyświetli pustą
  // treść czytelnikowi z EN, a `polls.question_en` jest NOT NULL.
  const invalid =
    questionPl.trim().length < 3 || questionEn.trim().length < 3 || filled.length < MIN_OPTIONS;

  return (
    <form
      className="rounded-lg border border-border/60 bg-card p-4 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid) return;
        onSubmit({
          questionPl: questionPl.trim(),
          questionEn: questionEn.trim(),
          options: filled,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="club-poll-pl">{t("club.threadHub.polls.questionPl")}</Label>
          <Input
            id="club-poll-pl"
            className="mt-1"
            value={questionPl}
            maxLength={300}
            required
            onChange={(event) => setQuestionPl(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="club-poll-en">{t("club.threadHub.polls.questionEn")}</Label>
          <Input
            id="club-poll-en"
            className="mt-1"
            value={questionEn}
            maxLength={300}
            required
            onChange={(event) => setQuestionEn(event.target.value)}
          />
        </div>
      </div>

      <fieldset className="mt-3">
        <legend className="text-sm font-medium">{t("club.threadHub.polls.optionsLabel")}</legend>
        <div className="mt-2 space-y-2">
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={option}
                maxLength={200}
                aria-label={t("club.threadHub.polls.optionAria", { index: index + 1 })}
                onChange={(event) =>
                  setOptions((current) =>
                    current.map((item, i) => (i === index ? event.target.value : item)),
                  )
                }
              />
              {options.length > MIN_OPTIONS ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 p-0"
                  aria-label={t("club.threadHub.polls.removeOption")}
                  onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        {options.length < MAX_OPTIONS ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => setOptions((current) => [...current, ""])}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("club.threadHub.polls.addOption")}
          </Button>
        ) : null}
      </fieldset>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || invalid}>
          {t("club.threadHub.polls.create")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("club.threadHub.cancel")}
        </Button>
      </div>
    </form>
  );
}

export function ClubThreadPollsPanel({
  threadId,
  lang,
  userId,
  canCurate,
}: {
  threadId: string;
  lang: "pl" | "en";
  userId: string | null;
  canCurate: boolean;
}) {
  const { t } = useTranslation();
  const [composing, setComposing] = useState(false);

  const query = useClubThreadPolls({ threadId });
  const create = useCreateClubThreadPoll(threadId);
  const detach = useDetachClubThreadPoll(threadId);

  const rows = query.data ?? [];

  if (query.isPending) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />;
  }
  if (query.isError) return <ClubErrorNotice onRetry={() => void query.refetch()} />;

  return (
    <div className="space-y-3">
      {canCurate && !composing ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setComposing(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("club.threadHub.polls.create")}
          </Button>
        </div>
      ) : null}

      {composing ? (
        <PollComposer
          pending={create.isPending}
          onCancel={() => setComposing(false)}
          onSubmit={(input) =>
            create.mutate(input, {
              onSuccess: () => {
                setComposing(false);
                toast.success(t("club.threadHub.polls.created"));
              },
              onError: (error) =>
                toast.error(t(`club.threadHub.error.${toClubWorkspaceError(error)}`)),
            })
          }
        />
      ) : null}

      {rows.length === 0 ? (
        <ClubWorkspaceEmpty
          icon={<Vote className="h-5 w-5" />}
          title={t("club.threadHub.polls.empty")}
          hint={
            canCurate
              ? t("club.threadHub.polls.emptyHint")
              : t("club.threadHub.polls.emptyReadonly")
          }
        />
      ) : (
        <ul className="space-y-4">
          {rows.map((row) => (
            <li key={row.id}>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {row.label !== null && row.label.length > 0 ? (
                    <span className="text-sm font-medium">{row.label}</span>
                  ) : null}
                  <ClubStatusPill
                    label={t(
                      row.poll_status === "open"
                        ? "club.threadHub.polls.open"
                        : "club.threadHub.polls.closed",
                    )}
                    tone={row.poll_status === "open" ? "active" : "done"}
                  />
                </div>
                {row.can_remove ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => {
                      if (!window.confirm(t("club.threadHub.polls.detachConfirm"))) return;
                      detach.mutate(row.id, {
                        onSuccess: () => toast.success(t("club.threadHub.polls.detached")),
                        onError: (error) =>
                          toast.error(t(`club.threadHub.error.${toClubWorkspaceError(error)}`)),
                      });
                    }}
                  >
                    {t("club.threadHub.polls.detach")}
                  </Button>
                ) : null}
              </div>
              <ClubThreadPoll pollId={row.poll_id} lang={lang} userId={userId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
