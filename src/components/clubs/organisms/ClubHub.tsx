// Hub klubu - powłoka trzykolumnowa i orkiestracja danych.
//
// UKŁAD. Trzy kolumny to nie moda, tylko odpowiedź na trzy różne pytania,
// które użytkownik zadaje w różnym rytmie:
//   * LEWA (nawigacja, działy)  - "gdzie mogę pójść" - rzadko, ale musi być
//     pod ręką, więc `sticky` i wąska,
//   * ŚRODEK (strumień)         - "co się dzieje" - to jest treść i dostaje
//     całą pozostałą szerokość, ograniczoną do ~46 rem, bo linia dłuższa niż
//     ~90 znaków przestaje się czytać,
//   * PRAWA (kontekst)          - "co mnie czeka" - skanowana wzrokiem, nie
//     czytana, więc może być gęsta i też jest `sticky`.
//
// STOPNIOWANIE. Poniżej `lg` znika lewa kolumna (jej nawigacja wraca jako
// poziomy pasek nad strumieniem), poniżej `xl` znika prawa (jej panele lądują
// POD strumieniem, nie nad - na telefonie treść ma być pierwsza). To jest
// świadomie inne niż "wszystko w jednej kolumnie w kolejności DOM": kontekst
// wypchnięty nad strumień oznaczałby, że na telefonie pierwsze, co widać po
// nagłówku, to pięć kafelków, a nie rozmowa.
//
// DANE. Sześć zapytań, wszystkie już istniejące - hub niczego nie dokłada po
// stronie bazy. Cztery z nich (dokumenty, kalendarz, harmonogram, pomiar) są
// LEKKIE i mają krótkie limity, bo w hubie służą za kontekst, a pełne listy
// mają własne ekrany.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, FileText, LayoutList, MessagesSquare, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAuth } from "@/hooks/useAuth";
import { useClubGroups, useClubSearch, useClubThreads } from "@/lib/clubs/useClubs";
import {
  useClubActivitySeries,
  useClubDocuments,
  useClubEvents,
  useClubMilestones,
  useClubWorkspaceStats,
} from "@/lib/clubs/useClubWorkspace";
import {
  CLUB_THREAD_SORTS,
  CLUB_THREAD_SORTS_REQUIRING_SESSION,
  type ClubThreadSort,
  type ClubViewRow,
} from "@/lib/clubs/types";
import { parseContributors } from "@/lib/clubs/workspaceTypes";
import { buildClubFeed, CLUB_FEED_MODES, type ClubFeedMode } from "@/lib/clubs/clubFeed";
import { ClubSegmented, HUB_SURFACE } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubThreadListSkeleton } from "@/components/clubs/atoms/ClubSkeletons";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { ClubHubIdentity } from "@/components/clubs/molecules/ClubHubIdentity";
import { ClubHubRail, ClubHubSectionBar } from "@/components/clubs/molecules/ClubHubRail";
import { ClubGroupBar } from "@/components/clubs/molecules/ClubGroupTree";
import { ClubGroupPanel } from "@/components/clubs/molecules/ClubGroupPanel";
import { buildClubGroupTree, clubGroupPath } from "@/lib/clubs/groupTree";
import { ClubComposer } from "@/components/clubs/molecules/ClubComposer";
import {
  ClubFreshDocsPanel,
  ClubPeoplePanel,
  ClubPulsePanel,
  ClubStagePanel,
  ClubUpNextPanel,
} from "@/components/clubs/molecules/ClubHubContext";
import { ClubFeedItem } from "@/components/clubs/organisms/ClubFeedItem";
import { ClubGlobalSearchResults } from "@/components/clubs/organisms/ClubGlobalSearch";
import { uiLocale } from "@/lib/i18n/format";

const FEED_ICONS = {
  all: LayoutList,
  threads: MessagesSquare,
  documents: FileText,
  calendar: CalendarDays,
} as const;

