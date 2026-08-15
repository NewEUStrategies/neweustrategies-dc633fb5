// Widget "event-countdown" - odliczanie do startu wydarzenia (tryb "event":
// data z modulu events po id; tryb "custom": reczna data ISO). SSR-safe:
// serwer i pierwszy render klienta pokazuja placeholdery ("--"), tick startuje
// po montazu - zero rozjazdu hydratacji. Po uplywie celu: tekst "done" + CTA.
// i18n PL/EN, dark/light przez tokeny, 6px rounding.
import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WidgetContent } from "@/lib/builder/types";
import { safeUrl } from "@/lib/sanitize";
import { AppLink } from "@/components/atoms/AppLink";
import { ArrowRight } from "@/lib/lucide-shim";
import { eventByIdQueryOptions } from "@/lib/builder/eventsQuery";
import { countdownParts, pad2, parseCountdownTarget } from "@/lib/events/countdown";
import { useBuilderMode } from "@/lib/content-model/editorCanvas";
import { getBool, getStr, type Lang } from "./frame";

function locStr(c: WidgetContent, base: string, lang: Lang): string {
  return getStr(c, `${base}_${lang}`) || getStr(c, `${base}_pl`) || getStr(c, `${base}_en`);
}

function UnitTile({ value, label, large }: { value: string; label: string; large: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={
          "flex items-center justify-center rounded-[6px] border border-border/60 bg-card font-display font-bold tabular-nums text-foreground shadow-sm " +
          (large ? "h-20 w-20 text-4xl" : "h-14 w-14 text-2xl")
        }
      >
        {value}
      </span>
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

export function EventCountdownView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const inBuilder = useBuilderMode() !== null;
  const modeRaw = getStr(c, "mode") || "custom";
  const mode: "custom" | "event" = modeRaw === "event" ? "event" : "custom";
  const eventId = getStr(c, "eventId");
  const showSeconds = getBool(c, "showSeconds", true);
  const large = (getStr(c, "size") || "md") === "lg";
  const accent = getStr(c, "accentColor");
  const rawHref = getStr(c, "href");
  const href = rawHref ? safeUrl(rawHref, "") : "";
  const ctaLabel = locStr(c, "ctaLabel", lang);

  const eventQ = useQuery({
    ...eventByIdQueryOptions(eventId),
    enabled: mode === "event" && !!eventId,
  });

  const targetIso = mode === "event" ? (eventQ.data?.starts_at ?? "") : getStr(c, "targetAt");
  const targetMs = parseCountdownTarget(targetIso);

  const eventTitle = eventQ.data
    ? lang === "pl"
      ? eventQ.data.title_pl || eventQ.data.title_en
      : eventQ.data.title_en || eventQ.data.title_pl
    : "";
  const title = locStr(c, "title", lang) || eventTitle;
  const doneText =
    locStr(c, "doneText", lang) || (lang === "pl" ? "Wydarzenie trwa!" : "The event is live!");
  const eventHref = mode === "event" && eventQ.data ? `/events/${eventQ.data.slug}` : "";
  const ctaHref = href || eventHref;

  // "Teraz" startuje dopiero po montazu - SSR i pierwszy render klienta sa
  // identyczne (placeholdery), wiec hydratacja nigdy sie nie rozjezdza.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (targetMs === null) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), showSeconds ? 1000 : 30_000);
    return () => window.clearInterval(interval);
  }, [targetMs, showSeconds]);

  const accentStyle: CSSProperties | undefined = accent
    ? { ["--speakers-accent" as string]: accent }
    : undefined;

  if (targetMs === null) {
    // Podpowiedz autorska TYLKO na kanwie buildera. Publicznie: podczas
    // ladowania (tryb "event" bez ciepłego cache) i dla wydarzenia
    // niedostepnego (szkic / cofnieta publikacja) widget jest po prostu
    // niewidoczny - czytelnik nie moze zobaczyc instrukcji dla redaktora.
    if (inBuilder) {
      return (
        <section className="cms-event-countdown">
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
  const labels =
    lang === "pl"
      ? { days: "dni", hours: "godz.", minutes: "min", seconds: "sek." }
      : { days: "days", hours: "hrs", minutes: "min", seconds: "sec" };

  return (
    <section
      className="cms-event-countdown flex flex-col items-center gap-4 text-center"
      style={accentStyle}
    >
      {title && !(parts?.done ?? false) ? (
        <h2 className="cms-block-heading text-foreground">{title}</h2>
      ) : null}

      {parts?.done ? (
        <p role="status" className="font-display text-xl font-semibold text-brand-ink">
          {doneText}
        </p>
      ) : (
        <div
          role="timer"
          aria-live="off"
          aria-label={title || (lang === "pl" ? "Odliczanie" : "Countdown")}
          className="flex flex-wrap items-start justify-center gap-3"
        >
          <UnitTile value={parts ? String(parts.days) : "--"} label={labels.days} large={large} />
          <UnitTile value={parts ? pad2(parts.hours) : "--"} label={labels.hours} large={large} />
          <UnitTile
            value={parts ? pad2(parts.minutes) : "--"}
            label={labels.minutes}
            large={large}
          />
          {showSeconds && (
            <UnitTile
              value={parts ? pad2(parts.seconds) : "--"}
              label={labels.seconds}
              large={large}
            />
          )}
        </div>
      )}

      {ctaHref && (ctaLabel || (parts?.done ?? false)) && (
        <AppLink
          href={ctaHref}
          className="inline-flex items-center gap-1.5 rounded-[6px] bg-[color:var(--speakers-accent,var(--brand))] px-4 py-2 text-sm font-semibold text-[color:var(--brand-foreground,white)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent,var(--brand))]/50"
        >
          {ctaLabel || (lang === "pl" ? "Zobacz wydarzenie" : "View event")}
          <ArrowRight aria-hidden className="h-4 w-4" />
        </AppLink>
      )}
    </section>
  );
}
