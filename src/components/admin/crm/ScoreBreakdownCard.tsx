// "Dlaczego ten wynik" - rozbicie lead score na sygnały + przycisk przeliczenia.
// Renderowane w karcie leada (zakładka Profil).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { recomputeLeadScore } from "@/lib/crm.functions";
import {
  parseScoreBreakdown,
  SCORE_SIGNAL_LABELS,
  SCORE_BAND_LABELS,
  type ScoreBand,
  type ScoreSignalKey,
} from "@/lib/crm/scoring";
import { LeadScoreBadge } from "./LeadScoreBadge";

const COPY = {
  pl: {
    title: "Lead score",
    empty: "Brak sygnałów - wynik 0.",
    recompute: "Przelicz",
    updated: "Zaktualizowano",
    count: "zdarzeń",
  },
  en: {
    title: "Lead score",
    empty: "No signals yet - score 0.",
    recompute: "Recompute",
    updated: "Updated",
    count: "events",
  },
} as const;

export function ScoreBreakdownCard({
  leadId,
  score,
  band,
  breakdown,
  updatedAt,
  lang,
}: {
  leadId: string;
  score: number;
  band: ScoreBand;
  breakdown: unknown;
  updatedAt: string | null;
  lang: "pl" | "en";
}) {
  const qc = useQueryClient();
  const t = COPY[lang];
  const entries = parseScoreBreakdown(breakdown);

  const recomputeMut = useMutation({
    mutationFn: async () => recomputeLeadScore({ data: { id: leadId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-lead", leadId] });
      qc.invalidateQueries({ queryKey: ["crm-leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const labelFor = (key: string): string => SCORE_SIGNAL_LABELS[lang][key as ScoreSignalKey] ?? key;

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-medium">{t.title}</span>
        <LeadScoreBadge score={score} band={band} lang={lang} showLabel />
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 text-[11px]"
          disabled={recomputeMut.isPending}
          onClick={() => recomputeMut.mutate()}
        >
          <RefreshCw className={`w-3 h-3 mr-1 ${recomputeMut.isPending ? "animate-spin" : ""}`} />
          {t.recompute}
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((e) => (
            <li key={e.key} className="flex items-center gap-2 text-[12px]">
              <span>{labelFor(e.key)}</span>
              {e.count > 1 && (
                <span className="text-[11px] text-muted-foreground">
                  {e.count} {t.count}
                </span>
              )}
              <span className="ml-auto tabular-nums font-medium">
                +{e.points.toLocaleString(lang === "pl" ? "pl-PL" : "en-GB")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {updatedAt && (
        <p className="text-[11px] text-muted-foreground border-t pt-1.5">
          {t.updated}: {new Date(updatedAt).toLocaleString()}
          <span className="mx-1">·</span>
          {SCORE_BAND_LABELS[lang][band]}
        </p>
      )}
    </div>
  );
}
