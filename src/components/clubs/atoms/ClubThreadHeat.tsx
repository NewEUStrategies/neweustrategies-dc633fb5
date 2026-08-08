// Wskaźnik dynamiki wątku - cztery słupki + jedno zdanie w tooltipie.
//
// Zastępuje surowe "12 · 5 · 8.08.2026" w wierszu listy. Słupki są czytelne
// obwodowo (widać je nie czytając), a treść liczbowa - tempo, uczestnicy,
// cisza - stoi w tytule dla tych, którzy chcą wiedzieć dokładnie.
//
// Kolor NIE jest jedynym nośnikiem: poziom widać po liczbie wypełnionych
// słupków, więc wskaźnik działa też przy zaburzeniach rozróżniania barw.
import { useTranslation } from "react-i18next";
import { computeThreadPulse, type ThreadPulseInput } from "@/lib/clubs/threadPulse";

const FILL: Record<number, string> = {
  0: "bg-muted-foreground/30",
  1: "bg-muted-foreground/60",
  2: "bg-primary/50",
  3: "bg-primary/75",
  4: "bg-primary",
};

export function ClubThreadHeat({
  thread,
  showLabel = false,
  className,
}: {
  thread: ThreadPulseInput;
  /** Podpis stanu obok słupków (układ kart/magazyn ma miejsce, lista nie). */
  showLabel?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const pulse = computeThreadPulse(thread);

  const title = t("club.heat.tooltip", {
    state: t(`club.heat.${pulse.state}`),
    perDay: pulse.repliesPerDay.toLocaleString(undefined, { maximumFractionDigits: 1 }),
    hours: pulse.hoursSinceActivity ?? 0,
  });

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className ?? ""}`}
      title={title}
      aria-label={title}
      data-testid="club-thread-heat"
      data-level={pulse.level}
    >
      <span className="flex items-end gap-[2px]" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={`w-[3px] rounded-[1px] ${bar <= pulse.level ? (FILL[pulse.level] ?? "bg-primary") : "bg-muted"}`}
            style={{ height: `${4 + bar * 2}px` }}
          />
        ))}
      </span>
      {showLabel ? (
        <span className="text-[11px] font-medium text-muted-foreground">
          {t(`club.heat.${pulse.state}`)}
        </span>
      ) : null}
    </span>
  );
}
