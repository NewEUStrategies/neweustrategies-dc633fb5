// Widok publiczny bloku "poll" - osadza ankietę Community w treści wpisu.
//
// Podział odpowiedzialności:
//   - definicja ankiety (pytanie/opcje/status): pollBlockQueryOptions,
//     cacheowalna i prefetchowana w SSR razem z resztą bloków wpisu,
//   - wyniki głosowania: per-user (anti-anchoring w RPC), więc dociągane
//     WYŁĄCZNIE na kliencie - edge cache nigdy nie zapieka cudzych wyników,
//   - sama karta: wspólny PollCard (ten sam co /polls - jedna implementacja
//     słupków, głosowania i copy w obu miejscach).
// Realtime: subskrypcja poll_votes tego jednego poll_id inwaliduje wyniki
// (prefiks klucza wspólny z /polls, więc głos oddany w bloku odświeża też
// stronę ankiet i odwrotnie).
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { pollBlockQueryOptions } from "@/lib/queries/blocks";
import { fetchPollResults } from "@/lib/community/publicQueries";
import { PollCard } from "@/components/community/PollCard";
import { useAuth } from "@/hooks/useAuth";

export function PollBlockView({ pollId, lang }: { pollId: string; lang: "pl" | "en" }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const pollQ = useQuery(pollBlockQueryOptions(pollId));
  const resultsQ = useQuery({
    queryKey: ["public-poll-results", pollId, user?.id ?? "anon"],
    queryFn: () => fetchPollResults([pollId]),
    enabled: !!pollQ.data,
  });

  useEffect(() => {
    if (!pollQ.data) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        qc.invalidateQueries({ queryKey: ["public-poll-results"] });
      }, 250);
    };
    const channel = supabase
      .channel(`poll-votes-block-${pollId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "poll_votes", filter: `poll_id=eq.${pollId}` },
        scheduleRefetch,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [pollId, qc, pollQ.data]);

  if (pollQ.isLoading) {
    return (
      <div
        aria-hidden="true"
        className="animate-pulse rounded-lg border border-border bg-card h-44"
      />
    );
  }
  // Ankieta usunięta / w szkicu: blok znika z publicznej strony bez śladu
  // (redaktor widzi ostrzeżenie w edytorze, czytelnik nie widzi dziury).
  if (!pollQ.data) return null;

  return (
    <PollCard
      poll={pollQ.data}
      results={resultsQ.data?.get(pollId)}
      lang={lang}
      userId={user?.id ?? null}
    />
  );
}
