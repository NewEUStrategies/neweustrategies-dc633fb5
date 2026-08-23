// Widget "event-list" - nadchodzace/minione wydarzenia z modulu events
// (tenant-scoped RLS; kolumny wrazliwe odciete grantem). Warianty: karty
// (okladka + badge rodzaju + data + tytul + opis) i zwarta lista (blok daty +
// meta). Opcjonalnie: chip odliczania ("za X dni") i licznik RSVP. i18n PL/EN,
// dark/light przez tokeny, 6px rounding, akcent przez --speakers-accent.
//
// SSR-safe: daty formatujemy w STREFIE WYDARZENIA (events.timezone), wiec
// serwer i klient renderuja identyczny tekst niezaleznie od strefy runtime'u;
// chip odliczania zalezy od "teraz", wiec pojawia sie dopiero po montazu
// (wzorzec EventCountdownView - zero rozjazdu hydratacji).
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WidgetContent } from "@/lib/builder/types";
import { AppLink } from "@/components/atoms/AppLink";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { CalendarDays, Clock, MapPin, Users } from "@/lib/lucide-shim";
import {
  eventRsvpCountsQueryOptions,
  eventsListQueryOptions,
  type EventListRow,
} from "@/lib/builder/eventsQuery";
import { daysUntil } from "@/lib/events/countdown";
import { eventKindLabel } from "@/lib/events/kinds";
import { eventDateBlock, formatEventDateTime } from "@/lib/events/timezone";
import { getBool, getStr, type Lang } from "./frame";

const CARD_IMAGE_SIZES = "(min-width: 1024px) 360px, (min-width: 768px) 45vw, 92vw";

function locStr(c: WidgetContent, base: string, lang: Lang): string {
  return getStr(c, `${base}_${lang}`) || getStr(c, `${base}_pl`) || getStr(c, `${base}_en`);
}

/** Kolumny moga byc liczba (defaults) lub stringiem (select w panelu). */
function columnsOf(c: WidgetContent): number {
  const raw = c.columns;
  const n = typeof raw === "number" ? raw : Number(raw);
  const value = Number.isFinite(n) ? n : 3;
  return Math.min(4, Math.max(2, Math.round(value)));
}

function eventTitle(row: EventListRow, lang: Lang): string {
  return lang === "pl" ? row.title_pl || row.title_en : row.title_en || row.title_pl;
}

function eventDescription(row: EventListRow, lang: Lang): string {
  const primary = lang === "pl" ? row.description_pl : row.description_en;
  return primary || row.description_pl || row.description_en || "";
}

/** Chip odliczania - liczony wylacznie po montazu (nowMs != null). */
function countdownChipLabel(startsAt: string, lang: Lang, nowMs: number | null): string | null {
  if (nowMs === null) return null;
  const targetMs = Date.parse(startsAt);
  if (Number.isNaN(targetMs)) return null;
  if (targetMs <= nowMs) return null;
  const days = daysUntil(targetMs, nowMs);
  if (days <= 1) return lang === "pl" ? "Już jutro" : "Starting soon";
  return lang === "pl" ? `Za ${days} dni` : `In ${days} days`;
}

function KindBadge({ kind, lang }: { kind: string; lang: Lang }) {
  return (
    <span className="inline-flex items-center rounded-[6px] bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {eventKindLabel(kind, lang)}
    </span>
  );
}

function CountdownChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[6px] bg-[color:var(--speakers-accent,var(--brand))]/10 px-2 py-0.5 text-[10px] font-semibold text-brand-ink">
      <Clock aria-hidden className="h-3 w-3" />
      {label}
    </span>
  );
}

function RsvpChip({ going, lang }: { going: number; lang: Lang }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[6px] bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Users aria-hidden className="h-3 w-3" />
      {going} {lang === "pl" ? "zapisanych" : "going"}
    </span>
  );
}

interface RowProps {
  row: EventListRow;
  lang: Lang;
  showCountdown: boolean;
  showKindBadge: boolean;
  going: number | null;
  nowMs: number | null;
}

