// Lista tematów klubu w układzie DOSSIER (rejestr redakcyjny).
//
// Wszystkie trzy układy (`list`, `cards`, `magazine`) rysują ten sam wiersz
// `ClubDossierRow` - różnią się WYŁĄCZNIE tym, jak wiersze są rozłożone:
// `cards` układa je w siatkę, `magazine` wyróżnia pierwszy. Dzięki temu wybór
// układu pozostaje decyzją redakcyjną klubu (kolumna `clubs.layout`), a nie
// decyzją o tym, jak wygląda pojedyncza pozycja - ta jest jedna w całym
// module i identyczna ze strumieniem huba.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Lightbulb, Link2, Lock, MessageSquare, Pin, Users2 } from "lucide-react";
import { ClubThreadKindIcon } from "@/components/clubs/atoms/ClubThreadKindIcon";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ClubDossierKind,
  ClubDossierMetrics,
  ClubDossierRow,
  clubThreadTone,
} from "@/components/clubs/atoms/ClubDossierRow";
import { toAuthorLabel, type ClubLayout, type ClubThreadListRow } from "@/lib/clubs/types";
import { formatDateShort, uiLang } from "@/lib/i18n/format";
import { ClubThreadHeat } from "@/components/clubs/atoms/ClubThreadHeat";
import { normalizeClubThreadIcon } from "@/lib/clubs/threadIcons";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

/** Pasek meta wiersza: rodzaj, statusy, kotwica, dział, autor, data. */
function ThreadMeta({ thread }: { thread: ClubThreadListRow }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const author = toAuthorLabel(thread, t("club.anonymousAuthor"), t("club.deletedAuthor"));
  return (
    <>
      <ClubDossierKind className="text-[10px]">{t(`club.kind.${thread.kind}`)}</ClubDossierKind>
      {thread.status === "locked" ? (
        <Lock
          className="h-3 w-3 text-muted-foreground"
          aria-label={t("club.threadStatus.locked")}
        />
      ) : null}
      {thread.status === "resolved" ? (
        <Badge className="rounded-lg bg-emerald-600 px-1.5 py-0 text-[10px] hover:bg-emerald-600">
          {t("club.threadStatus.resolved")}
        </Badge>
      ) : null}
      {thread.status === "pending" ? (
        <Badge variant="outline" className="rounded-lg px-1.5 py-0 text-[10px]">
          {t("club.threadStatus.pending")}
        </Badge>
      ) : null}
      {/* Kotwica z NAZWĄ, nie sama ikona: „zakotwiczony" bez wskazania w czym
          nie zmienia decyzji o kliknięciu. Etykieta przychodzi z RPC. */}
      {thread.anchor_label !== null && thread.anchor_label !== "" ? (
        <span
          className="inline-flex max-w-[14rem] items-center gap-1 truncate"
          title={thread.anchor_label}
        >
          <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{thread.anchor_label}</span>
        </span>
      ) : null}
      <span className="truncate">{pickLocalized(thread, "group_name", lang)}</span>
      <span aria-hidden="true">·</span>
      <span className="max-w-[14rem] truncate font-medium text-foreground">{author.name}</span>
      <span aria-hidden="true">·</span>
      <time dateTime={thread.last_reply_at ?? thread.created_at}>
        {formatDateShort(thread.last_reply_at ?? thread.created_at, lang)}
      </time>
      {thread.pinned_at !== null ? (
        <Pin className="h-3 w-3 text-primary" aria-label={t("club.pinnedThread")} />
      ) : null}
    </>
  );
}

/** Prawa kolumna wiersza - te same trzy liczby w tej samej kolejności. */
function ThreadMetrics({ thread }: { thread: ClubThreadListRow }) {
  const { t } = useTranslation();
  return (
    <ClubDossierMetrics
      metrics={[
        {
          key: "replies",
          icon: <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />,
          value: thread.reply_count,
          label: t("club.repliesCount", { count: thread.reply_count }),
        },
        {
          key: "participants",
          icon: <Users2 className="h-3.5 w-3.5" aria-hidden="true" />,
          value: thread.participant_count,
          label: t("club.hub.feed.participantsCount", { count: thread.participant_count }),
        },
        // `insightful`, a NIE suma reakcji - jakość waży więcej niż objętość
        // (ta sama zasada, co w rankingu hotness §5.3).
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
  );
}

function ThreadRow({
  clubSlug,
  thread,
  featured = false,
}: {
  clubSlug: string;
  thread: ClubThreadListRow;
  /** Wyróżniony wiersz układu `magazine`: większy tytuł, mocniejsza krawędź. */
  featured?: boolean;
}) {
  const icon = normalizeClubThreadIcon(thread.icon);
  return (
    <ClubDossierRow
      testId="club-thread-row"
      tone={clubThreadTone(thread.kind)}
      unread={thread.is_unread}
      pinned={thread.pinned_at !== null}
      titleStyle="headline"
      className={cn("h-full", featured && "border-primary/40 bg-primary/[0.04]")}
      icon={<ClubThreadKindIcon kind={thread.kind} icon={icon} />}
      meta={<ThreadMeta thread={thread} />}
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
      metrics={<ThreadMetrics thread={thread} />}
    />
  );
}

export function ClubThreadList({
  clubSlug,
  threads,
  layout,
}: {
  clubSlug: string;
  threads: readonly ClubThreadListRow[];
  layout: ClubLayout;
}) {
  // Magazyn wyróżnia PIERWSZY wątek listy - a lista przychodzi już posortowana
  // przez RPC z przypiętymi na górze, więc wyróżniony jest ten, który redakcja
  // przypięła. Bez przypięcia wyróżnia się po prostu najgorętszy.
  const [featured, ...rest] = layout === "magazine" ? threads : [];

  if (layout === "cards") {
    return (
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {threads.map((thread) => (
          <li key={thread.id} className="h-full">
            <ThreadRow clubSlug={clubSlug} thread={thread} />
          </li>
        ))}
      </ul>
    );
  }

  if (layout === "magazine" && featured !== undefined) {
    return (
      <div className="space-y-2">
        <ThreadRow clubSlug={clubSlug} thread={featured} featured />
        <ul className="space-y-2">
          {rest.map((thread) => (
            <li key={thread.id}>
              <ThreadRow clubSlug={clubSlug} thread={thread} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {threads.map((thread) => (
        <li key={thread.id}>
          <ThreadRow clubSlug={clubSlug} thread={thread} />
        </li>
      ))}
    </ul>
  );
}
