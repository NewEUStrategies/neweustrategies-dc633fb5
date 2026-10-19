// Atom: wybór kontekstu porównania benchmarku (SPEC §6.1, §6.5).
//
// PO CO WYBÓR. Ten sam churn 4,9 % jest „normalny” dla mediów B2C i „słaby”
// dla B2B SMB - pasma zależą od tego, z kim się porównujemy. Domyślny
// kontekst wynika z segmentu danych, ale czytelnik musi móc zobaczyć ocenę
// w innym kontekście (np. członkostwa zamiast B2C) bez opuszczania objaśnienia.
//
// WSPÓLNY `Select` z `ui/select.tsx` (AGENTS: zero nowych atomów selecta).
// Etykieta jest prawdziwym `<label>` powiązanym z wyzwalaczem, więc czytnik
// ogłasza „Kontekst porównania, lista rozwijana”, a nie samą wartość.
import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LocalizedBenchmark } from "@/lib/analytics/semantic/benchmarks/adapter";
import type { ChartLang } from "@/lib/charts/format";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";
import { cn } from "@/lib/utils";

export interface BenchmarkContextSelectProps {
  bench: Pick<LocalizedBenchmark, "key" | "contexts">;
  /** Identyfikator aktywnego kontekstu. */
  value: string;
  onChange: (contextId: string) => void;
  lang?: ChartLang;
  className?: string;
}

export function BenchmarkContextSelect({
  bench,
  value,
  onChange,
  lang,
  className,
}: BenchmarkContextSelectProps) {
  ensureI18n();
  const { t } = useTranslation();
  const id = useId();
  const labelId = `${id}-label`;
  // Jeden kontekst to brak wyboru - sam napis zamiast pustej listy.
  const single = bench.contexts.length < 2;
  const current = bench.contexts.find((c) => c.id === value) ?? bench.contexts[0];

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span id={labelId} className="text-[11px] font-medium text-muted-foreground">
        {t("adminRevenue.benchmark.explainer.context", lang ? { lng: lang } : undefined)}
      </span>
      {single ? (
        <span aria-labelledby={labelId} className="text-xs leading-snug">
          {current?.label}
        </span>
      ) : (
        <Select value={current?.id} onValueChange={onChange}>
          <SelectTrigger
            aria-labelledby={labelId}
            className="h-auto min-h-8 py-1.5 text-left text-xs [&>span]:line-clamp-2"
            data-bench-context={bench.key}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-w-[min(28rem,calc(100vw-2rem))]">
            {bench.contexts.map((c) => (
              <SelectItem key={c.id} value={c.id} className="text-xs">
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
