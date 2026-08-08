// /club/$clubSlug - dom klubu: lista tematów.
//
// Indeksowalność jest WARUNKOWA i liczona z widoczności klubu: tylko klub
// `public` dostaje indeks, reszta `noindex,nofollow`. To ta sama doktryna,
// co warunkowy noindex na /author/$slug - klub prywatny nie może wypłynąć
// przez wyszukiwarkę, nawet gdyby ktoś trafił na URL.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Clock,
  MessageSquare,
  MessagesSquare,
  Search,
  ShieldQuestion,
  SlidersHorizontal,
  Users2,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { optionsWithCurrent, topicLabel } from "@/lib/clubs/topicCatalog";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import { useClubBySlug, useClubGroups, useClubSearch, useClubThreads } from "@/lib/clubs/useClubs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { ClubThreadList } from "@/components/clubs/organisms/ClubThreadList";
import { ClubCover } from "@/components/clubs/atoms/ClubCover";
import { ClubActivityStrip } from "@/components/clubs/molecules/ClubActivityStrip";
import { ClubWorkspaceNav } from "@/components/clubs/molecules/ClubWorkspaceNav";
import {
  CLUB_THREAD_KINDS,
  CLUB_THREAD_SORTS,
  CLUB_THREAD_SORTS_REQUIRING_SESSION,
  CLUB_THREAD_STATUSES,
  toClubLayout,
  type ClubThreadKind,
  type ClubThreadSort,
  type ClubThreadStatus,
} from "@/lib/clubs/types";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { ClubDetailSkeleton, ClubThreadListSkeleton } from "@/components/clubs/atoms/ClubSkeletons";
import {
  ClubGlobalSearchInput,
  ClubGlobalSearchResults,
} from "@/components/clubs/organisms/ClubGlobalSearch";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/api";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { ensureClubI18n } from "@/lib/i18n-club";
import { formatDateShort } from "@/lib/i18n/format";

export const Route = createFileRoute("/club/$clubSlug/")({
  // Indeksowalność liczy się z WIDOCZNOŚCI klubu, a head() jest synchroniczne -
  // stąd loader. Wcześniej ta trasa emitowała bezwarunkowy `noindex`, mimo że
  // komentarz w jej nagłówku opisywał zachowanie warunkowe, a specyfikacja
  // (V1 §5.1) czyni klub `public` jedyną powierzchnią modułu, która ma dowozić
  // ruch z wyszukiwarek.
  loader: async ({ context, params }) => {
    const club = await context.queryClient
      .ensureQueryData({
        queryKey: clubKeys.bySlug(params.clubSlug),
        queryFn: () => fetchClubBySlug(params.clubSlug),
      })
      .catch(() => null);
    return { club: toClubHeadSource(club) };
  },
  head: ({ loaderData, params }) =>
    buildClubHead({
      fallbackPath: `/club/${params.clubSlug}`,
      club: loaderData?.club ?? null,
    }),
  component: ClubHome,
});

const ALL = "__all__";

