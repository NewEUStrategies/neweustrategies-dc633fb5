// Karta strumienia huba - jedna dla czterech rodzajów wpisu.
//
// DLACZEGO JEDEN PLIK, A NIE CZTERY KOMPONENTY W CZTERECH MIEJSCACH. Karty
// stoją JEDNA POD DRUGĄ w tej samej kolumnie, więc każda różnica w wysokości
// nagłówka, w rozmiarze awatara albo w rytmie odstępów widać natychmiast.
// Wspólny plik wymusza wspólny szkielet: pasek meta -> tytuł -> treść ->
// pasek zaangażowania. Cztery pliki rozjechałyby się przy pierwszej zmianie.
//
// KARTA WĄTKU jest kręgosłupem i wygląda najbogaciej (autor, temperatura,
// liczniki). Karty kontekstowe są CELOWO cichsze - mają informować, a nie
// konkurować z rozmową o uwagę.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  CalendarClock,
  Clock,
  Download,
  ExternalLink,
  Lightbulb,
  ListChecks,
  MapPin,
  MessagesSquare,
  Pin,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HUB_SURFACE } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubInlineTitle } from "@/components/clubs/atoms/ClubInlineTitle";
import { ClubSourceChip } from "@/components/clubs/atoms/ClubSourceChip";
import { ClubThreadHeat } from "@/components/clubs/atoms/ClubThreadHeat";
import { ClubTopicChip } from "@/components/clubs/atoms/ClubTopicChip";
import {
  ClubDocumentKindIcon,
  ClubEventKindIcon,
  ClubMilestoneStateChip,
  clubEventToneClass,
} from "@/components/clubs/atoms/ClubWorkspaceBadges";
import { toAuthorLabel, type ClubThreadListRow } from "@/lib/clubs/types";
import {
  documentHref,
  toDocumentKind,
  toEventKind,
  toMilestoneState,
  type ClubDocumentRow,
  type ClubEventRow,
  type ClubMilestoneRow,
} from "@/lib/clubs/workspaceTypes";
import { registerClubDocumentDownload } from "@/lib/clubs/workspaceApi";
import { ClubPostCard } from "@/components/clubs/organisms/ClubPostCard";
import type { ClubFeedEntry } from "@/lib/clubs/clubFeed";
import { clubSourceOf, type ClubSourceMark } from "@/lib/clubs/threadSources";
import type { ClubTopicOption } from "@/lib/clubs/topicCatalog";
import { formatDate, formatDateTime, formatDateShort } from "@/lib/i18n/format";

/** Stała pusta mapa - literał w domyślnej wartości propa tworzyłby NOWĄ mapę
 *  przy każdym renderze i psuł memoizację kart. */
const EMPTY_SOURCES: ReadonlyMap<string, ClubSourceMark> = new Map();
/** Stała pusta lista - ten sam powód, co `EMPTY_SOURCES`. */
const EMPTY_TOPICS: readonly ClubTopicOption[] = [];

