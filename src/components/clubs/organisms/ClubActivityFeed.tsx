// Strumień aktywności ponad klubami - moduł "co się dzieje" na stronie
// głównej klubów.
//
// Każdy wiersz mówi Z KTÓREGO klubu pochodzi, bo to jest cała różnica między
// tym modułem a listą tematów jednego klubu: czytelnik nie wie z góry, gdzie
// patrzy. Nazwa klubu jest więc pierwszą, nie ostatnią informacją w wierszu.
//
// Autor wychodzi z RPC już rozstrzygnięty - albo nazwisko, albo pseudonim,
// nigdy identyfikator. Ten komponent nie ma czego zdecydować i nie próbuje.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Clock, Flame, MessageSquare, Sparkles, Users2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  CLUB_ACTIVITY_SORTS,
  toAuthorLabel,
  type ClubActivityRow,
  type ClubActivitySort,
} from "@/lib/clubs/types";
import { formatDateShort } from "@/lib/i18n/format";

export function ClubActivityFeed({
  rows,
  sort,
  onSortChange,
  pending,
  isPl,
}: {
  rows: readonly ClubActivityRow[];
  sort: ClubActivitySort;
  onSortChange: (sort: ClubActivitySort) => void;
  pending: boolean;
  isPl: boolean;
}) {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="club-activity-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="club-activity-heading" className="text-lg font-semibold">
          {t("club.hub.activityTitle")}
        </h2>
        <div
          role="group"
          aria-label={t("club.sort.label")}
          className="inline-flex rounded-lg border border-border/60 p-0.5"
        >
          {CLUB_ACTIVITY_SORTS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={sort === option}
              onClick={() => onSortChange(option)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors",
                sort === option
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option === "hot" ? (
                <Flame className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {t(`club.sort.${option}`)}
            </button>
          ))}
        </div>
      </div>

      {pending ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t("club.hub.activityEmpty")}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.thread_id}>
              <ClubActivityItem row={row} isPl={isPl} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ClubActivityItem({ row, isPl }: { row: ClubActivityRow; isPl: boolean }) {
  const { t } = useTranslation();
  // `club.anonymousAuthor` to WZORZEC z placeholderem ("Uczestnik {{alias}}"),
  // wiec renderowany wprost pokazywal na ekranie surowa interpolacje. Wspolna
  // funkcja podstawia alias i obsluguje konto usuniete.
  const author = toAuthorLabel(
    {
      author_id: null,
      author_name: row.author_name,
      author_avatar: null,
      author_slug: null,
      author_alias: row.author_alias,
    },
    t("club.anonymousAuthor"),
    t("club.deletedAuthor"),
  ).name;
  const when = new Date(row.last_reply_at ?? row.created_at);

  return (
    <Link
      to="/club/$clubSlug/t/$threadSlug"
      params={{ clubSlug: row.club_slug, threadSlug: row.thread_slug }}
      className="block rounded-lg border border-border/60 bg-card p-4 transition-colors hover:border-primary/40"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-primary">
          {isPl ? row.club_name_pl : row.club_name_en}
        </span>
        <span aria-hidden="true" className="text-xs text-muted-foreground">
          ·
        </span>
        <span className="text-xs text-muted-foreground">
          {isPl ? row.group_name_pl : row.group_name_en}
        </span>
        <Badge variant="outline" className="text-[11px]">
          {t(`club.kind.${row.kind}`)}
        </Badge>
      </div>

      <h3 className="mt-1.5 font-medium leading-snug">{row.title}</h3>
      {row.excerpt !== null && row.excerpt.trim() !== "" ? (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{row.excerpt}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{author}</span>
        <span className="inline-flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />
          {row.reply_count}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users2 className="h-3.5 w-3.5" />
          {row.participant_count}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          <time dateTime={when.toISOString()}>{formatDateShort(when, isPl ? "pl" : "en")}</time>
        </span>
      </div>
    </Link>
  );
}
