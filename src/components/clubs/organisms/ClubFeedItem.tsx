// Karta strumienia huba - jedna dla pięciu rodzajów wpisu.
//
// DLACZEGO JEDEN PLIK, A NIE PIĘĆ KOMPONENTÓW W PIĘCIU MIEJSCACH. Karty
// stoją JEDNA POD DRUGĄ w tej samej kolumnie, więc każda różnica w wysokości
// nagłówka, w rozmiarze awatara albo w rytmie odstępów widać natychmiast.
// Wspólny plik i wspólna powłoka (`ClubFeedCard`) wymuszają wspólny szkielet:
// kontekst -> autor -> treść -> liczniki -> akcje. Pięć plików rozjechałoby
// się przy pierwszej zmianie.
//
// KARTA WĄTKU jest kręgosłupem i wygląda najbogaciej (autor z twarzą,
// rodzaj, dział, obszar, dynamika, reakcje, odpowiedzi). Karty kontekstowe
// (termin, etap, materiały) są CELOWO cichsze - zamiast twarzy autora mają
// kwadrat rodzaju w tym samym rozmiarze, więc nagłówki wszystkich kart stoją
// w jednej linii, ale nie konkurują z rozmową o uwagę.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  Clock,
  Download,
  ExternalLink,
  ListChecks,
  MapPin,
  Pin,
} from "lucide-react";
import { ClubThreadKindIcon } from "@/components/clubs/atoms/ClubThreadKindIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubAuthorIdentity } from "@/components/clubs/atoms/ClubAuthorIdentity";
import {
  ClubDossierKind,
  clubDossierIconBoxClass,
  clubThreadTone,
} from "@/components/clubs/atoms/ClubDossierRow";
import { ClubFeedText } from "@/components/clubs/atoms/ClubFeedText";
import { ClubInlineTitle } from "@/components/clubs/atoms/ClubInlineTitle";
import { ClubSourceChip } from "@/components/clubs/atoms/ClubSourceChip";
import { ClubThreadHeat } from "@/components/clubs/atoms/ClubThreadHeat";
import { ClubTopicChip } from "@/components/clubs/atoms/ClubTopicChip";
import {
  ClubDocumentKindIcon,
  ClubEventKindIcon,
  ClubMilestoneStateChip,
} from "@/components/clubs/atoms/ClubWorkspaceBadges";
import {
  CLUB_FEED_ACTION_ICON,
  CLUB_FEED_PAD,
  ClubFeedActionBar,
  ClubFeedActor,
  ClubFeedCard,
  ClubFeedContext,
  ClubFeedKindAvatar,
  ClubFeedTime,
  clubFeedActionClass,
} from "@/components/clubs/molecules/ClubFeedCard";
import {
  toAuthorLabel,
  type ClubReactionActor,
  type ClubReactionKind,
  type ClubReactionTally,
  type ClubThreadListRow,
} from "@/lib/clubs/types";
import { ClubEngagementBar } from "@/components/clubs/molecules/ClubEngagementBar";
import { useMentionEntity } from "@/components/mentions/MentionDirectory";
import { normalizeClubThreadIcon } from "@/lib/clubs/threadIcons";

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
import { clubThreadExcerpt, type ClubFeedEntry } from "@/lib/clubs/clubFeed";
import { clubSourceOf, type ClubSourceMark } from "@/lib/clubs/threadSources";
import type { ClubTopicOption } from "@/lib/clubs/topicCatalog";
import { formatDate, formatDateTime, uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

/** Stała pusta mapa - literał w domyślnej wartości propa tworzyłby NOWĄ mapę
 *  przy każdym renderze i psuł memoizację kart. */
const EMPTY_SOURCES: ReadonlyMap<string, ClubSourceMark> = new Map();
/** Stała pusta lista - ten sam powód, co `EMPTY_SOURCES`. */
const EMPTY_TOPICS: readonly ClubTopicOption[] = [];

/** Tytuł karty - jedna skala dla wszystkich rodzajów. */
const TITLE = "text-base font-semibold leading-snug tracking-tight text-foreground sm:text-lg";
/** Treść karty - `lh` w `ClubFeedText` liczy się z tej wysokości linii. */
const BODY = "text-sm leading-6 text-foreground/85";

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function ThreadCard({
  thread,
  clubSlug,
  index,
  sourceIndex,
  activeGroupId,
  onSourceSelect,
  topicsCatalog,
  activeTopic,
  onTopicSelect,
  reactions,
  reactionActors,
  reactionsPending,
  canReact = true,
  onReact,
}: {
  thread: ClubThreadListRow;
  clubSlug: string;
  index: number;
  sourceIndex: ReadonlyMap<string, ClubSourceMark>;
  activeGroupId: string | null;
  onSourceSelect?: (groupId: string | null) => void;
  topicsCatalog: readonly ClubTopicOption[];
  activeTopic: string | null;
  onTopicSelect?: (topic: string | null) => void;
  reactions?: readonly ClubReactionTally[];
  reactionActors?: readonly ClubReactionActor[];
  reactionsPending?: boolean;
  /** Czy zalogowany użytkownik ma prawo reagować w tym klubie. */
  canReact?: boolean;
  onReact?: (targetId: string, kind: ClubReactionKind, active: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const author = toAuthorLabel(thread, t("club.anonymousAuthor"), t("club.deletedAuthor"));
  const entity = useMentionEntity(author.profileSlug);
  const jobTitle = entity !== null && entity.kind === "person" ? entity.jobTitle : null;
  const stamp = thread.last_reply_at ?? thread.created_at;
  const source = clubSourceOf(thread, sourceIndex, lang);
  const tone = clubThreadTone(thread.kind);
  const pinned = thread.pinned_at !== null;
  // Normalizacja przy ODCZYCIE: wiersze sprzed katalogu ikon mogą nieść nazwę
  // spoza zestawu kurowanego, a taka dociągałaby pełny rejestr lucide do
  // chunku strumienia - degradujemy ją do braku ikony.
  const threadIcon = normalizeClubThreadIcon(thread.icon);
  const excerpt = hasText(thread.excerpt) ? clubThreadExcerpt(thread.excerpt) : null;

  return (
    <ClubFeedCard
      tone={tone}
      index={index}
      testId="club-feed-thread"
      unread={thread.is_unread}
      pinned={pinned}
    >
      {/* KONTEKST: co to jest i gdzie leży. Ikona rodzaju jest tą samą ikoną,
          co w szynie i na liście tematów (`ClubThreadKindIcon`). */}
      <ClubFeedContext
        trailing={
          <>
            {pinned ? (
              <span className="inline-flex items-center gap-1 font-medium text-primary">
                <Pin className="h-3 w-3" aria-hidden="true" />
                {t("club.hub.feed.pinned")}
              </span>
            ) : null}
            <ClubThreadHeat thread={thread} />
          </>
        }
      >
        {thread.is_unread ? (
          <span className="inline-flex items-center">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            <span className="sr-only">{t("club.hub.sources.unread")}</span>
          </span>
        ) : null}
        <span
          aria-hidden="true"
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded-md border [&_svg]:h-3 [&_svg]:w-3",
            clubDossierIconBoxClass(tone),
          )}
        >
          <ClubThreadKindIcon kind={thread.kind} icon={threadIcon} />
        </span>
        <ClubDossierKind className="h-5">{t(`club.kind.${thread.kind}`)}</ClubDossierKind>
        {thread.status === "resolved" ? (
          <Badge className="h-5 rounded-md bg-emerald-600 px-1.5 py-0 text-[10px] hover:bg-emerald-600">
            {t("club.threadStatus.resolved")}
          </Badge>
        ) : null}
        {/* ŹRÓDŁO, a nie kolejne słowo w szarym pasku - chip niesie kolor
            i ikonę działu oraz zawęża strumień po kliknięciu. */}
        {source !== null ? (
          <ClubSourceChip
            source={source}
            active={source.id !== null && source.id === activeGroupId}
            onSelect={onSourceSelect}
          />
        ) : null}
        <ClubTopicChip
          topic={thread.topic}
          lang={lang}
          catalog={topicsCatalog}
          size="sm"
          active={thread.topic !== "" && thread.topic === activeTopic}
          onSelect={onTopicSelect}
        />
        {hasText(thread.anchor_label) ? (
          <span className="max-w-[14rem] truncate" title={thread.anchor_label}>
            {thread.anchor_label}
          </span>
        ) : null}
      </ClubFeedContext>

      <ClubFeedActor
        avatar={
          <ClubAuthorAvatar
            name={author.name}
            avatarUrl={author.avatarUrl}
            size="lg"
            muted={author.kind !== "named"}
          />
        }
        name={
          <ClubAuthorIdentity
            author={author}
            nameClassName="truncate text-sm font-semibold leading-5 text-foreground"
          />
        }
        headline={jobTitle ?? undefined}
        meta={<ClubFeedTime iso={stamp} lang={lang} />}
      />

      <div className={cn("pt-2.5", CLUB_FEED_PAD)}>
        <h3 className={TITLE}>
          <Link
            to="/club/$clubSlug/t/$threadSlug"
            params={{ clubSlug, threadSlug: thread.slug }}
            className="rounded-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="[overflow-wrap:anywhere]">{thread.title}</span>
          </Link>
        </h3>
        {excerpt !== null ? (
          <div className="mt-1.5">
            <ClubFeedText className={BODY}>
              <p className="whitespace-pre-line [overflow-wrap:anywhere]">
                {excerpt.text}
                {/* Zajawka ucięta przez bazę prowadzi do całości - po
                    rozwinięciu „…więcej" czytelnik nie trafia na urwane zdanie. */}
                {excerpt.clipped ? (
                  <>
                    {" "}
                    <Link
                      to="/club/$clubSlug/t/$threadSlug"
                      params={{ clubSlug, threadSlug: thread.slug }}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                      data-testid="club-thread-read-more"
                    >
                      {t("club.hub.feed.readThread")}
                    </Link>
                  </>
                ) : null}
              </p>
            </ClubFeedText>
          </div>
        ) : null}
      </div>

      <ClubEngagementBar
        clubSlug={clubSlug}
        threadSlug={thread.slug}
        threadTitle={thread.title}
        tallies={reactions ?? []}
        actors={reactionActors}
        replyCount={thread.reply_count}
        participantCount={thread.participant_count}
        canReact={canReact}
        pending={reactionsPending}
        onToggle={
          onReact === undefined ? undefined : (kind, active) => onReact(thread.id, kind, active)
        }
      />
    </ClubFeedCard>
  );
}

function EventCard({
  event,
  clubSlug,
  index,
}: {
  event: ClubEventRow;
  clubSlug: string;
  index: number;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const kind = toEventKind(event.kind);
  const description = pickLocalized(event, "description", lang);

  return (
    <ClubFeedCard tone="event" index={index} testId="club-feed-event">
      <ClubFeedActor
        avatar={
          <ClubFeedKindAvatar tone="event">
            <ClubEventKindIcon kind={kind} />
          </ClubFeedKindAvatar>
        }
        name={
          <span className="text-sm font-semibold leading-5 text-foreground">
            {t("club.hub.feed.eventLabel")}
          </span>
        }
        meta={
          <>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
              {event.all_day
                ? formatDate(event.starts_at, lang, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : formatDateTime(event.starts_at, lang)}
            </span>
            {hasText(event.location) ? (
              <span className="inline-flex min-w-0 max-w-[16rem] items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{event.location}</span>
              </span>
            ) : null}
          </>
        }
      />
      <div className={cn("pt-2.5", CLUB_FEED_PAD)}>
        <h3 className={TITLE}>{pickLocalized(event, "title", lang)}</h3>
        {hasText(description) ? (
          <div className="mt-1.5">
            <ClubFeedText className={BODY}>
              <p className="whitespace-pre-line">{description}</p>
            </ClubFeedText>
          </div>
        ) : null}
      </div>
      <ClubFeedActionBar label={t("club.hub.feed.actionsLabel")}>
        <Link to="/club/$clubSlug/calendar" params={{ clubSlug }} className={clubFeedActionClass()}>
          <CalendarDays className={CLUB_FEED_ACTION_ICON} aria-hidden="true" />
          <span className="max-w-full truncate">{t("club.hub.feed.toCalendar")}</span>
        </Link>
      </ClubFeedActionBar>
    </ClubFeedCard>
  );
}

function DocumentsCard({
  documents,
  single,
  index,
}: {
  documents: readonly ClubDocumentRow[];
  single: boolean;
  index: number;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const first = documents[0];
  const summary = first === undefined ? null : pickLocalized(first, "summary", lang);

  return (
    <ClubFeedCard tone="document" index={index} testId="club-feed-documents">
      <ClubFeedActor
        avatar={
          <ClubFeedKindAvatar tone="document">
            <ClubDocumentKindIcon kind={toDocumentKind(first?.kind ?? "other")} />
          </ClubFeedKindAvatar>
        }
        name={
          <span className="text-sm font-semibold leading-5 text-foreground">
            {single ? t("club.hub.feed.documentLabel") : t("club.hub.feed.documentsLabel")}
          </span>
        }
        meta={
          documents.length > 1 ? (
            <span>{t("club.hub.feed.documentsCount", { count: documents.length })}</span>
          ) : undefined
        }
      />
      {single && hasText(summary) ? (
        <div className={cn("pt-2.5", CLUB_FEED_PAD)}>
          <ClubFeedText className={BODY}>
            <p className="whitespace-pre-line">{summary}</p>
          </ClubFeedText>
        </div>
      ) : null}
      {/* Paczka zostaje listą: jeden wiersz na plik, akcja po prawej. */}
      <ul className={cn("flex flex-col gap-2 pb-3.5 pt-3 sm:pb-4", CLUB_FEED_PAD)}>
        {documents.map((document) => {
          const href = documentHref(document);
          const isFile = hasText(document.file_url);
          return (
            <li
              key={document.id}
              className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/30 p-2.5 transition-colors hover:border-primary/40"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border/70 bg-card text-muted-foreground">
                <ClubDocumentKindIcon kind={toDocumentKind(document.kind)} className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <ClubInlineTitle tone="document" size="sm">
                  {pickLocalized(document, "title", lang)}
                </ClubInlineTitle>
              </span>
              {href !== null ? (
                <Button asChild size="sm" variant="ghost" className="h-8 shrink-0 rounded-lg px-2">
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
    </ClubFeedCard>
  );
}

function MilestoneCard({
  milestone,
  clubSlug,
  index,
}: {
  milestone: ClubMilestoneRow;
  clubSlug: string;
  index: number;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const state = toMilestoneState(milestone.state);
  const description = pickLocalized(milestone, "description", lang);

  return (
    <ClubFeedCard tone="milestone" index={index} testId="club-feed-milestone">
      <ClubFeedActor
        avatar={
          <ClubFeedKindAvatar tone="milestone">
            <ListChecks aria-hidden="true" />
          </ClubFeedKindAvatar>
        }
        name={
          <>
            <span className="text-sm font-semibold leading-5 text-foreground">
              {t("club.hub.feed.stageLabel")}
            </span>
            <ClubMilestoneStateChip state={state} />
          </>
        }
        meta={
          milestone.due_on !== null ? (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t("club.hub.stage.due", {
                date: formatDate(milestone.due_on, lang, { day: "numeric", month: "short" }),
              })}
            </span>
          ) : undefined
        }
      />
      <div className={cn("pt-2.5", CLUB_FEED_PAD)}>
        <h3 className={TITLE}>{pickLocalized(milestone, "title", lang)}</h3>
        {hasText(description) ? (
          <div className="mt-1.5">
            <ClubFeedText className={BODY}>
              <p className="whitespace-pre-line">{description}</p>
            </ClubFeedText>
          </div>
        ) : null}
      </div>
      <ClubFeedActionBar label={t("club.hub.feed.actionsLabel")}>
        <Link to="/club/$clubSlug/schedule" params={{ clubSlug }} className={clubFeedActionClass()}>
          <ArrowRight className={CLUB_FEED_ACTION_ICON} aria-hidden="true" />
          <span className="max-w-full truncate">{t("club.hub.feed.toSchedule")}</span>
        </Link>
      </ClubFeedActionBar>
    </ClubFeedCard>
  );
}

export function ClubFeedItem({
  entry,
  clubSlug,
  index = 0,
  mediaUrls = {},
  sourceIndex = EMPTY_SOURCES,
  activeGroupId = null,
  onSourceSelect,
  topicsCatalog = EMPTY_TOPICS,
  activeTopic = null,
  onTopicSelect,
  onPostLike,
  onPostDelete,
  threadReactions,
  threadReactionActors,
  reactionsPending,
  canReact = true,
  onThreadReact,
}: {
  entry: ClubFeedEntry;
  clubSlug: string;
  /** Pozycja w strumieniu - kaskada wejścia kart. */
  index?: number;
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
  /** Reakcje CAŁEJ widocznej partii wątków - jedno zapytanie nad listą. */
  threadReactions?: ReadonlyMap<string, ClubReactionTally[]>;
  /** Twarze reakcji CAŁEJ partii wątków - jedno zapytanie nad listą. */
  threadReactionActors?: ReadonlyMap<string, ClubReactionActor[]>;
  reactionsPending?: boolean;
  canReact?: boolean;
  onThreadReact?: (threadId: string, kind: ClubReactionKind, active: boolean) => void;
}) {
  if (entry.kind === "thread") {
    return (
      <ThreadCard
        thread={entry.thread}
        clubSlug={clubSlug}
        index={index}
        sourceIndex={sourceIndex}
        activeGroupId={activeGroupId}
        onSourceSelect={onSourceSelect}
        topicsCatalog={topicsCatalog}
        activeTopic={activeTopic}
        onTopicSelect={onTopicSelect}
        reactions={threadReactions?.get(entry.thread.id) ?? []}
        reactionActors={threadReactionActors?.get(entry.thread.id)}
        reactionsPending={reactionsPending}
        canReact={canReact}
        onReact={onThreadReact}
      />
    );
  }
  if (entry.kind === "post") {
    return (
      <ClubPostCard
        post={entry.post}
        clubSlug={clubSlug}
        index={index}
        mediaUrls={mediaUrls}
        sourceIndex={sourceIndex}
        activeGroupId={activeGroupId}
        onSourceSelect={onSourceSelect}
        onLike={onPostLike}
        onDelete={onPostDelete}
        canComment={canReact}
      />
    );
  }
  if (entry.kind === "event") {
    return <EventCard event={entry.event} clubSlug={clubSlug} index={index} />;
  }
  if (entry.kind === "milestone") {
    return <MilestoneCard milestone={entry.milestone} clubSlug={clubSlug} index={index} />;
  }
  return (
    <DocumentsCard
      documents={entry.documents}
      single={entry.documents.length === 1}
      index={index}
    />
  );
}
