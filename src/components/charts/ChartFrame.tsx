// Rama wykresu: karta w stylistyce platformy (rounded-2xl / bg-card /
// border-border), nagłówek font-display, legenda, przełączany widok tabeli
// danych (kanał dostępności - tooltip nigdy nie jest jedyną drogą do
// wartości) i podpis źródła. Czysto prezentacyjna, SSR-safe.
import { useId, useState, type ReactNode } from "react";
import { Table2 } from "lucide-react";
import type { ChartLang } from "@/lib/charts/format";

const L = {
  pl: { showData: "Pokaż dane", hideData: "Ukryj dane", dataTable: "Dane wykresu" },
  en: { showData: "Show data", hideData: "Hide data", dataTable: "Chart data" },
} as const;

export interface LegendItem {
  name: string;
  colorSlot: number;
  /** Kształt klucza odzwierciedla znacznik: linia dla line/area, kwadrat dla reszty. */
  shape: "line" | "rect";
}

interface ChartFrameProps {
  title: string;
  description: string;
  source: string;
  lang: ChartLang;
  /** Legenda - renderowana ZAWSZE przy >=2 seriach (patrz reguły dataviz). */
  legend: LegendItem[];
  showLegend: boolean;
  /** Tabela danych - dostępnościowa alternatywa dla grafiki. */
  table: ReactNode;
  children: ReactNode;
  className?: string;
}

export function ChartFrame({
  title,
  description,
  source,
  lang,
  legend,
  showLegend,
  table,
  children,
  className,
}: ChartFrameProps) {
  const [tableOpen, setTableOpen] = useState(false);
  const t = L[lang];
  const tableId = useId();
  // Legenda przy jednej serii to szum - tytuł nazywa jedyny kolor.
  const legendVisible = showLegend && legend.length >= 2;

  return (
    <figure
      className={[
        "neh-chart not-prose my-6 rounded-2xl border border-border bg-card p-4 md:p-6",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {(title || description) && (
        <figcaption className="mb-4">
          {title && (
            <div className="font-display text-lg font-semibold leading-snug text-foreground">
              {title}
            </div>
          )}
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </figcaption>
      )}

      {legendVisible && (
        <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5" role="list">
          {legend.map((item) => (
            <li key={`${item.colorSlot}-${item.name}`} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={
                  item.shape === "line" ? "h-[3px] w-4 rounded-full" : "h-2.5 w-2.5 rounded-[3px]"
                }
                style={{ background: `var(--chart-${item.colorSlot})` }}
              />
              <span className="text-xs text-muted-foreground">{item.name}</span>
            </li>
          ))}
        </ul>
      )}

      {children}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {source ? <p className="text-xs text-muted-foreground">{source}</p> : <span />}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-expanded={tableOpen}
          aria-controls={tableId}
          onClick={() => setTableOpen((v) => !v)}
        >
          <Table2 className="h-3.5 w-3.5" aria-hidden />
          {tableOpen ? t.hideData : t.showData}
        </button>
      </div>

      <div id={tableId} hidden={!tableOpen} className="mt-3 overflow-x-auto">
        <div className="sr-only">{t.dataTable}</div>
        {table}
      </div>
    </figure>
  );
}

/** Wspólne klasy komórek tabeli danych. */
export const CHART_TABLE_CLS = {
  table: "w-full border-collapse text-sm",
  th: "border-b border-border px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground",
  thNum:
    "border-b border-border px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground",
  td: "border-b border-border/60 px-3 py-1.5 text-left text-foreground",
  tdNum: "border-b border-border/60 px-3 py-1.5 text-right tabular-nums text-foreground",
} as const;