/** Dzisiaj jako `YYYY-MM-DD` w czasie LOKALNYM - `due_on` jest datą bez strefy. */
function localToday(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function ClubHub({ club, isPl }: { club: ClubViewRow; isPl: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = uiLocale(i18n.language);
  const clubSlug = club.slug;

  const { session } = useAuth();
  const signedIn = session !== null;

  const [mode, setMode] = useState<ClubFeedMode>("all");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [sort, setSort] = useState<ClubThreadSort>("hot");
  const [query, setQuery] = useState("");

  const groupsQ = useClubGroups(club.id);
  const threadsQ = useClubThreads({ clubId: club.id, groupId, sort, kind: null });
  // Konteksty: krótkie limity, bo w hubie są kontekstem, a nie listą.
  // Dokumenty idą tym samym zawężeniem, co strumień: panel działu ma pokazywać
  // materiały TEGO działu, a nie całego klubu.
  const documentsQ = useClubDocuments({ clubId: club.id, groupId, limit: 6 });
  const eventsQ = useClubEvents({ clubId: club.id, from: new Date().toISOString(), limit: 12 });
  const milestonesQ = useClubMilestones(club.id);
  const statsQ = useClubWorkspaceStats(club.id, 30);
  const seriesQ = useClubActivitySeries(club.id, 30);

  // Wyszukiwanie ZASTĘPUJE strumień, nie stoi obok niego: dwie listy naraz na
  // telefonie znaczą, że użytkownik nie wie, którą czyta.
  const debouncedQuery = useDebouncedValue(query, 250);
  const searching = debouncedQuery.trim().length >= 2;
  const searchQ = useClubSearch({
    query: debouncedQuery,
    clubId: club.id,
    enabled: searching,
  });

  const threads = useMemo(
    () => (threadsQ.data?.pages ?? []).flatMap((page) => page.rows),
    [threadsQ.data],
  );
  // Wszystkie cztery listy przechodzą przez `useMemo`, bo `?? []` tworzy NOWĄ
  // tablicę przy każdym renderze - a ta trafia do zależności `buildClubFeed`
  // i przeliczałaby strumień bez powodu.
  const documents = useMemo(() => documentsQ.data?.rows ?? [], [documentsQ.data]);
  const events = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);
  const milestones = useMemo(() => milestonesQ.data ?? [], [milestonesQ.data]);
  const stats = statsQ.data ?? null;

  const feed = useMemo(
    () => buildClubFeed({ mode, threads, documents, events, milestones }),
    [mode, threads, documents, events, milestones],
  );

  const groups = useMemo(() => groupsQ.data ?? [], [groupsQ.data]);
  const groupTree = useMemo(() => buildClubGroupTree(groups), [groups]);
  const groupPath = useMemo(() => clubGroupPath(groupTree, groupId), [groupTree, groupId]);
  const activeGroupNode = groupPath.length > 0 ? groupPath[groupPath.length - 1] : null;

  const contributors = useMemo(
    () => (stats === null ? [] : parseContributors(stats.top_contributors)),
    [stats],
  );

  const availableSorts = CLUB_THREAD_SORTS.filter(
    (value) => signedIn || !CLUB_THREAD_SORTS_REQUIRING_SESSION.includes(value),
  );

  const feedOptions = CLUB_FEED_MODES.map((value) => ({
    value,
    label: t(`club.hub.feed.mode.${value}`),
    icon: FEED_ICONS[value],
    count:
      value === "documents"
        ? (documentsQ.data?.total ?? 0)
        : value === "calendar"
          ? events.length
          : undefined,
  }));

  const context = (
    <>
      <ClubPulsePanel
        clubSlug={clubSlug}
        series={seriesQ.data ?? []}
        stats={stats}
        locale={locale}
      />
      <ClubUpNextPanel clubSlug={clubSlug} events={events} isPl={isPl} />
      <ClubStagePanel
        clubSlug={clubSlug}
        milestones={milestones}
        isPl={isPl}
        today={localToday()}
      />
      <ClubFreshDocsPanel clubSlug={clubSlug} documents={documents} isPl={isPl} />
      <ClubPeoplePanel
        clubSlug={clubSlug}
        contributors={contributors}
        canSeeMembers={club.can_see_members}
        locale={locale}
      />
    </>
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-5 sm:px-5 lg:px-8">
      <ClubHubIdentity club={club} isPl={isPl} locale={locale} className="mb-4" />

      <div className="grid items-start gap-4 lg:grid-cols-[13.5rem_minmax(0,1fr)] xl:grid-cols-[13.5rem_minmax(0,1fr)_20rem]">
        {/* Lewa szyna: tylko od `lg`. Niżej jej nawigacja wraca paskiem. */}
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <ClubHubRail
            clubSlug={clubSlug}
            canSeeMembers={club.can_see_members}
            groups={groups}
            policyArea={club.policy_area}
            activeGroupId={groupId}
            onGroupChange={setGroupId}
            hasRules={(isPl ? club.rules_pl : club.rules_en) !== null}
            isPl={isPl}
          />
        </aside>

        <main className="min-w-0">
          <ClubHubSectionBar
            clubSlug={clubSlug}
            canSeeMembers={club.can_see_members}
            className="mb-3 lg:hidden"
          />

          <ClubGroupBar
            groups={groups}
            activeGroupId={groupId}
            onGroupChange={setGroupId}
            isPl={isPl}
            className="mb-3 lg:hidden"
          />

          {activeGroupNode !== null ? (
            <ClubGroupPanel
              node={activeGroupNode}
              path={groupPath}
              documentCount={documentsQ.data?.total ?? 0}
              isPl={isPl}
              onGroupChange={setGroupId}
              className="mb-3"
            />
          ) : null}

          <ClubComposer
            clubSlug={clubSlug}
            canPost={club.can_post_thread}
            whoCanPost={club.who_can_post}
            className="mb-3"
          />

          {/* Pasek sterowania strumieniem: fraza + porządek. Filtr trybu stoi
              osobno pod spodem, bo zmienia ŹRÓDŁO, a nie kolejność. */}
          <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("club.searchPlaceholder")}
                aria-label={t("club.searchPlaceholder")}
                className="rounded-lg pl-9 pr-9"
              />
              {query !== "" ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={t("club.searchClear")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <Select value={sort} onValueChange={(value) => setSort(value as ClubThreadSort)}>
              <SelectTrigger
                aria-label={t("club.sort.label")}
                className={cn("rounded-lg", searching && "hidden")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableSorts.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`club.sort.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!searching ? (
            <ClubSegmented
              value={mode}
              options={feedOptions}
              onChange={setMode}
              ariaLabel={t("club.hub.feed.modeLabel")}
              className="mb-3"
            />
          ) : null}

          {searching ? (
            <ClubGlobalSearchResults
              hits={searchQ.data ?? []}
              pending={searchQ.isPending}
              failed={searchQ.isError}
              query={debouncedQuery}
              isPl={isPl}
              onRetry={() => void searchQ.refetch()}
            />
          ) : threadsQ.isError ? (
            <ClubErrorNotice onRetry={() => void threadsQ.refetch()} />
          ) : threadsQ.isPending ? (
            <ClubThreadListSkeleton />
          ) : feed.length === 0 ? (
            <p className={cn(HUB_SURFACE, "p-10 text-center text-sm text-muted-foreground")}>
              {mode === "all" ? t("club.noThreads") : t(`club.hub.feed.empty.${mode}`)}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {feed.map((entry) => (
                <ClubFeedItem key={entry.key} entry={entry} clubSlug={clubSlug} isPl={isPl} />
              ))}
            </div>
          )}

          {/* Doładowanie dotyczy WĄTKÓW - konteksty przyjechały w całości. */}
          {!searching && mode !== "documents" && mode !== "calendar" && threadsQ.hasNextPage ? (
            <div className="mt-4 text-center">
              <Button
                variant="outline"
                className="rounded-lg"
                disabled={threadsQ.isFetchingNextPage}
                onClick={() => void threadsQ.fetchNextPage()}
              >
                {threadsQ.isFetchingNextPage ? t("club.loadingMore") : t("club.loadMore")}
              </Button>
            </div>
          ) : null}

          {/* Kontekst na telefonie i tablecie: POD strumieniem - patrz nagłówek. */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:hidden">{context}</div>
        </main>

        <aside className="hidden xl:sticky xl:top-20 xl:block">
          <div className="flex flex-col gap-3">{context}</div>
        </aside>
      </div>
    </div>
  );
}
