// Atom: per-device responsive size input with px stepper arrows.
// Parses "16px" / "1.25rem" / "120%" — keeps the existing unit when stepping,
// defaults to "px" for empty values. Arrows are tiny chevrons stacked on the
// right side, matching the builder's compact 32px control row.
import { useMemo } from "react";
import type { Device, ResponsiveValue } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: ResponsiveValue<string> | undefined;
  device: Device;
  onChange: (next: ResponsiveValue<string>) => void;
  placeholder?: string;
  /** When true (default), render numeric stepper with px unit. */
  stepper?: boolean;
  min?: number;
  max?: number;
  step?: number;
}

const UNIT_RE = /^\s*(-?\d*\.?\d+)\s*(px|rem|em|%|vh|vw)?\s*$/i;

function parse(raw: string): { num: number | null; unit: string } {
  if (!raw) return { num: null, unit: "px" };
  const m = raw.match(UNIT_RE);
  if (!m) return { num: null, unit: "px" };
  return { num: parseFloat(m[1]), unit: (m[2] || "px").toLowerCase() };
}

export function ResponsiveInput({
  value,
  device,
  onChange,
  placeholder,
  stepper = true,
  min,
  max,
  step = 1,
}: Props) {
  const cur = value?.[device] ?? "";
  const { num, unit } = useMemo(() => parse(cur), [cur]);

  const commit = (next: string | undefined) => {
    onChange({ ...(value ?? {}), [device]: next || undefined });
  };

  const bump = (delta: number) => {
    const base = num ?? 0;
    let n = base + delta;
    if (typeof min === "number") n = Math.max(min, n);
    if (typeof max === "number") n = Math.min(max, n);
    // keep integer for px / %, allow 2 decimals otherwise
    const rounded = unit === "px" || unit === "%" ? Math.round(n) : Math.round(n * 100) / 100;
    commit(`${rounded}${unit}`);
  };

  if (!stepper) {
    return (
      <Input
        value={cur}
        placeholder={placeholder}
        className="h-8 text-xs"
        onChange={(e) => commit(e.target.value)}
      />
    );
  }

  return (
    <div className="relative">
      <Input
        value={cur}
        placeholder={placeholder ?? "16px"}
        className={cn("h-8 text-xs pr-6")}
        onChange={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            bump(e.shiftKey ? step * 10 : step);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            bump(e.shiftKey ? -step * 10 : -step);
          }
        }}
      />
      <div className="absolute right-0 top-0 h-8 w-5 flex flex-col border-l border-input">
        <button
          type="button"
          aria-label="Zwiększ"
          onClick={() => bump(step)}
          className="flex-1 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-tr-md transition-colors"
          tabIndex={-1}
        >
          <ChevronUp className="h-3 w-3" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          aria-label="Zmniejsz"
          onClick={() => bump(-step)}
          className="flex-1 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-br-md border-t border-input transition-colors"
          tabIndex={-1}
        >
          <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
