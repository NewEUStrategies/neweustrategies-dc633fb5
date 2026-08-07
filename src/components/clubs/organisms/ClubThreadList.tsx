// Lista tematów klubu w trzech układach.
//
// Układ nie jest kosmetyką: `magazine` wyróżnia jeden wątek, więc zmienia to,
// co czytelnik zobaczy PIERWSZE. Dlatego wybór siedzi w bazie (kolumna
// `clubs.layout`), a nie w preferencji przeglądarki - to decyzja redakcyjna
// klubu, nie ustawienie widza.
//
// Wspólny wiersz metadanych jest JEDEN (`ThreadMeta`): trzy kopie tej samej
// listy odznak rozjechałyby się przy pierwszej zmianie słownika rodzajów.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Clock, Lock, MessageSquare, Pin, Users2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toAuthorLabel, type ClubLayout, type ClubThreadListRow } from "@/lib/clubs/types";
import { formatDateShort } from "@/lib/i18n/format";

function ThreadBadges({ thread, isPl }: { thread: ClubThreadListRow; isPl: boolean }) {
  const { t } = useTranslation();
  return (
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
        <Badge variant="outline" className="text-[11px] text-amber-700 dark:text-amber-300">
          {t("club.threadStatus.pending")}
        </Badge>
      ) : null}
      <span className="text-xs text-muted-foreground">
        {isPl ? thread.group_name_pl : thread.group_name_en}
      </span>
    </div>
  );
}

function ThreadMeta({ thread, isPl }: { thread: ClubThreadListRow; isPl: boolean }) {
  const { t } = useTranslation();
  const author = toAuthorLabel(thread, t("club.anonymousAuthor"), t("club.deletedAuthor"));
  return (
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
        {formatDateShort(thread.last_reply_at ?? thread.created_at, isPl ? "pl" : "en")}
      </span>
    </div>
  );
}

function ThreadLink({
  clubSlug,
  thread,
  className,
  children,
}: {
  clubSlug: string;
  thread: ClubThreadListRow;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to="/club/$clubSlug/t/$threadSlug"
      params={{ clubSlug, threadSlug: thread.slug }}
      className={cn(
        "block rounded-lg border border-border/60 bg-card transition-colors hover:border-primary/40",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function ClubThreadList({
  clubSlug,
  threads,
  layout,
  isPl,
}: {
  clubSlug: string;
  threads: readonly ClubThreadListRow[];
  layout: ClubLayout;
  isPl: boolean;
}) {
  // Magazyn wyróżnia PIERWSZY wątek listy - a lista przychodzi już posortowana
  // przez RPC z przypiętymi na górze, więc wyróżniony jest ten, który redakcja
  // przypięła. Bez przypięcia wyróżnia się po prostu najgorętszy.
  const [featured, ...rest] = layout === "magazine" ? threads : [];

  if (layout === "cards") {
    return (
      <ul className="grid gap-3 sm:grid-cols-2">
        {threads.map((thread) => (
          <li key={thread.id}>
            <ThreadLink clubSlug={clubSlug} thread={thread} className="flex h-full flex-col p-4">
              <ThreadBadges thread={thread} isPl={isPl} />
              <h3 className="mt-1.5 font-medium leading-snug">{thread.title}</h3>
              {/* Fragment treści jest tym, co odróżnia karty od listy - bez
                  niego siatka jest tylko listą w dwóch kolumnach. */}
              <p className="mt-1.5 line-clamp-3 flex-1 text-sm text-muted-foreground">
                {thread.excerpt ?? ""}
              </p>
              <ThreadMeta thread={thread} isPl={isPl} />
            </ThreadLink>
          </li>
        ))}
      </ul>
    );
  }

  if (layout === "magazine" && featured !== undefined) {
    return (
      <div className="space-y-3">
        <ThreadLink
          clubSlug={clubSlug}
          thread={featured}
          className="border-primary/30 bg-primary/[0.03] p-5"
        >
          <ThreadBadges thread={featured} isPl={isPl} />
          <h3 className="mt-2 text-xl font-semibold leading-snug">{featured.title}</h3>
          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
            {featured.excerpt ?? ""}
          </p>
          <ThreadMeta thread={featured} isPl={isPl} />
        </ThreadLink>

        <ul className="space-y-2">
          {rest.map((thread) => (
            <li key={thread.id}>
              <ThreadLink clubSlug={clubSlug} thread={thread} className="p-4">
                <ThreadBadges thread={thread} isPl={isPl} />
                <h3 className="mt-1.5 font-medium leading-snug">{thread.title}</h3>
                <ThreadMeta thread={thread} isPl={isPl} />
              </ThreadLink>
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
          <ThreadLink clubSlug={clubSlug} thread={thread} className="p-4">
            <ThreadBadges thread={thread} isPl={isPl} />
            <h3 className="mt-1.5 font-medium leading-snug">{thread.title}</h3>
            <ThreadMeta thread={thread} isPl={isPl} />
          </ThreadLink>
        </li>
      ))}
    </ul>
  );
}
