// Wspólna rama "digital feature" - karta w stylistyce platformy
// (rounded-2xl / bg-card / border-border), nagłówek font-display, opcjonalny
// pasek narzędzi (np. filtry) i podpis źródła. Ten sam język wizualny co
// ChartFrame, ale bez wbudowanego przełącznika tabeli danych - poszczególne
// widoki dokładają własne kanały dostępności (tabela, lista, <details>).
// Czysto prezentacyjna, SSR-safe.
import type { ReactNode } from "react";

interface FeatureFrameProps {
  title: string;
  description: string;
  source: string;
  /** Elementy sterujące w prawym górnym rogu nagłówka (filtry, legenda). */
  toolbar?: ReactNode;
  /** Treść pod źródłem (np. tabela danych w <details>). */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Etykieta ARIA dla całej figury, gdy tytuł jest pusty. */
  ariaLabel?: string;
}

export function FeatureFrame({
  title,
  description,
  source,
  toolbar,
  footer,
  children,
  className,
  ariaLabel,
}: FeatureFrameProps) {
  return (
    <figure
      aria-label={!title && ariaLabel ? ariaLabel : undefined}
      className={[
        "nes-feature not-prose my-6 rounded-2xl border border-border bg-card p-4 md:p-6",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {(title || description || toolbar) && (
        <figcaption className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <div className="font-display text-lg font-semibold leading-snug text-foreground">
                {title}
              </div>
            )}
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {toolbar && <div className="flex shrink-0 flex-wrap items-center gap-2">{toolbar}</div>}
        </figcaption>
      )}

      {children}

      {(source || footer) && (
        <div className="mt-3 space-y-3">
          {source && <p className="text-xs text-muted-foreground">{source}</p>}
          {footer}
        </div>
      )}
    </figure>
  );
}

/** Wspólne klasy komórek tabeli danych (spójne z CHART_TABLE_CLS). */
export const FEATURE_TABLE_CLS = {
  table: "w-full border-collapse text-sm",
  th: "border-b border-border px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground",
  thNum:
    "border-b border-border px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground",
  td: "border-b border-border/60 px-3 py-1.5 text-left text-foreground",
  tdNum: "border-b border-border/60 px-3 py-1.5 text-right tabular-nums text-foreground",
} as const;

/**
 * Rozwijana tabela danych (kanał dostępności). Zamiast przycisku z osobnym
 * stanem - natywny <details>, więc działa bez JS i jest spójny między widokami.
 */
export function FeatureDataTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        <span aria-hidden className="transition-transform group-open:rotate-90">
          ▸
        </span>
        {label}
      </summary>
      <div className="mt-3 overflow-x-auto">{children}</div>
    </details>
  );
}
