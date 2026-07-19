// Kompaktowa plakietka lead score: wynik + pasmo (kolor). Używana w tabeli
// skrzynki leadów i w nagłówku karty leada.
import type { ScoreBand } from "@/lib/crm/scoring";
import { SCORE_BAND_LABELS } from "@/lib/crm/scoring";

const BAND_CLASS: Record<ScoreBand, string> = {
  hot: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  warm: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  cool: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  cold: "bg-muted text-muted-foreground",
};

const DOT_CLASS: Record<ScoreBand, string> = {
  hot: "bg-rose-500",
  warm: "bg-amber-500",
  cool: "bg-sky-500",
  cold: "bg-muted-foreground/50",
};

export function LeadScoreBadge({
  score,
  band,
  lang,
  showLabel = false,
}: {
  score: number;
  band: ScoreBand;
  lang: "pl" | "en";
  showLabel?: boolean;
}) {
  const label = SCORE_BAND_LABELS[lang][band];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium tabular-nums ${BAND_CLASS[band]}`}
      title={label}
      aria-label={`Lead score ${score} (${label})`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT_CLASS[band]}`} aria-hidden />
      {score}
      {showLabel && <span className="font-normal">{label}</span>}
    </span>
  );
}
