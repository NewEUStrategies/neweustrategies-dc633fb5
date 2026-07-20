// Karta ankiety Community - wspólny komponent strony /polls i bloku "poll"
// w treści wpisu (międzymodułowość: jedna implementacja głosowania, słupków
// i anti-anchoringu zamiast dwóch rozjeżdżających się kopii).
//
// Anti-anchoring: dopóki użytkownik nie zagłosuje (a ankieta jest otwarta
// i nie jest się staffem), serwer zwraca visible=false i nie ma liczb -
// rozkład głosów nie może zakotwiczać wyboru. Całość egzekwuje RPC vote_poll.
import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { EyeOff, Vote } from "lucide-react";
import { votePoll, type PublicPoll, type PollResults } from "@/lib/community/publicQueries";
import "@/lib/i18n-community";

export interface PollCardProps {
  poll: PublicPoll;
  results: PollResults | undefined;
  lang: "pl" | "en";
  userId: string | null;
}

export function PollCard({ poll, results, lang, userId }: PollCardProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const closed = poll.status === "closed";
  const visible = results?.visible === true;
  const total = visible ? (results?.total ?? 0) : 0;
  const myChoice = results?.my_vote ?? null;
  const question =
    lang === "en" ? poll.question_en || poll.question_pl : poll.question_pl || poll.question_en;

  const voteM = useMutation({
    mutationFn: (optionIdx: number) => votePoll(poll.id, optionIdx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["public-poll-results"] }),
    onError: () => toast.error(t("community.polls.voteError")),
  });

  return (
    <article className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold leading-snug">{question}</h2>
        {closed && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {t("community.polls.closed")}
          </span>
        )}
      </div>

      <ul className="space-y-2">
        {poll.options.map((opt, idx) => {
          const label = lang === "en" ? opt.en || opt.pl : opt.pl || opt.en;
          const n = visible ? (results?.counts[idx] ?? 0) : 0;
          const pct = visible && total > 0 ? Math.round((n / total) * 100) : 0;
          const mine = myChoice === idx;
          const canVote = !!userId && !closed;
          return (
            <li key={idx}>
              <button
                type="button"
                onClick={() => canVote && voteM.mutate(idx)}
                disabled={!canVote || voteM.isPending}
                className={`relative w-full overflow-hidden rounded-md border px-4 py-3 text-left text-sm transition-colors ${
                  mine ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
                } ${!canVote ? "cursor-default" : "cursor-pointer"}`}
                aria-pressed={mine}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 transition-[width] duration-700 ease-out ${
                    mine ? "bg-primary/20" : "bg-primary/10"
                  }`}
                  style={{ width: `${pct}%` }}
                />
                <span className="relative flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2">
                    {mine && <Vote className="h-4 w-4 text-primary" aria-hidden="true" />}
                    {label}
                  </span>
                  <AnimatedCount pct={pct} n={n} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        {visible ? (
          <span>{t("community.polls.totalVotes", { count: total })}</span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            {t("community.polls.resultsHidden")}
          </span>
        )}
        {!userId && !closed && <span>{t("community.polls.signInHint")}</span>}
        {poll.ends_at && !closed && (
          <span>
            {t("community.polls.endsIn", {
              when: new Date(poll.ends_at).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL"),
            })}
          </span>
        )}
      </div>
    </article>
  );
}

/** Tabularne procenty z krótkim animate-fade-in gdy wartość się zmienia. */
function AnimatedCount({ pct, n }: { pct: number; n: number }) {
  const prev = useRef({ pct, n });
  const changed = prev.current.pct !== pct || prev.current.n !== n;
  useEffect(() => {
    prev.current = { pct, n };
  }, [pct, n]);
  return (
    <span
      key={`${pct}-${n}`}
      className={`text-xs tabular-nums text-muted-foreground ${changed ? "animate-fade-in" : ""}`}
    >
      {pct}% · {n}
    </span>
  );
}
