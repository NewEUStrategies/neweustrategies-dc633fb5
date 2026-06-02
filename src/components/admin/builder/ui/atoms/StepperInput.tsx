// Atom: text input for CSS size values (16px, 1.25rem, 120%) with stepper
// arrows on the right. Parses the existing unit and preserves it; defaults
// to px when empty. Also handles ArrowUp/ArrowDown keys (Shift = ±10).
import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}

const UNIT_RE = /^\s*(-?\d*\.?\d+)\s*(px|rem|em|%|vh|vw)?\s*$/i;

function parse(raw: string): { num: number | null; unit: string } {
  if (!raw) return { num: null, unit: "px" };
  const m = raw.match(UNIT_RE);
  if (!m) return { num: null, unit: "px" };
  return { num: parseFloat(m[1]), unit: (m[2] || "px").toLowerCase() };
}

export function StepperInput({ value, onChange, placeholder, min, max, step = 1, className }: Props) {
  const cur = value ?? "";
  const { num, unit } = useMemo(() => parse(cur), [cur]);

  const bump = (delta: number) => {
    const base = num ?? 0;
    let n = base + delta;
    if (typeof min === "number") n = Math.max(min, n);
    if (typeof max === "number") n = Math.min(max, n);
    const rounded = unit === "px" || unit === "%" ? Math.round(n) : Math.round(n * 100) / 100;
    onChange(`${rounded}${unit}`);
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        value={cur}
        placeholder={placeholder ?? "16px"}
        className="h-8 text-xs pr-6"
        onChange={(e) => onChange(e.target.value || undefined)}
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
