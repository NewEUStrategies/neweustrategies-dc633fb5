// Molekuła: liczniki i akcje pod kartą wątku w strumieniu.
//
// DWA PASY, NIE JEDEN. Wyżej - co już się wydarzyło: kolorowe glify
// najczęstszych reakcji, kto zareagował („Anna Nowak i 3 inne osoby") i ile
// jest odpowiedzi. Niżej - co mogę zrobić: zareagować, skomentować,
// udostępnić, w równych kolumnach. Pomieszanie obu w jednym rzędzie (jak
// wcześniej: przyciski reakcji z licznikami obok linku komentarza) kazało
// czytać każdą kartę, żeby odróżnić informację od akcji.
//
// KOMENTARZ ZOSTAJE W STRUMIENIU. „Komentuj" jest PRZEŁĄCZNIKIEM sekcji
// rozmowy pod kartą (`aria-expanded`/`aria-controls`): dwie najnowsze
// odpowiedzi i kompozytor odpowiedzi - bez zmiany ekranu. Licznik odpowiedzi
// w pasie wyżej rozwija tę samą sekcję. Pełna rozmowa jest o jedno kliknięcie
// dalej („Zobacz całą dyskusję"). Gdy karta nie ma sekcji (powierzchnia bez
// danych klubu), akcja degraduje się do linku do kompozytora wątku
// (`?reply`) - nigdy do martwego przycisku. Brak prawa głosu zdejmuje
// reakcję, ale nie komentarz ani udostępnienie: czytanie jest szersze niż głos.
//
// CHATHAM HOUSE. W trybie poufnym baza nie oddaje nazwisk, więc licznik mówi
// samą liczbą - interfejs nie sugeruje tożsamości, której klub nie ujawnia.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MessageSquareText } from "lucide-react";
import { ClubReactionGlyph } from "@/components/clubs/atoms/ClubReactionGlyph";
import {
  CLUB_FEED_ACTION_ICON,
  CLUB_FEED_ACTION_LABEL,
  ClubFeedActionBar,
  ClubFeedSocialRow,
  clubFeedActionClass,
} from "@/components/clubs/molecules/ClubFeedCard";
import { ClubFeedReactAction } from "@/components/clubs/molecules/ClubFeedReactAction";
import { ClubFeedShareAction } from "@/components/clubs/molecules/ClubFeedShareAction";
import type { ClubReactionActor, ClubReactionKind, ClubReactionTally } from "@/lib/clubs/types";
import { countDistinctReactors } from "@/lib/clubs/reactionSummary";

export interface ClubEngagementBarProps {
  clubSlug: string;
  /** Slug wątku, do którego prowadzi komentowanie. */
  threadSlug: string;
  /** Tytuł wątku - nazwa udostępnianego adresu. */
  threadTitle?: string;
  tallies: readonly ClubReactionTally[];
  /** Kto zareagował - nazwiska w liczniku i w dymku. */
  actors?: readonly ClubReactionActor[];
  replyCount: number;
  participantCount?: number;
  /** Brak uprawnienia do odpowiedzi wyłącza reakcje, ale NIE link do wątku:
   *  czytanie dyskusji jest szersze niż prawo do zabrania w niej głosu. */
  canReact?: boolean;
  pending?: boolean;
  onToggle?: (kind: ClubReactionKind, active: boolean) => void;
  /** Sekcja rozmowy w karcie. Bez niej „Komentuj" jest linkiem do wątku. */
  comments?: ClubEngagementComments;
}

/** Sterowanie sekcją rozmowy pod kartą - stan należy do karty. */
export interface ClubEngagementComments {
  /** Identyfikator sekcji (`aria-controls`). */
  id: string;
  open: boolean;
  /** „Komentuj": rozwija z fokusem w polu albo zwija. */
  onToggle: () => void;
  /** Licznik odpowiedzi: zawsze ROZWIJA (drugie kliknięcie nie zwija). */
  onOpen: () => void;
}

/** Licznik w pasie rozmowy - link do wątku albo przełącznik sekcji w karcie. */
const COUNTER =
  "rounded-sm transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Najczęstsze reakcje - najwyżej trzy glify, jak w liczniku pod wpisem. */
function topKinds(tallies: readonly ClubReactionTally[]): ClubReactionKind[] {
  return tallies
    .filter((tally) => tally.total > 0)
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(0, 3)
    .map((tally) => tally.kind);
}

/**
 * Lewa strona pasa liczników: glify + „kto". Eksportowane, bo ten sam
 * licznik stoi pod wpisem ściany (tam z jednym rodzajem: docenienie).
 */
