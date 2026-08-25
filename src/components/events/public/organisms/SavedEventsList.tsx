// Organizm: lista ZAPAMIĘTANYCH wydarzeń uczestnika.
//
// TO JEST DRUGA POŁOWA GWIAZDKI. Przełącznik na stronie wydarzenia bez miejsca,
// w którym widać wynik, jest przyciskiem donikąd - uczestnik zapamiętuje
// wydarzenie właśnie po to, żeby do niego wrócić.
//
// LISTA JEST PRYWATNA I MÓWI O TYM WPROST. `event_bookmarks_mine` czyta
// wyłącznie własne wiersze (`auth.uid()`), więc nikt inny tej listy nie
// zobaczy - i to jest zdanie, które musi paść na ekranie, bo „zapamiętane"
// bywa mylone z „polubione publicznie".
//
// ZAKRESY SĄ TRZY, BO PYTANIA SĄ TRZY. „Co mnie czeka", „gdzie byłem",
// „wszystko". Każdy ma własny komunikat pustki - jedno „brak wyników" nie
// mówiłoby, czy filtr jest zły, czy naprawdę nic nie ma.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarDays, MapPin, Star } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { eventTimeZoneLabel, formatEventDateTime } from "@/lib/events/timezone";
import { BOOKMARK_SCOPES, type BookmarkScope } from "@/lib/events/publicEventApi";
import { useMyBookmarks } from "@/lib/events/usePublicEvent";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

const PAGE_SIZE = 24;

const EMPTY_KEY: Record<BookmarkScope, string> = {
  upcoming: "eventFront.bookmarks.emptyUpcoming",
  past: "eventFront.bookmarks.emptyPast",
  all: "eventFront.bookmarks.empty",
};

export function SavedEventsList() {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [scope, setScope] = useState<BookmarkScope>("upcoming");
  const [offset, setOffset] = useState(0);

  const bookmarks = useMyBookmarks(scope, PAGE_SIZE, offset);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("eventFront.bookmarks.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("eventFront.bookmarks.subtitle")}</p>
      </header>

      <div
        role="tablist"
        aria-label={t("eventFront.bookmarks.title")}
        className="flex flex-wrap gap-2"
      >
        {BOOKMARK_SCOPES.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={item === scope}
            onClick={() => {
              setScope(item);
              setOffset(0);
            }}
            className={cn(
              "rounded-[6px] border px-3 py-2 text-sm transition-colors",
              item === scope
                ? "border-primary bg-primary/10 font-medium text-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`eventFront.scope.${item}`)}
          </button>
        ))}
      </div>

      {bookmarks.isPending ? (
        <div className="space-y-3" aria-busy="true" aria-label={t("eventFront.bookmarks.loading")}>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : bookmarks.isError ? (
        <p className="rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {publicEventErrorMessage(bookmarks.error)}
        </p>
      ) : (bookmarks.data?.rows.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">{t(EMPTY_KEY[scope])}</p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {(bookmarks.data?.rows ?? []).map((row) => {
              const title = pickLocalized(row, "title", lang);
              const type = pickLocalized(
                { name_pl: row.type_name_pl, name_en: row.type_name_en },
                "name",
                lang,
              );
              return (
                <li
                  key={row.event_id}
                  className="rounded-[6px] border border-border bg-card p-4 transition-colors hover:border-primary/50"
                >
                  <Link to="/events/$slug" params={{ slug: row.slug }} className="block space-y-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <Star
                        className="h-4 w-4 shrink-0 fill-current text-primary"
                        aria-hidden="true"
                      />
                      {type !== "" && <Badge variant="outline">{type}</Badge>}
                      {row.has_ended && (
                        <Badge variant="secondary">{t("eventFront.header.endedBanner")}</Badge>
                      )}
                      {row.cancelled_at !== null && (
                        <Badge variant="destructive">
                          {t("eventFront.header.cancelledBanner")}
                        </Badge>
                      )}
                    </span>

                    <span className="block text-base font-semibold text-foreground">{title}</span>

                    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                        {formatEventDateTime(row.starts_at, row.timezone, lang)}
                        {row.timezone === null
                          ? null
                          : ` (${eventTimeZoneLabel(row.starts_at, row.timezone, lang)})`}
                      </span>
                      {row.location !== null && row.location !== "" && (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                          {row.location}
                        </span>
                      )}
                    </span>

                    <span className="block text-xs text-muted-foreground">
                      {t("eventFront.bookmarks.savedAt", {
                        date: formatEventDateTime(row.bookmarked_at, row.timezone, lang),
                      })}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {(bookmarks.data?.totalCount ?? 0) > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
              >
                {t("eventFront.list.prevPage")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {offset + 1}-{offset + (bookmarks.data?.rows.length ?? 0)} /{" "}
                {bookmarks.data?.totalCount ?? 0}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={offset + PAGE_SIZE >= (bookmarks.data?.totalCount ?? 0)}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {t("eventFront.list.nextPage")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
