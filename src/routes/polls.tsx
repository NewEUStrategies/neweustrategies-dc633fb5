// Publiczne ankiety Community. URL: /polls
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Vote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchPublicPolls,
  fetchPollVotes,
  type PublicPoll,
  type PollVoteCounts,
} from "@/lib/community/publicQueries";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { getPublicTenantId } from "@/lib/community/tenant";
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

  const pollsQ = useQuery({
    queryKey: ["public-polls"],
    queryFn: fetchPublicPolls,
    enabled: modules.polls_enabled,
  });

  const ids = useMemo(() => (pollsQ.data ?? []).map((p) => p.id), [pollsQ.data]);
  const votesQ = useQuery({
    queryKey: ["public-poll-votes", ids.join(","), user?.id ?? "anon"],
    queryFn: () => fetchPollVotes(ids, user?.id ?? null),
    enabled: ids.length > 0,
  });

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
            counts={votesQ.data?.get(poll.id)}
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
  counts,
  lang,
  userId,
}: {
  poll: PublicPoll;
  counts: PollVoteCounts | undefined;
  lang: "pl" | "en";
  userId: string | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const closed = poll.status === "closed";
  const total = counts?.total ?? 0;
  const myChoice = counts?.my_choice ?? null;
  const question = lang === "en" ? poll.question_en || poll.question_pl : poll.question_pl || poll.question_en;

  const voteM = useMutation({
    mutationFn: async (optionIdx: number) => {
      if (!userId) throw new Error("no user");
      if (myChoice === null) {
        const tenant_id = await getPublicTenantId();
        const { error } = await supabase
          .from("poll_votes")
          .insert({ poll_id: poll.id, user_id: userId, tenant_id, option_idx: optionIdx });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("poll_votes")
          .update({ option_idx: optionIdx })
          .eq("poll_id", poll.id)
          .eq("user_id", userId);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["public-poll-votes"] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Error"),
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
          const n = counts?.counts[idx] ?? 0;
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          const mine = myChoice === idx;
          const canVote = !!userId && !closed;
          return (
            <li key={idx}>
              <button
                type="button"
                onClick={() => canVote && voteM.mutate(idx)}
                disabled={!canVote || voteM.isPending}
                className={`relative w-full overflow-hidden rounded-md border px-4 py-3 text-left text-sm transition ${
                  mine
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                } ${!canVote ? "cursor-default" : "cursor-pointer"}`}
                aria-pressed={mine}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 bg-primary/10"
                  style={{ width: `${pct}%` }}
                />
                <span className="relative flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2">
                    {mine && <Vote className="h-4 w-4 text-primary" aria-hidden="true" />}
                    {label}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {pct}% · {n}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {t("community.polls.totalVotes", { count: total })}
        </span>
        {!userId && !closed && <span>{t("community.polls.signInHint")}</span>}
        {poll.ends_at && !closed && (
          <span>
            {t("community.polls.endsIn", {
              when: new Date(poll.ends_at).toLocaleDateString(
                lang === "en" ? "en-GB" : "pl-PL",
              ),
            })}
          </span>
        )}
      </div>
    </li>
  );
}
