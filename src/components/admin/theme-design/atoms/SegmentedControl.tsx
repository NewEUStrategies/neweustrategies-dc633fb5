// Atom: accessible segmented (single-choice) button group.
//
// Unifies the four near-duplicate toggle rows the pane used to inline
// (shared/split language mode, edit language, preview mode, preview language).
// Generic over the option value so callers stay fully typed - no string casts.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<TValue extends string> {
  value: TValue;
  label: ReactNode;
  /** Native `title` tooltip. */
  title?: string;
  /** Accessible name when the visible label is icon-only. */
  ariaLabel?: string;
}

interface SegmentedControlProps<TValue extends string> {
  options: readonly SegmentedOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  /** `accent` = brand fill when active; `invert` = foreground/background swap. */
  variant?: "accent" | "invert";
  size?: "sm" | "md";
  disabled?: boolean;
  uppercase?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function SegmentedControl<TValue extends string>({
  options,
  value,
  onChange,
  variant = "accent",
  size = "md",
  disabled = false,
  uppercase = false,
  className,
  ariaLabel,
}: SegmentedControlProps<TValue>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex rounded-md border border-border overflow-hidden",
        size === "sm" ? "text-[11px]" : "text-xs",
        className,
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            disabled={disabled}
            aria-pressed={active}
            aria-label={option.ariaLabel}
            title={option.title}
            className={cn(
              "inline-flex items-center justify-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
              size === "sm" ? "px-2.5 py-1" : "px-3 py-1.5",
              uppercase && "uppercase tracking-wide",
              index > 0 && "border-l border-border",
              active
                ? variant === "accent"
                  ? "bg-brand text-[color:var(--brand-foreground)] font-semibold"
                  : "bg-foreground text-background font-semibold"
                : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
