// Generyczny segmented control (atom): rząd wykluczających się opcji w stylu
// przełącznika. Sterowany z zewnątrz (value/onChange), a11y przez radiogroup +
// aria-checked. Używany m.in. w inline-edytorze layoutu eksperta (tri-state
// dziedzicz/pokaż/ukryj), zaprojektowany pod dowolne enumy stringowe.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedControlOption<T extends string> {
  value: T;
  /** Treść segmentu - tekst lub ikona. */
  label: ReactNode;
  /** Tooltip + fallback aria-label (wymagany, gdy label jest ikoną). */
  title?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentedControlOption<T>[];
  onChange: (value: T) => void;
  /** Etykieta grupy dla czytników ekranu. */
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = "sm",
  className,
  disabled = false,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-stretch rounded-[6px] border border-border bg-muted/40 p-0.5",
        disabled && "opacity-50 pointer-events-none",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.title}
            title={option.title}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-[5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
              size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
              active
                ? "bg-background text-foreground shadow-sm border border-border/70"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