/** Nagłówek karty kontekstowej: ikona w kwadracie 6 px + etykieta rodzaju. */
function ContextHeader({
  label,
  tone,
  children,
}: {
  label: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border", tone)}
      >
        {children}
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function ThreadCard({
  thread,
  clubSlug,
  isPl,
  sourceIndex,
  activeGroupId,
  onSourceSelect,
  topicsCatalog,
  activeTopic,
  onTopicSelect,
}: {
  thread: ClubThreadListRow;
  clubSlug: string;
  isPl: boolean;
  sourceIndex: ReadonlyMap<string, ClubSourceMark>;
  activeGroupId: string | null;
  onSourceSelect?: (groupId: string | null) => void;
  topicsCatalog: readonly ClubTopicOption[];
  activeTopic: string | null;
  onTopicSelect?: (topic: string | null) => void;
}) {
  const { t } = useTranslation();
  const lang = isPl ? "pl" : "en";
  const author = toAuthorLabel(thread, t("club.anonymousAuthor"), t("club.deletedAuthor"));
  const stamp = thread.last_reply_at ?? thread.created_at;
  const source = clubSourceOf(thread, sourceIndex, isPl);

  return (
    <article
      className={cn(
        HUB_SURFACE,
        "p-3.5 transition-colors hover:border-primary/40 sm:p-4",
        thread.pinned_at !== null && "border-primary/40",
        // Nieprzeczytane dostaje lewą krawędź, a nie kolor tła: tło zmienia
        // kontrast tekstu i psuje czytelność w trybie ciemnym.
        thread.is_unread && "border-l-2 border-l-primary",
      )}
      data-testid="club-feed-thread"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <ClubAuthorAvatar
          name={author.name}
          avatarUrl={thread.author_avatar}
          size="sm"
          // Autor anonimowy i konto usunięte nie dostają akcentu marki -
          // awatar ma wtedy mówić "nie wiadomo kto", a nie "ktoś ważny".
          muted={author.kind !== "named"}
        />
        <span className="font-medium text-foreground">{author.name}</span>
        {/* ŹRÓDŁO, a nie kolejne słowo w szarym pasku. Nazwa działu stała tu
            wcześniej między autorem a datą i wyglądała jak część podpisu -
            czyli jedyna informacja o tym, gdzie w klubie jesteśmy, ginęła
            w interpunkcji. Chip niesie kolor i ikonę działu i zawęża strumień. */}
        {source !== null ? (
          <ClubSourceChip
            source={source}
            active={source.id !== null && source.id === activeGroupId}
            onSelect={onSourceSelect}
          />
        ) : null}
        <span aria-hidden="true">·</span>
        <time dateTime={stamp}>{formatDateShort(stamp, lang)}</time>
        {thread.pinned_at !== null ? (
          <Badge variant="outline" className="gap-1 rounded-lg text-[11px]">
            <Pin className="h-3 w-3" aria-hidden="true" />
            {t("club.hub.feed.pinned")}
          </Badge>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="rounded-lg text-[11px]">
          {t(`club.kind.${thread.kind}`)}
        </Badge>
        {thread.status === "resolved" ? (
          <Badge className="rounded-lg bg-emerald-600 text-[11px] hover:bg-emerald-600">
            {t("club.threadStatus.resolved")}
          </Badge>
        ) : null}
        {thread.anchor_label !== null && thread.anchor_label.trim() !== "" ? (
          <Badge variant="outline" className="max-w-full rounded-lg text-[11px]">
            <span className="truncate">{thread.anchor_label}</span>
          </Badge>
        ) : null}
        {/* Obszar tematyczny - czwarta oś obok rodzaju/statusu/kotwicy. Do tej
            pory ta kolumna istniała w bazie i nie pokazywała się nigdzie na
            wierszu wątku - patrz nagłówek `ClubThreadTopicBar`. */}
        <ClubTopicChip
          topic={thread.topic}
          lang={lang}
          catalog={topicsCatalog}
          size="sm"
          active={thread.topic !== "" && thread.topic === activeTopic}
          onSelect={onTopicSelect}
        />
      </div>

      <h3 className="mt-1.5">
        <Link
          to="/club/$clubSlug/t/$threadSlug"
          params={{ clubSlug, threadSlug: thread.slug }}
          className="group/title inline-block max-w-full"
        >
          <ClubInlineTitle tone="thread" size="md" interactive>
            {thread.title}
          </ClubInlineTitle>
        </Link>
      </h3>

      {thread.excerpt !== null && thread.excerpt.trim() !== "" ? (
        <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
          {thread.excerpt}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
          {t("club.repliesCount", { count: thread.reply_count })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {t("club.hub.feed.participantsCount", { count: thread.participant_count })}
        </span>
        {thread.insightful_count > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
            {thread.insightful_count}
          </span>
        ) : null}
        <ClubThreadHeat thread={thread} className="ml-auto" />
      </div>
    </article>
  );
}

function EventCard({ event, isPl }: { event: ClubEventRow; isPl: boolean }) {
  const { t } = useTranslation();
  const lang = isPl ? "pl" : "en";
  const kind = toEventKind(event.kind);
  const description = isPl ? event.description_pl : event.description_en;

  return (
    <article className={cn(HUB_SURFACE, "p-3.5 sm:p-4")} data-testid="club-feed-event">
      <ContextHeader label={t("club.hub.feed.eventLabel")} tone={clubEventToneClass(kind)}>
        <ClubEventKindIcon kind={kind} className="h-3.5 w-3.5" />
      </ContextHeader>

      <h3 className="mt-2">
        <ClubInlineTitle tone="event">{isPl ? event.title_pl : event.title_en}</ClubInlineTitle>
      </h3>

      <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {event.all_day
          ? formatDate(event.starts_at, lang, { day: "numeric", month: "long", year: "numeric" })
          : formatDateTime(event.starts_at, lang)}
      </p>

      {description !== null && description.trim() !== "" ? (
        <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{description}</p>
      ) : null}

      {event.location !== null && event.location.trim() !== "" ? (
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {event.location}
        </p>
      ) : null}
    </article>
  );
}

function DocumentsCard({
  documents,
  isPl,
  single,
}: {
  documents: readonly ClubDocumentRow[];
  isPl: boolean;
  single: boolean;
}) {
  const { t } = useTranslation();

  return (
    <article className={cn(HUB_SURFACE, "p-3.5 sm:p-4")} data-testid="club-feed-documents">
      <ContextHeader
        label={single ? t("club.hub.feed.documentLabel") : t("club.hub.feed.documentsLabel")}
        tone="border-border/60 bg-muted/40 text-muted-foreground"
      >
        <ClubDocumentKindIcon
          kind={toDocumentKind(documents[0]?.kind ?? "other")}
          className="h-3.5 w-3.5"
        />
      </ContextHeader>

      <ul className="mt-2 flex flex-col gap-2">
        {documents.map((document) => {
          const href = documentHref(document);
          const isFile = document.file_url !== null && document.file_url.trim() !== "";
          const summary = isPl ? document.summary_pl : document.summary_en;
          return (
            <li key={document.id} className="flex items-start gap-2.5">
              <ClubDocumentKindIcon
                kind={toDocumentKind(document.kind)}
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
              />
              <div className="min-w-0 flex-1">
                <p>
                  <ClubInlineTitle tone="document" size="sm">
                    {isPl ? document.title_pl : document.title_en}
                  </ClubInlineTitle>
                </p>
                {single && summary !== null && summary.trim() !== "" ? (
                  <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{summary}</p>
                ) : null}
              </div>
              {href !== null ? (
                <Button asChild size="sm" variant="ghost" className="h-7 shrink-0 rounded-lg px-2">
                  <a
                    href={href}
                    target={isFile ? undefined : "_blank"}
                    rel={isFile ? undefined : "noreferrer"}
                    download={isFile ? "" : undefined}
                    onClick={() => void registerClubDocumentDownload(document.id)}
                    aria-label={isFile ? t("club.docs.download") : t("club.docs.open")}
                  >
                    {isFile ? (
                      <Download className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    )}
                  </a>
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function MilestoneCard({
  milestone,
  clubSlug,
  isPl,
}: {
  milestone: ClubMilestoneRow;
  clubSlug: string;
  isPl: boolean;
}) {
  const { t } = useTranslation();
  const lang = isPl ? "pl" : "en";
  const state = toMilestoneState(milestone.state);
  const description = isPl ? milestone.description_pl : milestone.description_en;

  return (
    <article className={cn(HUB_SURFACE, "p-3.5 sm:p-4")} data-testid="club-feed-milestone">
      <ContextHeader
        label={t("club.hub.feed.stageLabel")}
        tone="border-primary/40 bg-primary/10 text-primary"
      >
        <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
      </ContextHeader>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h3>
          <ClubInlineTitle tone="milestone">
            {isPl ? milestone.title_pl : milestone.title_en}
          </ClubInlineTitle>
        </h3>
        <ClubMilestoneStateChip state={state} />
      </div>

      {description !== null && description.trim() !== "" ? (
        <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{description}</p>
      ) : null}

      {milestone.due_on !== null ? (
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("club.hub.stage.due", {
            date: formatDate(milestone.due_on, lang, { day: "numeric", month: "short" }),
          })}
        </p>
      ) : null}

      <Button asChild size="sm" variant="ghost" className="mt-2 h-7 rounded-lg px-2">
        <Link to="/club/$clubSlug/schedule" params={{ clubSlug }}>
          {t("club.hub.feed.toSchedule")}
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </Button>
    </article>
  );
}

export function ClubFeedItem({
  entry,
  clubSlug,
  isPl,
  mediaUrls = {},
  sourceIndex = EMPTY_SOURCES,
  activeGroupId = null,
  onSourceSelect,
  topicsCatalog = EMPTY_TOPICS,
  activeTopic = null,
  onTopicSelect,
  onPostLike,
  onPostDelete,
}: {
  entry: ClubFeedEntry;
  clubSlug: string;
  isPl: boolean;
  /** Podpisane adresy plików wpisów - jedno zapytanie na cały strumień. */
  mediaUrls?: Record<string, string>;
  /** Kolory i ikony działów - budowane RAZ nad listą, nie per karta. */
  sourceIndex?: ReadonlyMap<string, ClubSourceMark>;
  activeGroupId?: string | null;
  onSourceSelect?: (groupId: string | null) => void;
  /** Katalog obszarów tematycznych - pobrany RAZ nad listą, nie per karta. */
  topicsCatalog?: readonly ClubTopicOption[];
  activeTopic?: string | null;
  onTopicSelect?: (topic: string | null) => void;
  onPostLike?: (postId: string) => void;
  onPostDelete?: (postId: string) => void;
}) {
  if (entry.kind === "thread") {
    return (
      <ThreadCard
        thread={entry.thread}
        clubSlug={clubSlug}
        isPl={isPl}
        sourceIndex={sourceIndex}
        activeGroupId={activeGroupId}
        onSourceSelect={onSourceSelect}
        topicsCatalog={topicsCatalog}
        activeTopic={activeTopic}
        onTopicSelect={onTopicSelect}
      />
    );
  }
  if (entry.kind === "post") {
    return (
      <ClubPostCard
        post={entry.post}
        clubSlug={clubSlug}
        isPl={isPl}
        mediaUrls={mediaUrls}
        sourceIndex={sourceIndex}
        activeGroupId={activeGroupId}
        onSourceSelect={onSourceSelect}
        onLike={onPostLike}
        onDelete={onPostDelete}
      />
    );
  }
  if (entry.kind === "event") {
    return <EventCard event={entry.event} isPl={isPl} />;
  }
  if (entry.kind === "milestone") {
    return <MilestoneCard milestone={entry.milestone} clubSlug={clubSlug} isPl={isPl} />;
  }
  return (
    <DocumentsCard documents={entry.documents} isPl={isPl} single={entry.documents.length === 1} />
  );
}
