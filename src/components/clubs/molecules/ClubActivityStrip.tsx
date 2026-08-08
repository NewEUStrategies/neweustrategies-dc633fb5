// Pasek dynamiki klubu - 14 dni aktywności policzone z listy wątków.
//
// Strona klubu mówiła tylko "0 członków · 7 tematów". To są liczby STANU,
// a klub dyskusyjny ocenia się po RUCHU: czy w ostatnim tygodniu ktokolwiek
// się odezwał, ile wątków żyje, ile jest uśpionych. Liczymy to z danych,
// które lista już ma (`last_reply_at`, `created_at`), więc pasek nie kosztuje
// ani jednego dodatkowego zapytania.
//
// Świadomie liczymy z ZAŁADOWANEJ strony wątków, nie z całego klubu - to jest
// obraz tego, co użytkownik widzi pod paskiem, i podpis mówi to wprost.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { computeThreadPulse, type ThreadPulseInput } from "@/lib/clubs/threadPulse";

const DAY = 86_400_000;
const SPAN = 14;

export function ClubActivityStrip({
  threads,
  className,
}: {
  threads: readonly ThreadPulseInput[];
  className?: string;
}) {
  const { t } = useTranslation();

  const model = useMemo(() => {
    const now = Date.now();
    const today = Math.floor(now / DAY);
    const days = new Array<number>(SPAN).fill(0);

    let live = 0;
    let dormant = 0;
    for (const thread of threads) {
      const stamp = Date.parse(thread.last_reply_at ?? thread.created_at);
      if (Number.isFinite(stamp)) {
        const index = SPAN - 1 - (today - Math.floor(stamp / DAY));
        if (index >= 0 && index < SPAN) days[index] = (days[index] ?? 0) + 1;
      }
      const pulse = computeThreadPulse(thread, now);
      if (pulse.level >= 2) live += 1;
      if (pulse.level === 0) dormant += 1;
    }

    return {
      days,
      peak: days.reduce((max, value) => Math.max(max, value), 0),
      week: days.slice(SPAN - 7).reduce((sum, value) => sum + value, 0),
      live,
      dormant,
    };
  }, [threads]);

  if (threads.length === 0) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2 ${className ?? ""}`}
      data-testid="club-activity-strip"
    >
      <div
        className="flex h-7 items-end gap-[3px]"
        role="img"
        aria-label={t("club.activity.chartLabel", { days: SPAN })}
      >
        {model.days.map((count, index) => (
          <span
            key={index}
            className={`w-[6px] rounded-[2px] ${count === 0 ? "bg-muted" : "bg-primary/70"}`}
            style={{
              height: `${model.peak === 0 ? 12 : Math.max(12, Math.round((count / model.peak) * 100))}%`,
            }}
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
