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
import { ClubThreadKindIcon } from "@/components/clubs/atoms/ClubThreadKindIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import {
  ClubDossierKind,
  ClubDossierMetrics,
  ClubDossierRow,
  clubThreadTone,
} from "@/components/clubs/atoms/ClubDossierRow";
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
  toAuthorLabel,
  type ClubReactionActor,
  type ClubReactionKind,
  type ClubReactionTally,
  type ClubThreadListRow,
} from "@/lib/clubs/types";
import { ClubEngagementBar } from "@/components/clubs/molecules/ClubEngagementBar";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
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
import type { ClubFeedEntry } from "@/lib/clubs/clubFeed";
import { clubSourceOf, type ClubSourceMark } from "@/lib/clubs/threadSources";
import type { ClubTopicOption } from "@/lib/clubs/topicCatalog";
import { formatDate, formatDateShort, formatDateTime, uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

/** Stała pusta mapa - literał w domyślnej wartości propa tworzyłby NOWĄ mapę
 *  przy każdym renderze i psuł memoizację kart. */
const EMPTY_SOURCES: ReadonlyMap<string, ClubSourceMark> = new Map();
/** Stała pusta lista - ten sam powód, co `EMPTY_SOURCES`. */
const EMPTY_TOPICS: readonly ClubTopicOption[] = [];

function ThreadCard({
  thread,
  clubSlug,
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
  const stamp = thread.last_reply_at ?? thread.created_at;
  const source = clubSourceOf(thread, sourceIndex, lang);
  // Normalizacja przy ODCZYCIE: wiersze sprzed katalogu ikon mogą nieść nazwę
  // spoza zestawu kurowanego, a taka dociągałaby pełny rejestr lucide do
  // chunku strumienia - degradujemy ją do braku ikony.
  const threadIcon = normalizeClubThreadIcon(thread.icon);

  return (
    <ClubDossierRow
      testId="club-feed-thread"
      tone={clubThreadTone(thread.kind)}
      unread={thread.is_unread}
      pinned={thread.pinned_at !== null}
      titleStyle="headline"
      icon={<ClubThreadKindIcon kind={thread.kind} icon={threadIcon} />}
      meta={
        <>
          <ClubDossierKind className="text-[10px]">{t(`club.kind.${thread.kind}`)}</ClubDossierKind>
          {thread.status === "resolved" ? (
            <Badge className="rounded-lg bg-emerald-600 px-1.5 py-0 text-[10px] hover:bg-emerald-600">
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
          {thread.anchor_label !== null && thread.anchor_label.trim() !== "" ? (
            <span className="max-w-[12rem] truncate" title={thread.anchor_label}>
              {thread.anchor_label}
            </span>
          ) : null}
          <span aria-hidden="true">·</span>
          <ClubAuthorAvatar
            name={author.name}
            avatarUrl={thread.author_avatar}
            size="sm"
            muted={author.kind !== "named"}
          />
          <span className="truncate font-medium text-foreground">{author.name}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={stamp}>{formatDateShort(stamp, lang)}</time>
          {thread.pinned_at !== null ? (
            <span className="inline-flex items-center gap-1 text-primary">
              <Pin className="h-3 w-3" aria-hidden="true" />
              {t("club.hub.feed.pinned")}
            </span>
          ) : null}
        </>
      }
      title={
        <h3>
          <Link
            to="/club/$clubSlug/t/$threadSlug"
            params={{ clubSlug, threadSlug: thread.slug }}
            className="group/title inline-block max-w-full focus:outline-none"
          >
            <span className="[overflow-wrap:anywhere]">{thread.title}</span>
          </Link>
        </h3>
      }
      excerpt={thread.excerpt !== null && thread.excerpt.trim() !== "" ? thread.excerpt : undefined}
      metrics={
        <ClubDossierMetrics
          metrics={[
            {
              key: "replies",
              icon: <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />,
              value: thread.reply_count,
              label: t("club.repliesCount", { count: thread.reply_count }),
            },
            {
              key: "participants",
              icon: <Users className="h-3.5 w-3.5" aria-hidden="true" />,
              value: thread.participant_count,
              label: t("club.hub.feed.participantsCount", { count: thread.participant_count }),
            },
            ...(thread.insightful_count > 0
              ? [
                  {
                    key: "insightful",
                    icon: <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />,
                    value: thread.insightful_count,
                    label: t("club.reaction.insightful"),
                  },
                ]
              : []),
          ]}
          trailing={<ClubThreadHeat thread={thread} />}
        />
      }
      footer={
        <ClubEngagementBar
          clubSlug={clubSlug}
          threadSlug={thread.slug}
          tallies={reactions ?? []}
          actors={reactionActors}
          replyCount={thread.reply_count}
          canReact={canReact}
          pending={reactionsPending}
          onToggle={
            onReact === undefined ? undefined : (kind, active) => onReact(thread.id, kind, active)
          }
        />
      }
    />
  );
}

function EventCard({ event }: { event: ClubEventRow }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const kind = toEventKind(event.kind);
  const description = pickLocalized(event, "description", lang);

  return (
    <ClubDossierRow
      testId="club-feed-event"
      tone="event"
      icon={<ClubEventKindIcon kind={kind} className="h-3.5 w-3.5" />}
      meta={
        <>
          <ClubDossierKind>{t("club.hub.feed.eventLabel")}</ClubDossierKind>
          <span aria-hidden="true">·</span>
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
          {event.location !== null && event.location.trim() !== "" ? (
            <span className="inline-flex max-w-[14rem] items-center gap-1 truncate">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              {event.location}
            </span>
          ) : null}
        </>
      }
      title={
        <h3>
          <ClubInlineTitle tone="event" size="sm">
            {pickLocalized(event, "title", lang)}
          </ClubInlineTitle>
        </h3>
      }
      excerpt={description !== null && description.trim() !== "" ? description : undefined}
    />
  );
}

function DocumentsCard({
  documents,
  single,
}: {
  documents: readonly ClubDocumentRow[];
  single: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const first = documents[0];
  const summary = first === undefined ? null : pickLocalized(first, "summary", lang);

  return (
    <ClubDossierRow
      testId="club-feed-documents"
      tone="document"
      icon={
        <ClubDocumentKindIcon
          kind={toDocumentKind(first?.kind ?? "other")}
          className="h-3.5 w-3.5"
        />
      }
      meta={
        <ClubDossierKind>
          {single ? t("club.hub.feed.documentLabel") : t("club.hub.feed.documentsLabel")}
        </ClubDossierKind>
      }
      title={
        // Lista dokumentów zostaje listą także w układzie dossier: pojedynczy
        // wiersz na plik, akcja pobrania po prawej stronie tego wiersza.
        <ul className="flex flex-col gap-1.5">
          {documents.map((document) => {
            const href = documentHref(document);
            const isFile = document.file_url !== null && document.file_url.trim() !== "";
            return (
              <li key={document.id} className="flex items-center gap-2">
                <ClubDocumentKindIcon
                  kind={toDocumentKind(document.kind)}
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1">
                  <ClubInlineTitle tone="document" size="sm">
                    {pickLocalized(document, "title", lang)}
                  </ClubInlineTitle>
                </span>
                {href !== null ? (
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 rounded-lg px-2"
                  >
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
      }
      excerpt={single && summary !== null && summary.trim() !== "" ? summary : undefined}
    />
  );
}

function MilestoneCard({ milestone, clubSlug }: { milestone: ClubMilestoneRow; clubSlug: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const state = toMilestoneState(milestone.state);
  const description = pickLocalized(milestone, "description", lang);

  return (
    <ClubDossierRow
      testId="club-feed-milestone"
      tone="milestone"
      icon={<ListChecks className="h-3.5 w-3.5" aria-hidden="true" />}
      meta={
        <>
          <ClubDossierKind>{t("club.hub.feed.stageLabel")}</ClubDossierKind>
          <ClubMilestoneStateChip state={state} />
          {milestone.due_on !== null ? (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t("club.hub.stage.due", {
                date: formatDate(milestone.due_on, lang, { day: "numeric", month: "short" }),
              })}
            </span>
          ) : null}
        </>
      }
      title={
        <h3>
          <ClubInlineTitle tone="milestone" size="sm">
            {pickLocalized(milestone, "title", lang)}
          </ClubInlineTitle>
        </h3>
      }
      excerpt={description !== null && description.trim() !== "" ? description : undefined}
      footer={
        <Button asChild size="sm" variant="ghost" className="h-7 rounded-lg px-2">
          <Link to="/club/$clubSlug/schedule" params={{ clubSlug }}>
            {t("club.hub.feed.toSchedule")}
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Button>
      }
    />
  );
}

export function ClubFeedItem({
  entry,
  clubSlug,
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
    return <EventCard event={entry.event} />;
  }
  if (entry.kind === "milestone") {
    return <MilestoneCard milestone={entry.milestone} clubSlug={clubSlug} />;
  }
  return <DocumentsCard documents={entry.documents} single={entry.documents.length === 1} />;
}