function EventCard({ row, lang, showCountdown, showKindBadge, going, nowMs }: RowProps) {
  const title = eventTitle(row, lang);
  const description = eventDescription(row, lang);
  const countdown = showCountdown ? countdownChipLabel(row.starts_at, lang, nowMs) : null;
  return (
    <AppLink
      href={`/events/${row.slug}`}
      className="group block h-full rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent,var(--brand))]/50"
      aria-label={title}
    >
      <article className="flex h-full flex-col overflow-hidden rounded-[6px] border border-border/60 bg-card transition-all duration-300 hover:-translate-y-0.5 hover:border-[color:var(--speakers-accent,var(--brand))]/40 hover:shadow-md">
        {row.cover_url && (
          <div className="relative aspect-video w-full overflow-hidden bg-muted">
            <OptimizedImage
              src={row.cover_url}
              alt=""
              responsive
              sizes={CARD_IMAGE_SIZES}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          </div>
        )}
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {showKindBadge && <KindBadge kind={row.kind} lang={lang} />}
            {countdown && <CountdownChip label={countdown} />}
            {going !== null && going > 0 && <RsvpChip going={going} lang={lang} />}
          </div>
          <h3 className="cms-post-title font-display text-base font-semibold leading-snug text-foreground">
            {title}
          </h3>
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays aria-hidden className="h-3.5 w-3.5" />
            {formatEventDateTime(row.starts_at, row.timezone, lang)}
          </p>
          {row.location && (
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin aria-hidden className="h-3.5 w-3.5" />
              {row.location}
            </p>
          )}
          {description && (
            <p className="cms-post-excerpt line-clamp-2 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </article>
    </AppLink>
  );
}

function EventRowItem({ row, lang, showCountdown, showKindBadge, going, nowMs }: RowProps) {
  const title = eventTitle(row, lang);
  const dateBlock = eventDateBlock(row.starts_at, row.timezone, lang);
  const countdown = showCountdown ? countdownChipLabel(row.starts_at, lang, nowMs) : null;
  return (
    <AppLink
      href={`/events/${row.slug}`}
      className="group flex items-center gap-4 rounded-[6px] border border-border/60 bg-card p-3 transition-colors hover:border-[color:var(--speakers-accent,var(--brand))]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent,var(--brand))]/50"
      aria-label={title}
    >
      <div
        aria-hidden
        className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-[6px] bg-[color:var(--speakers-accent,var(--brand))]/10 text-brand-ink"
      >
        <span className="text-lg font-bold leading-none">{dateBlock ? dateBlock.day : "-"}</span>
        <span className="text-[10px] font-semibold uppercase">
          {dateBlock ? dateBlock.month : ""}
        </span>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {showKindBadge && <KindBadge kind={row.kind} lang={lang} />}
          {countdown && <CountdownChip label={countdown} />}
          {going !== null && going > 0 && <RsvpChip going={going} lang={lang} />}
        </div>
        <h3 className="cms-post-title truncate font-display text-sm font-semibold text-foreground">
          {title}
        </h3>
        <p className="truncate text-xs text-muted-foreground">
          {formatEventDateTime(row.starts_at, row.timezone, lang)}
          {row.location ? ` · ${row.location}` : ""}
        </p>
      </div>
    </AppLink>
  );
}

export function EventsListView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const heading = locStr(c, "heading", lang);
  const emptyText =
    locStr(c, "emptyText", lang) ||
    (lang === "pl" ? "Brak zaplanowanych wydarzeń." : "No scheduled events.");
  const variantRaw = getStr(c, "variant") || "cards";
  const variant: "cards" | "list" = variantRaw === "list" ? "list" : "cards";
  const columns = columnsOf(c);
  const showCountdown = getBool(c, "showCountdown", true);
  const showKindBadge = getBool(c, "showKindBadge", true);
  const showRsvpCount = getBool(c, "showRsvpCount", false);
  const accent = getStr(c, "accentColor");

  const eventsQ = useQuery(eventsListQueryOptions(c, lang));
  const rows = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);

  // "Teraz" dopiero po montazu - chip odliczania nie moze rozjechac hydratacji
  // (SSR renderuje karty bez chipa, klient dokleja go po pierwszym renderze).
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (!showCountdown) return;
    setNowMs(Date.now());
  }, [showCountdown]);
  const effectiveNow = showCountdown ? nowMs : null;

  // Liczniki RSVP celowo BEZ ramienia prefetchu SSR: klucz zalezy od id
  // pobranych wierszy, wiec nie da sie go wyliczyc statycznie z tresci -
  // chipy doladowuja sie po hydratacji (invalidacja live dziala przez
  // WIDGET_LIVE_QUERY_PREFIXES).
  const rsvpQ = useQuery({
    ...eventRsvpCountsQueryOptions(rows.map((r) => r.id)),
    enabled: showRsvpCount && rows.length > 0,
  });
  const goingOf = (id: string): number | null =>
    showRsvpCount ? (rsvpQ.data?.get(id)?.going ?? 0) : null;

  const accentStyle: CSSProperties | undefined = accent
    ? { ["--speakers-accent" as string]: accent }
    : undefined;

  const gridClass =
    columns === 2
      ? "sm:grid-cols-2"
      : columns === 4
        ? "sm:grid-cols-2 lg:grid-cols-4"
        : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <section className="cms-event-list space-y-5" style={accentStyle}>
      {heading ? <h2 className="cms-block-heading text-foreground">{heading}</h2> : null}

      {eventsQ.isLoading ? (
        <div
          aria-hidden
          className={
            variant === "cards" ? `grid grid-cols-1 gap-4 sm:gap-5 ${gridClass}` : "space-y-2"
          }
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={
                "animate-pulse rounded-[6px] bg-muted/60 " +
                (variant === "cards" ? "h-56" : "h-[72px]")
              }
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-[6px] border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : variant === "cards" ? (
        <div className={`grid grid-cols-1 gap-4 sm:gap-5 ${gridClass}`}>
          {rows.map((row) => (
            <EventCard
              key={row.id}
              row={row}
              lang={lang}
              showCountdown={showCountdown}
              showKindBadge={showKindBadge}
              going={goingOf(row.id)}
              nowMs={effectiveNow}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <EventRowItem
              key={row.id}
              row={row}
              lang={lang}
              showCountdown={showCountdown}
              showKindBadge={showKindBadge}
              going={goingOf(row.id)}
              nowMs={effectiveNow}
            />
          ))}
        </div>
      )}
    </section>
  );
}
