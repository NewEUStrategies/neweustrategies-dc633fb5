// Publiczne ankiety Community. URL: /polls
// Głosy przez RPC vote_poll (walidacja opcji, okno czasowe); wyniki przez
// get_poll_results_bulk z serwerowym anti-anchoringiem - rozkład głosów widać
// dopiero po oddaniu głosu (albo po zamknięciu ankiety), żeby nie zakotwiczał.
// Realtime: subskrypcja postgres_changes na poll_votes unieważnia cache
// wyników (debounce), co daje płynne animacje słupków po własnym głosie
// i synchronizację między kartami; RLS ogranicza zdarzenia do własnych
// wierszy, więc anti-anchoring pozostaje szczelny.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { EyeOff, Vote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchPublicPolls,
  fetchPollResults,
  votePoll,
  type PublicPoll,
  type PollResults,
} from "@/lib/community/publicQueries";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useAuth } from "@/hooks/useAuth";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import "@/lib/i18n-community";

export const Route = createFileRoute("/polls")({
  component: PollsPage,
  head: () => {
    const url = getRequestUrl() || "/polls";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: lang === "en" ? "Community polls" : "Ankiety społeczności",
      description:
        lang === "en"
          ? "Vote in community polls and see the pulse of readers."
          : "Głosuj w ankietach społeczności i zobacz, co myślą inni.",
    });
  },
});

function PollsPage() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const modules = useCommunityModules();
  const { user } = useAuth();
  const qc = useQueryClient();

  const pollsQ = useQuery({
    queryKey: ["public-polls"],
    queryFn: fetchPublicPolls,
    enabled: modules.polls_enabled,
  });

  const ids = useMemo(() => (pollsQ.data ?? []).map((p) => p.id), [pollsQ.data]);
  const idsKey = ids.join(",");
  const resultsQ = useQuery({
    queryKey: ["public-poll-results", idsKey, user?.id ?? "anon"],
    queryFn: () => fetchPollResults(ids),
    enabled: ids.length > 0,
  });

  // Realtime: nasłuchuj zmian w poll_votes dla widocznych ankiet i rzuć
  // invalidate na cache wyników. Debounce, żeby seria głosów w tej samej
  // sekundzie nie robiła kaskady refetchów.
  useEffect(() => {
    if (ids.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        qc.invalidateQueries({ queryKey: ["public-poll-results"] });
      }, 250);
    };
    const filter = `poll_id=in.(${ids.join(",")})`;
    const channel = supabase
      .channel(`poll-votes-${idsKey}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "poll_votes", filter },
        scheduleRefetch,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [idsKey, ids, qc]);

  if (!modules.polls_enabled) return <CommunityDisabled />;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12 md:py-16">
      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight">{t("community.polls.title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("community.polls.subtitle")}</p>
      </header>

      {pollsQ.isLoading && <p className="text-muted-foreground">{t("community.common.loading")}</p>}
      {pollsQ.isError && <p className="text-destructive">{t("community.common.loadError")}</p>}

      {pollsQ.data && pollsQ.data.length === 0 && (
        <p className="text-muted-foreground">{t("community.polls.empty")}</p>
      )}

      <ul className="space-y-6">
        {(pollsQ.data ?? []).map((poll) => (
          <PollCard
            key={poll.id}
            poll={poll}
            results={resultsQ.data?.get(poll.id)}
            lang={lang}
            userId={user?.id ?? null}
          />
        ))}
      </ul>
    </div>
  );
}

function PollCard({
  poll,
  results,
  lang,
  userId,
}: {
  poll: PublicPoll;
  results: PollResults | undefined;
  lang: "pl" | "en";
  userId: string | null;
}) {
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
    <li className="rounded-lg border border-border bg-card p-6">
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
                {visible && (
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 transition-[width] duration-700 ease-out ${
                      mine ? "bg-primary/20" : "bg-primary/10"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                )}
                <span className="relative flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2">
                    {mine && <Vote className="h-4 w-4 text-primary" aria-hidden="true" />}
                    {label}
                  </span>
                  {visible && <AnimatedCount pct={pct} n={n} />}
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
    </li>
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
