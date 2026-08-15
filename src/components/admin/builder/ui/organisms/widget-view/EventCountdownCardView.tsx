// Widget "event-countdown-card" - premium karta wydarzenia z okladka, meta
// (data, liczba uczestnikow), odliczaniem i CTA. Tryb "event": dane z modulu
// events po id (cover_url + realne liczniki RSVP); tryb "custom": reczne dane.
// SSR-safe: serwer i pierwszy render klienta pokazuja placeholdery ("--"),
// tick startuje po montazu - zero rozjazdu hydratacji. i18n PL/EN, dark/light
// przez tokeny motywu, 6px rounding, animacje respektuja prefers-reduced-motion.
import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WidgetContent } from "@/lib/builder/types";
import { safeUrl } from "@/lib/sanitize";
import { AppLink } from "@/components/atoms/AppLink";
import { CalendarDays, Clock, Users, MapPin, ArrowRight } from "@/lib/lucide-shim";
import { eventByIdQueryOptions, eventRsvpCountsQueryOptions } from "@/lib/builder/eventsQuery";
import { countdownParts, isStartingSoon, pad2, parseCountdownTarget } from "@/lib/events/countdown";
import { useBuilderMode } from "@/lib/content-model/editorCanvas";
import { getBool, getNum, getStr, type Lang } from "./frame";
import { asOneOf } from "@/lib/content-model/contentValue";

function locStr(c: WidgetContent, base: string, lang: Lang): string {
  return getStr(c, `${base}_${lang}`) || getStr(c, `${base}_pl`) || getStr(c, `${base}_en`);
}

/** Rozmiary kafelka odliczania. `size` jest wspolne z widgetem event-countdown. */
export const COUNTDOWN_CARD_SIZES = ["md", "lg"] as const;
export type CountdownCardSize = (typeof COUNTDOWN_CARD_SIZES)[number];

/** Skala kafelka. Rosnie wysokosc, cyfra i etykieta - proporcje zostaja. */
const TILE_SCALE: Readonly<Record<CountdownCardSize, { box: string; label: string }>> = {
  md: { box: "h-14 min-w-[3.25rem] text-2xl", label: "text-[11px]" },
  lg: { box: "h-20 min-w-[4rem] text-4xl", label: "text-xs" },
};

function UnitTile({
  value,
  label,
  animate,
  size,
}: {
  value: string;
  label: string;
  animate: boolean;
  size: CountdownCardSize;
}) {
  const scale = TILE_SCALE[size];
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <span
        className={
          `flex w-full items-center justify-center rounded-[6px] border border-border/60 bg-background/80 font-display font-bold tabular-nums text-foreground shadow-sm ${scale.box} ` +
          (animate ? "transition-transform duration-300 motion-safe:group-hover:scale-[1.04]" : "")
        }
      >
        {value}
      </span>
      <span className={`${scale.label} font-medium uppercase tracking-wider text-muted-foreground`}>
        {label}
      </span>
    </div>
  );
}

