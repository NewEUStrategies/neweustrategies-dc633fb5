// Publiczne ankiety Community. URL: /polls
// SSR: loader zasiewa cache react-query listą ankiet (ensureQueryData), więc
// pytania i opcje są w HTML z serwera; wyniki głosowania pozostają wyłącznie
// klienckie (per-user anti-anchoring - patrz pollResultsQueryOptions).
// Realtime: subskrypcja postgres_changes na tabeli poll_votes unieważnia cache
// wyników po każdym insert/update/delete, co daje płynne animacje słupków
// (transition-[width] + animate-fade-in na etykiecie procentów).
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import {
  publicPollsQueryOptions,
  pollResultsQueryOptions,
  type PublicPoll,
} from "@/lib/community/publicQueries";
import { PollCard } from "@/components/community/PollCard";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { COMMUNITY_MODULES_DEFAULTS, COMMUNITY_MODULES_KEY } from "@/lib/community/modulesSettings";
import { resolveSetting, siteSettingsQueryOptions, type SettingsMap } from "@/lib/useSiteSetting";
import { withSsrBudget } from "@/lib/asyncBudget";
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { DegradedDataNotice } from "@/components/molecules/DegradedDataNotice";
import { useAuth } from "@/hooks/useAuth";
import { CommunityDisabled } from "@/components/community/CommunityDisabled";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-community";

/** Wspólny termin ŻĄDANIA - obie fazy dzielą jedno okno, nie dwa. */
const POLLS_SSR_BUDGET_MS = 1_400;

/**
 * Krótki termin BRAMKI MODUŁU. `site_settings` grzeje RÓWNOLEGLE loader
 * korzenia, więc 300 ms z zapasem wystarcza na dołączenie się do jego fetcha;
 * po tym czasie wchodzą `COMMUNITY_MODULES_DEFAULTS` z kodu, a lista dostaje
 * resztę budżetu. Konfiguracja NIGDY nie blokuje treści.
 */
const POLLS_SETTINGS_BUDGET_MS = 300;

/** Fallback listy ankiet - pusta, zasiewana z `updatedAt: 0` (samoleczenie). */
const NO_POLLS: PublicPoll[] = [];

export const Route = createFileRoute("/polls")({
  component: PollsPage,
  // Loader nigdy nie wywraca trasy: awaria backendu degraduje do pustej listy
  // z zasiewu (komponent mówi wtedy PRAWDĘ, patrz DegradedDataNotice),
  // a wyłączony moduł nie kosztuje żadnego zapytania o ankiety.
  loader: async ({ context }): Promise<{ degraded: boolean }> => {
    const deadlineAt = Date.now() + POLLS_SSR_BUDGET_MS;
    // Bramka modułu z tej samej mapy site_settings, którą rozgrzewa root
    // loader - `ensureQueryData` deduplikuje z jego równoległym fetchem, ale
    // POD TERMINEM: wcześniej gołe `await` pozwalało odczytowi KONFIGURACJI
    // zjeść cały budżet SSR, zanim padło pierwsze zapytanie o TREŚĆ. Termin
    // liczy się TYLKO na serwerze (patrz docblock `withSsrBudget`), więc
    // w przeglądarce `settings === undefined` znaczy wyłącznie ODRZUCONY
    // odczyt - domyślki modułu nie zamrażają już powierzchni po samej
    // powolności.
    await withSsrBudget(
      context.queryClient.ensureQueryData(siteSettingsQueryOptions).catch(() => undefined),
      POLLS_SETTINGS_BUDGET_MS,
      deadlineAt,
    );
    const settings = context.queryClient.getQueryData<SettingsMap>(
      siteSettingsQueryOptions.queryKey,
    );
    const modules = resolveSetting(settings, COMMUNITY_MODULES_KEY, COMMUNITY_MODULES_DEFAULTS);
    // Render na DOMYŚLKACH modułu nie jest prawdą tenanta, więc nie wolno go
    // rozdać kolejnym czytelnikom z brzegu - ten sam kontrakt, co przy
    // fallbacku danych.
    const settingsDegraded = settings === undefined;
    if (!modules.polls_enabled) {
      setCacheControlHeader(resilientCacheControl(settingsDegraded));
      return { degraded: settingsDegraded };
    }
    const polls = await loadResilient(context.queryClient, publicPollsQueryOptions(), NO_POLLS, {
      deadlineAt,
      label: "public-polls",
    });
    // BRAMKA NAGŁÓWKA, której ta trasa nie miała W OGÓLE: pusta lista ankiet
    // nie ma prawa zamarznąć na brzegu na 15 minut świeżości plus dobę okna
    // `stale-while-revalidate`.
    setCacheControlHeader(resilientCacheControl(settingsDegraded || polls.degraded));
    return { degraded: settingsDegraded || polls.degraded };
  },
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
  const { degraded: ssrDegraded } = Route.useLoaderData();

  const pollsQ = useQuery({
    ...publicPollsQueryOptions(),
    enabled: modules.polls_enabled,
  });

  // STEMPEL FALLBACKU, nie nowy stan. `loadResilient` zasiewa pustą listę
  // z `updatedAt: 0`, więc `dataUpdatedAt === 0` znaczy „dane są, ale nie są
  // prawdą backendu". Koniunkcja z flagą loadera odsiewa degradację SAMYCH
  // USTAWIEŃ (lista bywa wtedy kompletna), a po refetchu po hydratacji
  // stempel się zmienia i komunikat znika sam.
  const degraded = ssrDegraded && pollsQ.dataUpdatedAt === 0;

  const ids = useMemo(() => (pollsQ.data ?? []).map((p) => p.id), [pollsQ.data]);
  const idsKey = ids.join(",");
  const resultsQ = useQuery({
    ...pollResultsQueryOptions(ids, user?.id ?? null),
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

      {/* DEGRADACJA MÓWI PRAWDĘ. Pusta lista z zasiewu wygląda dokładnie jak
          „nie ma jeszcze ankiet" - a to kłamstwo w treści, które zabiera
          czytelnikowi powód, żeby wrócić. Nagłówek jest już `no-store`, więc
          ten HTML nie zamarza na brzegu. Nagłówek strony ZOSTAJE: degraduje
          lista, nie cała strona (stąd wariant panelu, nie pełnoekranowy). */}
      {degraded ? (
        <DegradedDataNotice />
      ) : (
        <>
          {pollsQ.isError && <p className="text-destructive">{t("community.common.loadError")}</p>}
          {pollsQ.data && pollsQ.data.length === 0 && (
            <p className="text-muted-foreground">{t("community.polls.empty")}</p>
          )}
        </>
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
