// Hub klubu - powłoka trzykolumnowa i orkiestracja danych.
//
// UKŁAD. Trzy kolumny to nie moda, tylko odpowiedź na trzy różne pytania,
// które użytkownik zadaje w różnym rytmie:
//   * LEWA (nawigacja, działy)  - "gdzie mogę pójść" - rzadko, ale musi być
//     pod ręką, więc `sticky` i wąska; sekcje jako siatka kafelków z liczbami,
//     pod nimi drzewo działów,
//   * ŚRODEK (strumień)         - "co się dzieje" - to jest treść i dostaje
//     całą pozostałą szerokość, ograniczoną do ~46 rem, bo linia dłuższa niż
//     ~90 znaków przestaje się czytać,
//   * PRAWA (źródła i kontekst) - "skąd to jest i co mnie czeka" - otwiera ją
//     panel wątków POGRUPOWANYCH według działu, z którego pochodzą, bo strumień
//     w środku miesza sześć działów w jeden ciąg i sam z siebie nie powie, ile
//     ich naprawdę żyje. Reszta kolumny jest skanowana wzrokiem, nie czytana,
//     więc może być gęsta i też jest `sticky`.
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
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  FileText,
  LayoutList,
  MessagesSquare,
  Newspaper,
  Search,
  X,
} from "lucide-react";
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
import {
  useClubGroups,
  useClubReactions,
  useClubReactionActors,
  useClubSearch,
  useClubThreads,
  useToggleClubReaction,
} from "@/lib/clubs/useClubs";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import { useClubDocuments, useClubEvents, useClubMilestones } from "@/lib/clubs/useClubWorkspace";
import {
  CLUB_THREAD_SORTS,
  CLUB_THREAD_SORTS_REQUIRING_SESSION,
  type ClubThreadKind,
  type ClubThreadSort,
  type ClubViewRow,
} from "@/lib/clubs/types";
import { buildClubFeed, CLUB_FEED_MODES, type ClubFeedMode } from "@/lib/clubs/clubFeed";
import {
  useClubMediaUrls,
  useClubPosts,
  useDeleteClubPost,
  useToggleClubPostLike,
} from "@/lib/clubs/useClubPosts";
import { isMediaAttachment, parseClubPostAttachments } from "@/lib/clubs/postTypes";
import { ClubSegmented, HUB_SURFACE } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubThreadListSkeleton } from "@/components/clubs/atoms/ClubSkeletons";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { ClubHubIdentity } from "@/components/clubs/molecules/ClubHubIdentity";
import { ClubHubRail, ClubHubSectionBar } from "@/components/clubs/molecules/ClubHubRail";
import { ClubGroupBar } from "@/components/clubs/molecules/ClubGroupTree";
import { ClubGroupPanel } from "@/components/clubs/molecules/ClubGroupPanel";
import { ClubStreamFilters } from "@/components/clubs/molecules/ClubStreamFilters";
import { buildClubGroupTree, clubGroupPath } from "@/lib/clubs/groupTree";
import { ClubCreatePanel } from "@/components/clubs/molecules/ClubCreatePanel";
import { ClubFreshDocsPanel, ClubStagePanel } from "@/components/clubs/molecules/ClubHubContext";
import { ClubBoardPanel } from "@/components/clubs/molecules/ClubBoardPanel";
import { ClubMeetingPanel } from "@/components/clubs/molecules/ClubMeetingPanel";
import { ClubRosterPanel } from "@/components/clubs/molecules/ClubRosterPanel";
import { ClubSpotlightPanel } from "@/components/clubs/molecules/ClubSpotlightPanel";
import { ClubThreadTopicBar } from "@/components/clubs/molecules/ClubThreadTopicBar";
import { ClubFeedItem } from "@/components/clubs/organisms/ClubFeedItem";
import { ClubGlobalSearchResults } from "@/components/clubs/organisms/ClubGlobalSearch";
import { buildClubSourceIndex } from "@/lib/clubs/threadSources";
import { uiLang, uiLocale } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import type { BreadcrumbItem } from "@/lib/breadcrumbs";

