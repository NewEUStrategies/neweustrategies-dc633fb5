// Publiczne ankiety Community. URL: /polls
// Realtime: subskrypcja postgres_changes na tabeli poll_votes unieważnia cache
// wyników po każdym insert/update/delete, co daje płynne animacje słupków
// (transition-[width] + animate-fade-in na etykiecie procentów).
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { fetchPublicPolls, fetchPollResults } from "@/lib/community/publicQueries";
import { PollCard } from "@/components/community/PollCard";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useAuth } from "@/hooks/useAuth";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";
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
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureCommunityI18n();
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

  // Realtime: nasłuchuj zmian w poll_votes tylko dla widocznych ankiet i
  // rzuć invalidate na cache wyników. Debounce, żeby seria głosów w tej samej
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
          <li key={poll.id}>
            <PollCard
              poll={poll}
              results={resultsQ.data?.get(poll.id)}
              lang={lang}
              userId={user?.id ?? null}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
