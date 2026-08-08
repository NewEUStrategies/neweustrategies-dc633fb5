// Puls dyskusji - zobrazowanie DYNAMIKI, nie tylko licznik odpowiedzi.
//
// Wątek pokazywał "12 odpowiedzi" i tyle. Czytelnik wchodzący z huba nie
// wiedział, czy to dwanaście zdań jednej osoby sprzed roku, czy żywa wymiana
// pięciu osób z dzisiaj. Cztery liczby (uczestnicy, tempo z ostatniej doby,
// czas do pierwszej odpowiedzi, ostatnia aktywność) plus mikrowykres rozkładu
// w czasie odpowiadają na to jednym spojrzeniem.
//
// Wykres jest gołym SVG: dwadzieścia kilka słupków nie potrzebuje biblioteki
// do wykresów, a każda taka biblioteka kosztuje kilkadziesiąt kB na trasie,
// która ma być szybka.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Clock3, Flame, Users2 } from "lucide-react";
import {
  computeThreadDynamics,
  formatDurationShort,
  type ThreadDynamicsReply,
} from "@/lib/clubs/threadDynamics";
import { formatDateShort } from "@/lib/i18n/format";

function Sparkline({
  buckets,
  peak,
  label,
}: {
  buckets: readonly { start: number; count: number }[];
  peak: number;
  label: string;
}) {
  return (
    <div
      className="flex h-10 items-end gap-[2px]"
      role="img"
      aria-label={label}
      data-testid="club-thread-sparkline"
    >
      {buckets.map((bucket) => {
        const ratio = peak === 0 ? 0 : bucket.count / peak;
        return (
          <span
            key={bucket.start}
            className={
              "flex-1 rounded-[2px] transition-[height] duration-500 " +
              (bucket.count === 0 ? "bg-muted" : "bg-primary/70")
            }
            style={{ height: `${Math.max(6, Math.round(ratio * 100))}%` }}
          />
        );
      })}
    </div>
  );
}

function Metric({
  icon,
  value,
  caption,
}: {
  icon: React.ReactNode;
  value: string;
  caption: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
        <span className="text-primary" aria-hidden="true">
          {icon}
        </span>
        <span className="truncate">{value}</span>
      </div>
      <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
        {caption}
      </p>
    </div>
  );
}

export function ClubThreadPulse({
  createdAt,
  replies,
  lang,
  className,
}: {
  createdAt: string;
  replies: readonly ThreadDynamicsReply[];
  lang: "pl" | "en";
  className?: string;
}) {
  const { t } = useTranslation();
  const dynamics = useMemo(
    () => computeThreadDynamics(createdAt, replies),
    [createdAt, replies],
  );

  return (
    <section
      className={`rounded-xl border border-border/60 bg-card/60 p-4 ${className ?? ""}`}
      aria-label={t("club.pulse.title")}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("club.pulse.title")}
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {dynamics.lastActivityAt === null
            ? t("club.pulse.noActivity")
            : t("club.pulse.lastActivity", {
                date: formatDateShort(dynamics.lastActivityAt, lang),
              })}
        </span>
      </div>

      <Sparkline
        buckets={dynamics.buckets}
        peak={dynamics.peak}
        label={t("club.pulse.chartLabel", { count: dynamics.total })}
      />

      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 sm:grid-cols-4">
        <Metric
          icon={<Users2 className="h-3.5 w-3.5" />}
          value={String(dynamics.participants)}
          caption={t("club.pulse.participants")}
        />
        <Metric
          icon={<Activity className="h-3.5 w-3.5" />}
          value={String(dynamics.total)}
          caption={t("club.pulse.replies")}
        />
        <Metric
          icon={<Flame className="h-3.5 w-3.5" />}
          value={String(dynamics.last24h)}
          caption={t("club.pulse.last24h")}
        />
        <Metric
          icon={<Clock3 className="h-3.5 w-3.5" />}
          value={formatDurationShort(dynamics.firstReplyMinutes) ?? "-"}
          caption={t("club.pulse.firstReply")}
        />
      </div>
    </section>
  );
}