const FEED_ICONS = {
  all: LayoutList,
  posts: Newspaper,
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

export function ClubHub({ club }: { club: ClubViewRow }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const locale = uiLocale(i18n.language);
  const clubSlug = club.slug;

  const { session } = useAuth();
  const signedIn = session !== null;

  const [mode, setMode] = useState<ClubFeedMode>("all");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [sort, setSort] = useState<ClubThreadSort>("hot");
  const [query, setQuery] = useState("");
  // Segmentacja #tagami: tag z URL-a (klik w #tag w treści) zasiewa frazę
  // wyszukiwania, więc strumień zawęża się do wątków i wpisów z tym tagiem.
  const navigate = useNavigate();
  const routeSearch = useSearch({ strict: false }) as { tag?: string };
  const activeTag = typeof routeSearch.tag === "string" ? routeSearch.tag.trim() : "";
  useEffect(() => {
    if (activeTag !== "") setQuery(activeTag);
  }, [activeTag]);
  const clearTag = () => {
    setQuery("");
    if (activeTag !== "") {
      void navigate({ to: "/club/$clubSlug", params: { clubSlug }, search: {} });
    }
  };
  // Trzy zawężenia, które NIE są działem - patrz `ClubStreamFilters`.
  const [kind, setKind] = useState<ClubThreadKind | null>(null);
  const [anchoredOnly, setAnchoredOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Obszar tematyczny - oś PROSTOPADŁA do działu (poziom "wybór tematu" między
  // działem a wątkiem, patrz `ClubThreadTopicBar`). Wątek o cyberbezpieczeństwie
  // może siedzieć w dowolnym dziale - ten filtr go znajdzie niezależnie od tego.
  const [topic, setTopic] = useState<string | null>(null);

  const groupsQ = useClubGroups(club.id);
  const { topics: topicsCatalog } = useClubTopics();
  const threadsQ = useClubThreads({
    clubId: club.id,
    groupId,
    sort,
    kind,
    // `false` znaczyłoby "tylko BEZ kotwicy" - to jest trzeci stan, którego ta
    // kontrolka nie oferuje, więc wyłączony filtr musi być `null`.
    anchored: anchoredOnly ? true : null,
    unreadOnly: signedIn && unreadOnly,
    topic,
  });
  // Konteksty: krótkie limity, bo w hubie są kontekstem, a nie listą.
  // Dokumenty idą tym samym zawężeniem, co strumień: panel działu ma pokazywać
  // materiały TEGO działu, a nie całego klubu.
  const documentsQ = useClubDocuments({ clubId: club.id, groupId, limit: 6 });
  const eventsQ = useClubEvents({ clubId: club.id, from: new Date().toISOString(), limit: 12 });
  const milestonesQ = useClubMilestones(club.id);
  // Ściana (A31). Wpisy idą tym samym zawężeniem działu, co strumień - inaczej
  // wybrany dział pokazywałby wątki jednego działu i wpisy całego klubu.
  const postsQ = useClubPosts({ clubId: club.id, groupId });
  const deletePost = useDeleteClubPost(club.id);
  const toggleLike = useToggleClubPostLike();
  // PEŁNA lista wątków klubu, bez zawężenia działem i bez porządku wybranego
  // przez użytkownika. Zasila kompozytor (wybór wątku, do którego wpina się
  // wpis) i pasek obszarów tematycznych, którego liczniki mają mówić o CAŁYM
  // klubie - inaczej po wybraniu działu pokazywałyby liczby tego działu.
  const sourceThreadsQ = useClubThreads({ clubId: club.id, sort: "new" });

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
  const posts = useMemo(
    () => (postsQ.data?.pages ?? []).flatMap((page) => page.rows),
    [postsQ.data],
  );
  // Wszystkie ścieżki plików ze ściany podpisujemy JEDNYM żądaniem - podpis
  // per karta znaczyłby tyle round-tripów, ile wpisów na ekranie.
  const mediaPaths = useMemo(
    () =>
      posts.flatMap((post) =>
        parseClubPostAttachments(post.attachments)
          .filter(isMediaAttachment)
          .map((item) => item.path),
      ),
    [posts],
  );
  const mediaUrls = useClubMediaUrls(mediaPaths);

  const feed = useMemo(
    () => buildClubFeed({ mode, threads, documents, events, milestones, posts }),
    [mode, threads, documents, events, milestones, posts],
  );

  // Reakcje CAŁEJ widocznej partii wątków jednym zapytaniem - nigdy N+1.
  // Klucz zapytania zawiera listę identyfikatorów, więc doładowanie kolejnej
  // strony strumienia pobiera komplet od nowa zamiast sklejać dwie mapy.
  const feedThreadIds = useMemo(
    () => feed.flatMap((entry) => (entry.kind === "thread" ? [entry.thread.id] : [])),
    [feed],
  );
  const threadReactionsQ = useClubReactions({ targetType: "thread", targetIds: feedThreadIds });
  const threadActorsQ = useClubReactionActors({
    targetType: "thread",
    targetIds: feedThreadIds,
  });
  const toggleThreadReaction = useToggleClubReaction({
    targetType: "thread",
    targetIds: feedThreadIds,
  });

  const groups = useMemo(() => groupsQ.data ?? [], [groupsQ.data]);
  const groupTree = useMemo(() => buildClubGroupTree(groups), [groups]);
  const groupPath = useMemo(() => clubGroupPath(groupTree, groupId), [groupTree, groupId]);
  const activeGroupNode = groupPath.length > 0 ? groupPath[groupPath.length - 1] : null;
  // Kolor i ikona działu liczone RAZ na render listy, nie raz na kartę.
  const sourceIndex = useMemo(() => buildClubSourceIndex(groups, lang), [groups, lang]);
  const sourceThreads = useMemo(
    () => (sourceThreadsQ.data?.pages ?? []).flatMap((page) => page.rows),
    [sourceThreadsQ.data],
  );

  const availableSorts = CLUB_THREAD_SORTS.filter(
    (value) => signedIn || !CLUB_THREAD_SORTS_REQUIRING_SESSION.includes(value),
  );

  // Zawężenie wątkowe włączone w trybie "Wszystko" przestawia strumień na
  // "Wątki". Bez tego użytkownik zawęża rodzaj wątku i dalej widzi dokumenty
  // oraz terminy, których to zawężenie nie dotyczy - czyli filtr wygląda na
  // zepsuty. Przestawienie jest WIDOCZNE, bo rusza się segmentowany
  // przełącznik obok; cicha zmiana źródła byłaby gorsza niż niespójność.
  const applyThreadFilter = (change: () => void, becomesActive: boolean): void => {
    change();
    if (becomesActive && mode === "all") setMode("threads");
  };

  // DOŁADOWANIE PRZY DOJŚCIU DO KOŃCA. Przycisk zostaje - jest jawną kontrolką
  // dla klawiatury i czytnika ekranu, i jedyną drogą, gdy obserwator nie ruszy.
  // Obserwator go tylko UPRZEDZA: czytelnik, który doszedł do końca strony,
  // już zadeklarował zamiar czytania dalej, więc kazanie mu celować w przycisk
  // jest podatkiem od tej deklaracji.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = threadsQ;
  useEffect(() => {
    const node = sentinelRef.current;
    if (node === null || !hasNextPage || isFetchingNextPage) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
      },
      // Margines dolny: strona zaczyna się ładować, ZANIM czytelnik dobije do
      // krawędzi, więc lista rzadko kiedy w ogóle się zatrzymuje.
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const feedOptions = CLUB_FEED_MODES.map((value) => ({
    value,
    label: t(`club.hub.feed.mode.${value}`),
    icon: FEED_ICONS[value],
    count:
      value === "posts"
        ? (postsQ.data?.pages[0]?.total ?? 0)
        : value === "documents"
          ? (documentsQ.data?.total ?? 0)
          : value === "calendar"
            ? events.length
            : undefined,
  }));

  // KOLEJNOŚĆ PRAWEJ KOLUMNY JEST TEZĄ - i po A32 jest to teza o LUDZIACH.
  //
  // Do A31 kolumnę otwierał panel źródeł ("skąd pochodzi to, co widzę"),
  // a zamykał puls liczący wpisy. Oba mówiły o treści. Nowa kolejność
  // odpowiada na pytania w takim porządku, w jakim realnie zapadają decyzje
  // członka think tanku:
  //
  //   1. TABLICA "SZUKAM / OFERUJĘ" - jedyna powierzchnia, która daje POWÓD,
  //      żeby odezwać się do konkretnej osoby dziś. Stoi pierwsza, bo jest
  //      najsilniejszym mechanizmem sieciującym z całej szyny i jako jedyna
  //      działa także wtedy, gdy w klubie akurat nic się nie dzieje.
  //   2. NAJBLIŻSZE SPOTKANIE + KTO BĘDZIE - most do formatów offline.
  //      Lista potwierdzonych konwertuje, sama data nie.
  //   3. SKŁAD Z SYGNAŁEM OBECNOŚCI - "czy ktokolwiek tu jest": sześć twarzy
  //      dobieranych rotacyjnie i trzy liczby o ludziach.
  //   4. POZNAJ CZŁONKA - jedna twarz tygodniowo, żeby skład przestał być
  //      listą nazwisk.
  //   5. ETAP i 6. ŚWIEŻE MATERIAŁY - kontekst pracy, bez zmian.
  //
  // Cztery pierwsze panele mówią WYŁĄCZNIE o ludziach i stoją bez przerwy -
  // dlatego dorobek klubu wypadł stąd w A34 razem z całym modułem: lista
  // materiałów w środku tego ciągu przerywała go pytaniem, na które i tak
  // odpowiada biblioteka.
  //
  // Panel źródeł zniknął w całości: drzewo działów z licznikami stoi w LEWEJ
  // szynie, a każda karta strumienia niesie chip działu, którym można zawęzić
  // listę - trzeci byt mówiący to samo dodawał wysokości, nie informacji.
  const context = (
    <>
      {/* Najbliższe spotkanie stoi NAD giełdą "Szukam / Oferuję": most do
          formatów offline konwertuje przez listę potwierdzonych osób, więc
          musi trafiać w pierwsze spojrzenie na szynę. */}
      <ClubMeetingPanel
        clubSlug={clubSlug}
        clubId={club.id}
        events={events}
        // Patrz trasa spotkania: `can_see_members` przepuszcza anonima
        // w klubie `public`, a RPC z nazwiskami jest dla niego zamkniete.
        canSeeMembers={signedIn && club.can_see_members}
        canRsvp={signedIn && club.can_reply}
        canManage={signedIn && club.can_manage}
      />
      <ClubBoardPanel clubSlug={clubSlug} clubId={club.id} canPost={signedIn && club.can_reply} />

      <ClubRosterPanel
        clubSlug={clubSlug}
        clubId={club.id}
        canSeeMembers={club.can_see_members}
        canDeclare={signedIn && club.can_reply}
        locale={locale}
      />
      <ClubSpotlightPanel clubSlug={clubSlug} clubId={club.id} />
      <ClubStagePanel clubSlug={clubSlug} milestones={milestones} today={localToday()} />
      <ClubFreshDocsPanel clubSlug={clubSlug} documents={documents} />
    </>
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-5 sm:px-5 lg:px-8">
      <ClubHubIdentity club={club} locale={locale} className="mb-4" />

      <div className="grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_20rem]">
        {/* Lewa szyna: tylko od `lg`. Niżej jej nawigacja wraca paskiem. */}
        <aside className="hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1 [scrollbar-width:thin]">
          <ClubHubRail
            clubSlug={clubSlug}
            canSeeMembers={club.can_see_members}
            groups={groups}
            policyArea={club.policy_area}
            activeGroupId={groupId}
            onGroupChange={setGroupId}
            // Liczby przy kafelkach biorą się WYŁĄCZNIE z zapytań, które hub
            // i tak wykonuje - szyna nie dokłada ani jednego round-tripu po to,
            // żeby narysować plakietkę.
            counts={{
              threads: club.thread_count,
              documents: documentsQ.data?.total,
              calendar: events.length,
              schedule: milestones.length,
              members: club.member_count,
            }}
            hasRules={pickLocalized(club, "rules", lang) !== ""}
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
            className="mb-3 lg:hidden"
          />

          {activeGroupNode !== null ? (
            <ClubGroupPanel
              node={activeGroupNode}
              path={groupPath}
              documentCount={documentsQ.data?.total ?? 0}
              onGroupChange={setGroupId}
              className="mb-3"
            />
          ) : null}

          <ClubCreatePanel
            clubSlug={clubSlug}
            clubId={club.id}
            groupId={groupId}
            groups={groups}
            threads={sourceThreads}
            canPost={signedIn && club.can_reply}
            canPostThread={club.can_post_thread}
            whoCanPost={club.who_can_post}
            className="mb-3"
          />

          {/* Pasek sterowania strumieniem: fraza + porządek. Filtr trybu stoi
              osobno pod spodem, bo zmienia ŹRÓDŁO, a nie kolejność. */}
          {activeTag !== "" ? (
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-[6px] bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                {t("club.inline.tagFilter", { tag: activeTag })}
              </span>
              <button
                type="button"
                onClick={clearTag}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                {t("club.inline.tagClear")}
              </button>
            </div>
          ) : null}

          <div className="mb-3 grid items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <div className="relative h-12 min-w-0">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("club.searchPlaceholder")}
                aria-label={t("club.searchPlaceholder")}
                className="h-12 min-h-12 rounded-[6px] py-0 pl-9 pr-9"
              />
              {query !== "" ? (
                <button
                  type="button"
                  onClick={clearTag}
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
                className={cn(
                  "h-12 min-h-12 items-center rounded-[6px] py-0 leading-none [&>svg]:self-center",
                  searching && "hidden",
                )}
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
              className="mb-2"
            />
          ) : null}

          {/* Zawężenia dotyczą WĄTKÓW, więc nie stoją nad strumieniem
              dokumentów ani terminów - tam nie miałyby czego odsiać. */}
          {!searching && (mode === "all" || mode === "threads") ? (
            <ClubStreamFilters
              kind={kind}
              onKindChange={(next) => applyThreadFilter(() => setKind(next), next !== null)}
              anchoredOnly={anchoredOnly}
              onAnchoredOnlyChange={(next) => applyThreadFilter(() => setAnchoredOnly(next), next)}
              unreadOnly={unreadOnly}
              onUnreadOnlyChange={(next) => applyThreadFilter(() => setUnreadOnly(next), next)}
              canFilterUnread={signedIn}
              className="mb-3"
            />
          ) : null}

          {/* Obszar tematyczny - poziom "wybór tematu" między działem
              a wątkiem. Liczniki jadą z WSZYSTKICH wątków klubu (`sourceThreads`),
              nie z bieżącego zawężenia - patrz nagłówek `ClubThreadTopicBar`. */}
          {!searching && (mode === "all" || mode === "threads") ? (
            <ClubThreadTopicBar
              threads={sourceThreads}
              catalog={topicsCatalog}
              value={topic}
              onChange={(next) => applyThreadFilter(() => setTopic(next), next !== null)}
              className="mb-3"
            />
          ) : null}

          {searching ? (
            <ClubGlobalSearchResults
              hits={searchQ.data ?? []}
              pending={searchQ.isPending}
              failed={searchQ.isError}
              query={debouncedQuery}
              onRetry={() => void searchQ.refetch()}
            />
          ) : threadsQ.isError ? (
            <ClubErrorNotice onRetry={() => void threadsQ.refetch()} />
          ) : threadsQ.isPending ? (
            <ClubThreadListSkeleton />
          ) : feed.length === 0 ? (
            <p className={cn(HUB_SURFACE, "p-10 text-center text-sm text-muted-foreground")}>
              {/* Pustka Z ZAWĘŻENIEM to nie jest pusty klub. Komunikat
                  "nie ma jeszcze tematów" pod włączonym filtrem jest po
                  prostu nieprawdą i wypycha użytkownika z klubu, który ma
                  treść dwa kliknięcia dalej. */}
              {kind !== null || anchoredOnly || topic !== null || (signedIn && unreadOnly)
                ? t("club.filters.empty")
                : mode === "all"
                  ? t("club.noThreads")
                  : t(`club.hub.feed.empty.${mode}`)}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {feed.map((entry) => (
                <ClubFeedItem
                  key={entry.key}
                  entry={entry}
                  clubSlug={clubSlug}
                  mediaUrls={mediaUrls}
                  sourceIndex={sourceIndex}
                  activeGroupId={groupId}
                  onSourceSelect={setGroupId}
                  topicsCatalog={topicsCatalog}
                  activeTopic={topic}
                  onTopicSelect={(next) => applyThreadFilter(() => setTopic(next), next !== null)}
                  onPostLike={(postId) => {
                    toggleLike.mutate(postId, {
                      onSuccess: () => void postsQ.refetch(),
                    });
                  }}
                  onPostDelete={(postId) => deletePost.mutate(postId)}
                  threadReactions={threadReactionsQ.data}
                  threadReactionActors={threadActorsQ.data}
                  reactionsPending={toggleThreadReaction.isPending}
                  canReact={signedIn && club.can_reply}
                  onThreadReact={(threadId, kind, active) =>
                    toggleThreadReaction.mutate({ targetId: threadId, kind, active })
                  }
                />
              ))}
            </div>
          )}

          {/* Doładowanie dotyczy WĄTKÓW - konteksty przyjechały w całości. */}
          {!searching && mode !== "documents" && mode !== "calendar" && threadsQ.hasNextPage ? (
            <>
              <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
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
            </>
          ) : null}

          {/* Kontekst na telefonie i tablecie: POD strumieniem - patrz nagłówek. */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:hidden">{context}</div>
        </main>

        <aside className="hidden xl:sticky xl:top-20 xl:block xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:overscroll-contain xl:pl-1 [scrollbar-width:thin]">
          <div className="flex flex-col gap-3">{context}</div>
        </aside>
      </div>
    </div>
  );
}
