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
  Lock,
  MessageSquare,
  MessagesSquare,
  Pin,
  Search,
  ShieldQuestion,
  Users2,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClubBySlug, useClubGroups, useClubSearch, useClubThreads } from "@/lib/clubs/useClubs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  CLUB_THREAD_KINDS,
  toAuthorLabel,
  type ClubSearchHit,
  type ClubThreadKind,
  type ClubThreadSort,
} from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/")({
  head: () => ({ meta: [{ name: "robots", content: "noindex,nofollow" }] }),
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
  const [query, setQuery] = useState("");

  const clubQ = useClubBySlug(clubSlug);
  const club = clubQ.data ?? null;
  const groupsQ = useClubGroups(club?.id);
  const threadsQ = useClubThreads({ clubId: club?.id, groupId, sort, kind });

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

  if (clubQ.isPending) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="h-64 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
      </div>
    );
  }

  // Zero wierszy z club_view oznacza 404, nie 403: klub `secret` bez dostępu
  // nie ma prawa zdradzić, że istnieje.
  if (!club) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
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
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <Card>
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
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold">{isPl ? club.name_pl : club.name_en}</h1>
            {(isPl ? club.tagline_pl : club.tagline_en) ? (
              <p className="mt-1 text-muted-foreground">
                {isPl ? club.tagline_pl : club.tagline_en}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/club/$clubSlug/about" params={{ clubSlug }}>
                {t("club.about")}
              </Link>
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

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Users2 className="h-4 w-4" />
            {t("club.membersCount", { count: club.member_count })}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MessagesSquare className="h-4 w-4" />
            {t("club.threadsCount", { count: club.thread_count })}
          </span>
          {club.attribution_mode === "chatham" ? (
            <Badge variant="outline" className="gap-1">
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
          działać (RPC wyszukiwania nie przyjmuje ich jako parametrów). */}
      <div className="relative mb-3">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("club.searchPlaceholder")}
          aria-label={t("club.searchPlaceholder")}
          className="pl-9 pr-9"
        />
        {query !== "" ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("club.searchClear")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* Filtry znikają w trybie wyszukiwania: droplista, która nic nie robi,
          jest gorsza niż jej brak. */}
      <div className={`mb-5 grid gap-2 sm:grid-cols-3 ${searching ? "hidden" : ""}`}>
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

        <Select value={sort} onValueChange={(v) => setSort(v as ClubThreadSort)}>
          <SelectTrigger aria-label={t("club.sort.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hot">{t("club.sort.hot")}</SelectItem>
            <SelectItem value="new">{t("club.sort.new")}</SelectItem>
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
      </div>

      {searching ? (
        <SearchResults
          clubSlug={clubSlug}
          hits={searchQ.data ?? []}
          pending={searchQ.isPending}
          query={debouncedQuery}
        />
      ) : threadsQ.isPending ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : threads.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            {t("club.noThreads")}
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="space-y-2">
            {threads.map((thread) => {
              const author = toAuthorLabel(
                thread,
                t("club.anonymousAuthor"),
                t("club.deletedAuthor"),
              );
              return (
                <li key={thread.id}>
                  <Link
                    to="/club/$clubSlug/t/$threadSlug"
                    params={{ clubSlug, threadSlug: thread.slug }}
                    className="block rounded-lg border border-border/60 bg-card p-4 transition-colors hover:border-primary/40"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {thread.pinned_at !== null ? (
                        <Pin className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      ) : null}
                      {thread.status === "locked" ? (
                        <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      ) : null}
                      <Badge variant="outline" className="text-[11px]">
                        {t(`club.kind.${thread.kind}`)}
                      </Badge>
                      {thread.status === "resolved" ? (
                        <Badge className="bg-emerald-500/15 text-[11px] text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
                          {t("club.threadStatus.resolved")}
                        </Badge>
                      ) : null}
                      {thread.status === "pending" ? (
                        <Badge
                          variant="outline"
                          className="text-[11px] text-amber-700 dark:text-amber-300"
                        >
                          {t("club.threadStatus.pending")}
                        </Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {isPl ? thread.group_name_pl : thread.group_name_en}
                      </span>
                    </div>

                    <h3 className="mt-1.5 font-medium leading-snug">{thread.title}</h3>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{author.name}</span>
                      <span className="inline-flex items-center gap-1.5">
                        <MessageSquare className="h-3.5 w-3.5" />
                        {thread.reply_count}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Users2 className="h-3.5 w-3.5" />
                        {thread.participant_count}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        {new Date(thread.last_reply_at ?? thread.created_at).toLocaleDateString(
                          isPl ? "pl-PL" : "en-GB",
                        )}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

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

/** Wyniki wyszukiwania - osobny komponent, bo mają inną treść wiersza niż
 *  lista tematów: cytat z dopasowaniem zamiast metryk aktywności. */
function SearchResults({
  clubSlug,
  hits,
  pending,
  query,
}: {
  clubSlug: string;
  hits: readonly ClubSearchHit[];
  pending: boolean;
  query: string;
}) {
  const { t } = useTranslation();

  if (pending) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/50" />
        ))}
      </div>
    );
  }

  if (hits.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          {t("club.searchEmpty", { query })}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">
        {t("club.searchCount", { count: hits.length })}
      </p>
      <ul className="space-y-2">
        {hits.map((hit) => (
          <li key={hit.thread_id}>
            <Link
              to="/club/$clubSlug/t/$threadSlug"
              params={{ clubSlug, threadSlug: hit.thread_slug }}
              className="block rounded-lg border border-border/60 bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[11px]">
                  {t(`club.kind.${hit.kind}`)}
                </Badge>
                <h3 className="min-w-0 flex-1 truncate font-medium">{hit.title}</h3>
              </div>
              {/* ts_headline zwraca fragment ze znacznikami <b>. Renderujemy go
                  jako TEKST po zdjęciu znaczników - wstrzykiwanie HTML z bazy
                  do listy wyników nie jest tego warte. */}
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {(hit.snippet ?? "").replace(/<\/?b>/g, "")}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  {hit.reply_count}
                </span>
                {hit.last_reply_at !== null ? (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(hit.last_reply_at).toLocaleDateString()}
                  </span>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
