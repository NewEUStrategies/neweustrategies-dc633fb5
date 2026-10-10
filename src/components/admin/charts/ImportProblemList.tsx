// Lista problemów importu albo wklejenia - JEDEN wygląd i jedna tabela
// tekstów (`importProblemText`) dla kontrolki pliku, podglądu tabeli
// i siatki, w którą wklejono zakres.
//
// Problem jest częścią wyniku, nie dodatkiem: import, który obciął serie
// albo zdjął flagi Eurostatu i milczy, wygląda jak import udany.
import { AlertTriangle } from "lucide-react";
import { importProblemText } from "@/lib/charts/importProblems";
import type { ImportProblem } from "@/lib/charts/importTable";
import "@/lib/i18n-admin-blocks";
import { cn } from "@/lib/utils";
import { useChartEditorT, type EditorLang } from "./chartEditorI18n";

export function ImportProblemList({
  problems,
  lang,
  className,
}: {
  problems: readonly ImportProblem[];
  lang?: EditorLang;
  className?: string;
}) {
  const t = useChartEditorT(lang);
  if (problems.length === 0) return null;
  return (
    <ul
      className={cn(
        "space-y-0.5 rounded-md border border-border bg-muted/40 p-2 text-[11px]",
        className,
      )}
    >
      {problems.map((p, i) => (
        <li key={`${p.code}-${i}`} className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          <span>{importProblemText(p, t)}</span>
        </li>
      ))}
    </ul>
  );
}