export function ClubReactionSummary({
  kinds,
  total,
  people,
  actors,
  mine,
}: {
  kinds: readonly ClubReactionKind[];
  /** Suma reakcji - może być większa niż liczba osób. */
  total: number;
  /** Liczba RÓŻNYCH osób albo `null`, gdy nie da się jej ustalić
   *  (patrz `countDistinctReactors`) - wtedy licznik mówi „i inni". */
  people: number | null;
  actors?: readonly ClubReactionActor[];
  /** Czy wśród reagujących jestem ja - gdy cel nie ma listy osób (wpis ściany). */
  mine?: boolean;
}) {
  const { t } = useTranslation();
  if (total <= 0 || kinds.length === 0) return null;

  const me = mine ?? actors?.some((actor) => actor.isMe) === true;
  const named = actors?.find((actor) => !actor.isMe && actor.userId !== null && actor.name) ?? null;
  const others = people === null ? null : people - 1;
  let text: string;
  if (me) {
    text =
      others === null
        ? t("club.hub.feed.reactors.youAndMore")
        : others > 0
          ? t("club.hub.feed.reactors.youAndOthers", { count: others })
          : t("club.reactionActors.you");
  } else if (named !== null && named.name !== null) {
    text =
      others === null
        ? t("club.hub.feed.reactors.nameAndMore", { name: named.name })
        : others > 0
          ? t("club.hub.feed.reactors.nameAndOthers", { name: named.name, count: others })
          : named.name;
  } else {
    // Bez nazwisk (tryb poufny) zostaje liczba - osób, gdy jest pewna,
    // inaczej reakcji (czytnik ekranu i tak słyszy, że to reakcje).
    text = String(people ?? total);
  }

  // Dymek z pełną listą: kto i jak - bez rozwijania osobnego panelu.
  const title = (actors ?? [])
    .filter((actor) => actor.userId !== null)
    .map((actor) => {
      const who = actor.isMe
        ? t("club.reactionActors.you")
        : (actor.name ?? t("club.reactionActors.anonymous"));
      return `${who} - ${actor.kinds.map((kind) => t(`club.reaction.${kind}`)).join(", ")}`;
    })
    .join("\n");

  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5"
      title={title !== "" ? title : undefined}
      data-testid="club-reaction-summary"
    >
      <span className="flex shrink-0 items-center -space-x-1">
        {kinds.map((kind, index) => (
          <ClubReactionGlyph
            key={kind}
            kind={kind}
            className="ring-2 ring-card"
            // Pierwszy glif na wierzchu, jak stos kart.
            style={{ zIndex: kinds.length - index }}
          />
        ))}
      </span>
      {/* Pełne zdanie - zawija się, a nie ucina na nazwisku. */}
      <span className="min-w-0 tabular-nums [overflow-wrap:anywhere]">{text}</span>
      <span className="sr-only">{t("club.hub.feed.reactionsTotal", { count: total })}</span>
    </span>
  );
}

export function ClubEngagementBar({
  clubSlug,
  threadSlug,
  threadTitle = "",
  tallies,
  actors,
  replyCount,
  participantCount = 0,
  canReact = true,
  pending = false,
  onToggle,
  comments,
}: ClubEngagementBarProps) {
  const { t } = useTranslation();
  const interactive = canReact && onToggle !== undefined;
  const total = tallies.reduce((sum, tally) => sum + tally.total, 0);
  const threadPath = `/club/${clubSlug}/t/${threadSlug}`;
  const commentLabel =
    replyCount > 0
      ? t("club.hub.feed.commentWithCount", { n: replyCount })
      : t("club.hub.feed.comment");

  const conversation =
    replyCount > 0 || participantCount > 0 ? (
      <>
        {replyCount > 0 ? (
          comments !== undefined ? (
            <button
              type="button"
              onClick={comments.onOpen}
              aria-expanded={comments.open}
              aria-controls={comments.id}
              className={COUNTER}
              data-testid="club-replies-count"
            >
              {t("club.repliesCount", { count: replyCount })}
            </button>
          ) : (
            <Link
              to="/club/$clubSlug/t/$threadSlug"
              params={{ clubSlug, threadSlug }}
              className={COUNTER}
            >
              {t("club.repliesCount", { count: replyCount })}
            </Link>
          )
        ) : null}
        {replyCount > 0 && participantCount > 0 ? <span aria-hidden="true">·</span> : null}
        {participantCount > 0 ? (
          <span>{t("club.hub.feed.participantsCount", { count: participantCount })}</span>
        ) : null}
      </>
    ) : null;

  return (
    <div data-testid="club-engagement-bar">
      <ClubFeedSocialRow
        left={
          total > 0 ? (
            <ClubReactionSummary
              kinds={topKinds(tallies)}
              total={total}
              people={countDistinctReactors(tallies, actors)}
              actors={actors}
              // „Ja" z liczników, nie z twarzy: liczniki zmieniają się
              // optymistycznie od razu, twarze dopiero po odświeżeniu.
              mine={tallies.some((tally) => tally.mine)}
            />
          ) : null
        }
        right={conversation}
      />
      <ClubFeedActionBar label={t("club.hub.feed.actionsLabel")}>
        {interactive ? (
          <ClubFeedReactAction tallies={tallies} disabled={pending} onToggle={onToggle} />
        ) : null}
        {comments !== undefined ? (
          <button
            type="button"
            onClick={comments.onToggle}
            aria-expanded={comments.open}
            aria-controls={comments.id}
            aria-label={commentLabel}
            className={clubFeedActionClass({
              className: comments.open ? "bg-secondary text-foreground" : undefined,
            })}
            data-testid="club-comment-toggle"
          >
            <MessageSquareText className={CLUB_FEED_ACTION_ICON} aria-hidden="true" />
            <span className={CLUB_FEED_ACTION_LABEL}>{t("club.hub.feed.comment")}</span>
          </button>
        ) : (
          <Link
            to="/club/$clubSlug/t/$threadSlug"
            params={{ clubSlug, threadSlug }}
            search={{ reply: true }}
            aria-label={commentLabel}
            className={clubFeedActionClass()}
            data-testid="club-comment-link"
          >
            <MessageSquareText className={CLUB_FEED_ACTION_ICON} aria-hidden="true" />
            <span className={CLUB_FEED_ACTION_LABEL}>{t("club.hub.feed.comment")}</span>
          </Link>
        )}
        <ClubFeedShareAction path={threadPath} title={threadTitle} />
      </ClubFeedActionBar>
    </div>
  );
}