function ClubHome() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const { clubSlug } = Route.useParams();

  const [groupId, setGroupId] = useState<string | null>(null);
  const [sort, setSort] = useState<ClubThreadSort>("hot");
  const [kind, setKind] = useState<ClubThreadKind | null>(null);
  // Filtry ze spec §5.2, których lista nie miała. `anchored === null` znaczy
  // "wszystkie", a nie "bez kotwicy" - te dwie odpowiedzi są różne i muszą
  // przeżyć drogę aż do RPC.
  const [status, setStatus] = useState<ClubThreadStatus | null>(null);
  const [anchored, setAnchored] = useState<boolean | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Obszar tematyczny - to samo slownictwo, co na hubie i w kreatorze klubu.
  const [topic, setTopic] = useState<string | null>(null);
  const { topics: topicCatalog } = useClubTopics();
  // Obszar wybrany w filtrze zostaje na liście nawet po wyłączeniu go w
  // panelu - inaczej aktywny filtr wskazywałby na nieistniejącą opcję.
  const topicOptions = optionsWithCurrent(topicCatalog, topic, isPl ? "pl" : "en");
  const [query, setQuery] = useState("");
  // Filtry są ZWINIĘTE domyślnie: pięć droplist nad listą wątków zjadało cały
  // pierwszy ekran, a porządek sortowania - jedyna kontrolka używana za każdym
  // wejściem - stoi w pasku na stałe.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { session } = useAuth();
  const signedIn = session !== null;
  const clubQ = useClubBySlug(clubSlug);
  const club = clubQ.data ?? null;
  const groupsQ = useClubGroups(club?.id);
  const availableSorts = CLUB_THREAD_SORTS.filter(
    (value) => session !== null || !CLUB_THREAD_SORTS_REQUIRING_SESSION.includes(value),
  );
  const threadsQ = useClubThreads({
    clubId: club?.id,
    groupId,
    sort,
    kind,
    status,
    anchored,
    // Anonim nie ma czego nie przeczytać - wysłanie `true` bez sesji dałoby
    // pustą listę wyglądającą jak pusty klub.
    unreadOnly: signedIn && unreadOnly,
    topic,
  });

  // Wyszukiwanie ZASTĘPUJE listę, nie stoi obok niej: dwie listy naraz na
  // telefonie znaczą, że użytkownik nie wie, którą czyta. Debounce 250 ms,
  // próg dwóch znaków po stronie hooka.
  const debouncedQuery = useDebouncedValue(query, 250);
  const searching = debouncedQuery.trim().length >= 2;
  const searchQ = useClubSearch({
    query: debouncedQuery,
    clubId: club?.id ?? null,
    enabled: searching && Boolean(club?.id),
  });

  // Skeleton ma KSZTAŁT strony klubu (baner, tytuł, pasek sterowania, lista
  // wątków), więc dojście danych nie przebudowuje układu.
  if (clubQ.isPending) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-6">
        <ClubDetailSkeleton />
      </div>
    );
  }

  // Awaria RPC to NIE jest 404. Zero wierszy znaczy "nie ma czego pokazać"
  // (klub `secret` bez dostępu nie ma prawa zdradzić, że istnieje), a błąd
  // sieci albo bazy ma powiedzieć, że problem jest po naszej stronie -
  // inaczej użytkownik z poprawnym linkiem dowiaduje się, że klub nie istnieje.
  if (clubQ.isError) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-12">
        <ClubErrorNotice onRetry={() => void clubQ.refetch()} />
      </div>
    );
  }

  // Zero wierszy z club_view oznacza 404, nie 403: klub `secret` bez dostępu
  // nie ma prawa zdradzić, że istnieje.
  if (!club) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-12">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <MessagesSquare className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("club.reason.not_found")}</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/club">{t("club.title")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Karta klubu prywatnego jest widoczna, treść nie - to jest sens tej
  // widoczności. Pokazujemy powód i akcję zamiast pustej listy.
  if (!club.can_read) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-12">
        <Card className="overflow-hidden">
          {/* Okładka jest częścią WIZYTÓWKI, nie treści - klub zamknięty ma
              prawo wyglądać jak klub, mimo że wątków nie pokazuje. */}
          <ClubCover
            url={club.cover_image_url}
            variant="banner"
            className="rounded-none border-0"
          />
          <CardContent className="space-y-4 p-8 text-center">
            <h1 className="text-2xl font-semibold">{isPl ? club.name_pl : club.name_en}</h1>
            {(isPl ? club.tagline_pl : club.tagline_en) ? (
              <p className="text-muted-foreground">{isPl ? club.tagline_pl : club.tagline_en}</p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {club.reason ? t(`club.reason.${club.reason}`) : t("club.reason.not_member")}
            </p>
            {club.join_policy !== "invite" ? (
              <Button asChild>
                <Link to="/club/$clubSlug/about" params={{ clubSlug }}>
                  {club.join_policy === "open" ? t("club.join") : t("club.requestJoin")}
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  const groups = groupsQ.data ?? [];
  const pages = threadsQ.data?.pages ?? [];
  const threads = pages.flatMap((p) => p.rows);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-6">
      {/* Nagłówek klubu jest KOMPAKTOWY: baner 6:1 zamiast 3:1 i tytuł 2xl,
          bo wejście z huba ma pokazać WĄTKI, a nie okładkę na pół ekranu. */}
      <header className="mb-4">
        <ClubCover
          url={club.cover_image_url}
          variant="banner"
          className="mb-3 aspect-[6/1] sm:aspect-[8/1]"
        />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight sm:text-2xl">
              {isPl ? club.name_pl : club.name_en}
            </h1>
            {(isPl ? club.tagline_pl : club.tagline_en) ? (
              <p className="mt-1 line-clamp-2 max-w-3xl text-sm text-muted-foreground">
                {isPl ? club.tagline_pl : club.tagline_en}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/club/$clubSlug/minisite" params={{ clubSlug }}>
                {t("club.minisite.eyebrow")}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/club/$clubSlug/about" params={{ clubSlug }}>
                {t("club.about")}
              </Link>
            </Button>
            {/* CTA do wątków: wejście z huba ma JEDEN oczywisty następny krok,
                a nagłówek do tej pory oferował tylko odnogi (minisite, o
                klubie, skład). Kotwica przewija do listy wątków. */}
            <Button asChild size="sm" variant="secondary">
              <a href="#club-threads">
                <MessagesSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t("club.hub.goToThreads")}
              </a>
            </Button>
            {club.can_post_thread ? (
              <Button asChild size="sm">
                <Link to="/club/$clubSlug/new" params={{ clubSlug }}>
                  {t("club.newThread")}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>

        {/* Zakładki przestrzeni roboczej. Zastąpiły dwa przyciski z tego
            nagłówka (skład klubu i - po A28 - cztery kolejne odnogi): rząd
            przycisków mówi tylko DOKĄD można pójść, zakładka mówi także,
            GDZIE się jest. Skład pokazujemy wyłącznie wtedy, gdy pozwala na to
            `can_see_members` z club_capabilities - to jest ta sama bramka,
            która wcześniej rządziła osobnym przyciskiem. */}
        <ClubWorkspaceNav
          clubSlug={clubSlug}
          canSeeMembers={club.can_see_members}
          className="mt-3"
        />

        {/* Pasek dynamiki: stan (członkowie, tematy) i RUCH (14 dni) w jednym
            wierszu - dopiero razem mówią, czy klub żyje. */}
        <ClubActivityStrip threads={threads} className="mt-3" />

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Users2 className="h-3.5 w-3.5" />
            {t("club.membersCount", { count: club.member_count })}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MessagesSquare className="h-3.5 w-3.5" />
            {t("club.threadsCount", { count: club.thread_count })}
          </span>
          {club.attribution_mode === "chatham" ? (
            <Badge variant="outline" className="gap-1 text-[11px]">
              <ShieldQuestion className="h-3 w-3" />
              {t("club.attribution.chatham")}
            </Badge>
          ) : null}
        </div>

        {/* Powód informacyjny (np. premoderacja) mówi się PRZED napisaniem,
            nie po odrzuceniu wpisu. */}
        {club.reason === "pre_moderation" ? (
          <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            {t("club.reason.pre_moderation")}
          </p>
        ) : null}
      </header>

      {/* Wyszukiwanie: nad filtrami, bo fraza jest silniejszym zawężeniem niż
          grupa czy rodzaj - a gdy jest wpisana, filtry i tak nie mają na co
          działać (RPC wyszukiwania nie przyjmuje ich jako parametrów).
          Kontrolka jest WSPÓLNA z hubem: wcześniej ten sam układ (ikona, pole
          `pl-9 pr-9`, przycisk czyszczenia) stał tu w drugiej kopii, więc
          poprawka celu dotykowego musiałaby być robiona dwa razy. */}
      {/* Pasek sterowania: fraza, porządek i przełącznik reszty filtrów w
          jednym wierszu. Sortowanie zostaje na wierzchu, bo zmienia listę
          przy każdym wejściu; grupa/rodzaj/status to zawężenia okazjonalne. */}
      <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
        <ClubGlobalSearchInput
          value={query}
          onChange={setQuery}
          placeholderKey="club.searchPlaceholder"
        />
        {/* Sześć porządków z RPC (A18), nie dwa. `mine` i `subscribed`
            filtrują po wołającym, więc dla anonima zwróciłyby pusty zbiór
            i sugerowały, że klub jest pusty - dla niego ich nie ma. */}
        <Select value={sort} onValueChange={(v) => setSort(v as ClubThreadSort)}>
          <SelectTrigger aria-label={t("club.sort.label")} className={searching ? "hidden" : ""}>
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
        <Button
          type="button"
          variant="outline"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((v) => !v)}
          className={searching ? "hidden" : ""}
        >
          <SlidersHorizontal className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t("club.filters.title")}
        </Button>
      </div>

      {/* Filtry znikają w trybie wyszukiwania: droplista, która nic nie robi,
          jest gorsza niż jej brak. */}
      <div
        className={`mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 ${searching || !filtersOpen ? "hidden" : ""}`}
      >
        <Select value={groupId ?? ALL} onValueChange={(v) => setGroupId(v === ALL ? null : v)}>
          <SelectTrigger aria-label={t("club.groups")}>
            <SelectValue placeholder={t("club.groups")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("club.allGroups")}</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {isPl ? g.name_pl : g.name_en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={topic ?? ALL} onValueChange={(v) => setTopic(v === ALL ? null : v)}>
          <SelectTrigger aria-label={t("club.topic.label")}>
            <SelectValue placeholder={t("club.topic.label")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("club.topic.all")}</SelectItem>
            {topicOptions.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {topicLabel(option.key, isPl ? "pl" : "en", topicOptions)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={kind ?? ALL}
          onValueChange={(v) => setKind(v === ALL ? null : (v as ClubThreadKind))}
        >
          <SelectTrigger aria-label={t("club.kind.label")}>
            <SelectValue placeholder={t("club.kind.label")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("club.allKinds")}</SelectItem>
            {CLUB_THREAD_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`club.kind.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Trzy filtry ze spec §5.2, których nie było: status, zakotwiczenie
            i „tylko nieprzeczytane". Status pokazujemy WYŁĄCZNIE moderacji -
            dla członka lista i tak zawiera tylko wątki widoczne, więc droplista
            byłaby wyborem między „wszystkie" a „wszystkie". Filtr
            nieprzeczytanych wymaga sesji z tego samego powodu, co sorty
            `mine`/`subscribed`: anonim nie ma czego nie przeczytać. */}
        <Select
          value={anchored === null ? ALL : anchored ? "anchored" : "loose"}
          onValueChange={(v) => setAnchored(v === ALL ? null : v === "anchored")}
        >
          <SelectTrigger aria-label={t("club.filters.anchor")}>
            <SelectValue placeholder={t("club.filters.anchor")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("club.filters.anchorAny")}</SelectItem>
            <SelectItem value="anchored">{t("club.filters.anchorOnly")}</SelectItem>
            <SelectItem value="loose">{t("club.filters.anchorNone")}</SelectItem>
          </SelectContent>
        </Select>

        {club.can_moderate ? (
          <Select
            value={status ?? ALL}
            onValueChange={(v) => setStatus(v === ALL ? null : (v as ClubThreadStatus))}
          >
            <SelectTrigger aria-label={t("club.filters.status")}>
              <SelectValue placeholder={t("club.filters.status")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("club.filters.status")}</SelectItem>
              {CLUB_THREAD_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`club.threadStatus.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {signedIn ? (
          <div className="flex items-center gap-2 rounded-md border border-border/60 px-3">
            <Switch
              id="club-unread-only"
              checked={unreadOnly}
              onCheckedChange={setUnreadOnly}
              aria-label={t("club.filters.unreadOnly")}
            />
            <Label htmlFor="club-unread-only" className="text-sm font-normal">
              {t("club.filters.unreadOnly")}
            </Label>
          </div>
        ) : null}
      </div>

      <div id="club-threads" className="scroll-mt-24" />

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
      ) : threads.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            {t("club.noThreads")}
          </CardContent>
        </Card>
      ) : (
        <>
          <ClubThreadList
            clubSlug={clubSlug}
            threads={threads}
            layout={toClubLayout(club.layout)}
            isPl={isPl}
          />

          {threadsQ.hasNextPage ? (
            <div className="mt-4 text-center">
              <Button
                variant="outline"
                disabled={threadsQ.isFetchingNextPage}
                onClick={() => void threadsQ.fetchNextPage()}
              >
                {threadsQ.isFetchingNextPage ? t("club.loadingMore") : t("club.loadMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
