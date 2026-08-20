// Pasek dynamiki klubu - 14 dni aktywności policzone z listy wątków.
//
// Strona klubu mówiła tylko "0 członków · 7 tematów". To są liczby STANU,
// a klub dyskusyjny ocenia się po RUCHU: czy w ostatnim tygodniu ktokolwiek
// się odezwał, ile wątków żyje, ile jest uśpionych. Liczymy to z danych,
// które lista już ma (`last_reply_at`, `created_at`), więc pasek nie kosztuje
// ani jednego dodatkowego zapytania.
//
// Sam RACHUNEK mieszka w `lib/clubs/activityStrip.ts` - okno, znaczniki czasu
// z przyszłości i podział na żywe/uśpione to reguła odczytu danych, nie sposób
// rysowania słupków. Tutaj zostaje wyłącznie widok.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  clubActivityBarHeight,
  computeClubActivity,
  CLUB_ACTIVITY_SPAN_DAYS,
} from "@/lib/clubs/activityStrip";
import type { ThreadPulseInput } from "@/lib/clubs/threadPulse";

export function ClubActivityStrip({
  threads,
  className,
}: {
  threads: readonly ThreadPulseInput[];
  className?: string;
}) {
  const { t } = useTranslation();

  const model = useMemo(() => computeClubActivity(threads, Date.now()), [threads]);

  if (threads.length === 0) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2 ${className ?? ""}`}
      data-testid="club-activity-strip"
    >
      <div
        className="flex h-7 items-end gap-[3px]"
        role="img"
        aria-label={t("club.activity.chartLabel", { days: CLUB_ACTIVITY_SPAN_DAYS })}
      >
        {model.days.map((count, index) => (
          <span
            key={index}
            className={`w-[6px] rounded-[2px] ${count === 0 ? "bg-muted" : "bg-primary/70"}`}
            style={{ height: `${clubActivityBarHeight(count, model.peak)}%` }}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">{model.week}</span>{" "}
        {t("club.activity.week")}
      </p>
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">{model.live}</span>{" "}
        {t("club.activity.live")}
      </p>
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">{model.dormant}</span>{" "}
        {t("club.activity.dormant")}
      </p>
    </div>
  );
}