export function EventCountdownCardView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const inBuilder = useBuilderMode() !== null;
  const mode: "custom" | "event" = getStr(c, "mode") === "event" ? "event" : "custom";
  const eventId = getStr(c, "eventId");
  const showSeconds = getBool(c, "showSeconds", true);
  const showAttendees = getBool(c, "showAttendees", true);
  const showCountdown = getBool(c, "showCountdown", true);
  const showLocation = getBool(c, "showLocation", true);
  const enableAnimations = getBool(c, "enableAnimations", true);
  // Edytor odliczania oferuje rozmiar md/lg takze dla wariantu kartowego -
  // wczesniej kafelki mialy sztywna wysokosc, wiec wybor nic nie zmienial.
  const tileSize = asOneOf<CountdownCardSize>(c.size, COUNTDOWN_CARD_SIZES, "md");
  const accent = getStr(c, "accentColor");
  const manualImage = safeUrl(getStr(c, "image"), "");
  const manualAttendees = Math.max(0, Math.round(getNum(c, "attendees", 0)));
  const href = safeUrl(getStr(c, "href"), "");
  const ctaLabel = locStr(c, "ctaLabel", lang);

  const eventQ = useQuery({
    ...eventByIdQueryOptions(eventId),
    enabled: mode === "event" && !!eventId,
  });
  const rsvpQ = useQuery({
    ...eventRsvpCountsQueryOptions(eventId ? [eventId] : []),
    enabled: mode === "event" && !!eventId && showAttendees,
  });

  const eventRow = eventQ.data ?? null;
  const targetIso = mode === "event" ? (eventRow?.starts_at ?? "") : getStr(c, "targetAt");
  const targetMs = parseCountdownTarget(targetIso);

  const eventTitle = eventRow
    ? lang === "pl"
      ? eventRow.title_pl || eventRow.title_en
      : eventRow.title_en || eventRow.title_pl
    : "";
  const title = locStr(c, "title", lang) || eventTitle;
  const image = manualImage || safeUrl(eventRow?.cover_url ?? "", "");
  const attendees =
    mode === "event" ? (rsvpQ.data?.get(eventId)?.going ?? manualAttendees) : manualAttendees;
  const doneText =
    locStr(c, "doneText", lang) || (lang === "pl" ? "Wydarzenie trwa!" : "Event started!");
  const doneHint =
    locStr(c, "doneHint", lang) ||
    (lang === "pl" ? "Dołącz teraz, aby wziąć udział" : "Join now to participate");
  const location =
    locStr(c, "location", lang) || (mode === "event" ? (eventRow?.location ?? "") : "");
  const eventHref = mode === "event" && eventRow ? `/events/${eventRow.slug}` : "";
  const ctaHref = href || eventHref;

  // "Teraz" startuje dopiero po montazu - SSR i pierwszy render klienta sa
  // identyczne (placeholdery), wiec hydratacja nigdy sie nie rozjezdza.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (targetMs === null || !showCountdown) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), showSeconds ? 1000 : 30_000);
    return () => window.clearInterval(interval);
  }, [targetMs, showSeconds, showCountdown]);

  if (targetMs === null) {
    if (inBuilder) {
      return (
        <section className="cms-event-countdown-card">
          <p className="rounded-[6px] border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
            {lang === "pl"
              ? "Ustaw datę odliczania (lub wybierz wydarzenie) w panelu widgetu."
              : "Set the countdown date (or pick an event) in the widget panel."}
          </p>
        </section>
      );
    }
    return null;
  }

  const parts = nowMs !== null ? countdownParts(targetMs, nowMs) : null;
  const soon = nowMs !== null && isStartingSoon(targetMs, nowMs);
  const done = parts?.done ?? false;
  const dateLabel = new Date(targetMs).toLocaleDateString(lang === "pl" ? "pl-PL" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const labels =
    lang === "pl"
      ? { days: "dni", hours: "godz.", minutes: "min", seconds: "sek." }
      : { days: "days", hours: "hrs", minutes: "min", seconds: "sec" };

  const accentStyle: CSSProperties | undefined = accent
    ? { ["--ecc-accent" as string]: accent }
    : undefined;

  const units = [
    { value: parts ? String(parts.days) : "--", label: labels.days },
    { value: parts ? pad2(parts.hours) : "--", label: labels.hours },
    { value: parts ? pad2(parts.minutes) : "--", label: labels.minutes },
    ...(showSeconds ? [{ value: parts ? pad2(parts.seconds) : "--", label: labels.seconds }] : []),
  ];

  return (
    <section
      style={accentStyle}
      className={
        "cms-event-countdown-card group mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-[6px] border border-border/60 bg-card shadow-sm " +
        (enableAnimations
          ? "transition-all duration-300 motion-safe:hover:-translate-y-1.5 motion-safe:hover:shadow-lg"
          : "")
      }
    >
      {image ? (
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
          <img
            src={image}
            alt={title || (lang === "pl" ? "Wydarzenie" : "Event")}
            loading="lazy"
            decoding="async"
            className={
              "h-full w-full object-cover " +
              (enableAnimations
                ? "transition-transform duration-500 motion-safe:group-hover:scale-105"
                : "")
            }
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-[color:var(--brand-ink,#01112F)]/70 via-transparent to-transparent"
          />
          {soon && !done ? (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-[6px] bg-[color:var(--ecc-accent,var(--brand))] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--brand-foreground,white)] shadow-sm">
              <Clock aria-hidden className="h-3 w-3" />
              {lang === "pl" ? "Już wkrótce!" : "Starts soon!"}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-4 p-5">
        <div className="space-y-2">
          {title ? <h3 className="cms-block-heading text-foreground">{title}</h3> : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays aria-hidden className="h-3.5 w-3.5" />
              {dateLabel}
            </span>
            {showAttendees && attendees > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <Users aria-hidden className="h-3.5 w-3.5" />
                {lang === "pl" ? `${attendees} uczestników` : `${attendees} attending`}
              </span>
            ) : null}
            {showLocation && location ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin aria-hidden className="h-3.5 w-3.5" />
                {location}
              </span>
            ) : null}
          </div>
        </div>

        {!showCountdown ? null : done ? (
          <div className="rounded-[6px] border border-border/60 bg-muted/40 p-4 text-center">
            <p role="status" className="font-display text-lg font-semibold text-foreground">
              {doneText}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{doneHint}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Clock aria-hidden className="h-3.5 w-3.5" />
              {lang === "pl" ? "Start za:" : "Event starts in:"}
            </p>
            <div
              role="timer"
              aria-live="off"
              aria-label={title || (lang === "pl" ? "Odliczanie" : "Countdown")}
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${units.length}, minmax(0, 1fr))` }}
            >
              {units.map((unit) => (
                <UnitTile
                  key={unit.label}
                  value={unit.value}
                  label={unit.label}
                  animate={enableAnimations}
                  size={tileSize}
                />
              ))}
            </div>
          </div>
        )}

        {ctaHref ? (
          <AppLink
            href={ctaHref}
            className={
              "inline-flex w-full items-center justify-center gap-1.5 rounded-[6px] bg-[color:var(--ecc-accent,var(--brand))] px-4 py-2.5 text-sm font-semibold text-[color:var(--brand-foreground,white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ecc-accent,var(--brand))]/50 " +
              (enableAnimations
                ? "transition-transform duration-200 hover:opacity-90 motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.98]"
                : "hover:opacity-90")
            }
          >
            {ctaLabel ||
              (done
                ? lang === "pl"
                  ? "Dołącz do wydarzenia"
                  : "Join event"
                : lang === "pl"
                  ? "Zarezerwuj miejsce"
                  : "Reserve your spot")}
            <ArrowRight aria-hidden className="h-4 w-4" />
          </AppLink>
        ) : null}
      </div>
    </section>
  );
}
