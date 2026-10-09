// Pole tekstowe danych wykresu w panelu widgetu - zwykła textarea, która
// wklejony ARKUSZ przekłada na format średnikowy (`clipboardToChartText`).
// Pisanie i wklejanie zwykłego tekstu działają jak dotąd; problemy wklejki
// (obcięcie, komórki nieliczbowe, zgadnięty nagłówek) stoją pod polem.
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { clipboardPayloadOf } from "@/lib/charts/clipboardTable";
import type { ImportProblem } from "@/lib/charts/importTable";
import { ImportProblemList } from "./ImportProblemList";
import { clipboardToChartText } from "./textareaPaste";

interface Props {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}

export function ChartDataTextarea({ value, onChange, rows, placeholder, className }: Props) {
  const [problems, setProblems] = useState<readonly ImportProblem[]>([]);
  return (
    <div className="space-y-1.5">
      <Textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        className={className}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const wynik = clipboardToChartText(clipboardPayloadOf(e));
          if (wynik === null) return;
          e.preventDefault();
          onChange(wynik.text);
          setProblems(wynik.problems);
        }}
      />
      <ImportProblemList problems={problems} />
    </div>
  );
}
