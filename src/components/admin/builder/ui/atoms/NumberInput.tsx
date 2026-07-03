// Atom: numeric input with stepper arrows and an optional unit suffix.
import { Input } from "@/components/ui/input";
import { ChevronUp, ChevronDown } from "lucide-react";

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  placeholder,
}: {
  value?: number;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  placeholder?: string;
}) {
  const bump = (delta: number) => {
    const base = typeof value === "number" ? value : 0;
    let n = base + delta;
    if (typeof min === "number") n = Math.max(min, n);
    if (typeof max === "number") n = Math.min(max, n);
    // Round to avoid float drift (e.g. 0.05 stepping).
    const decimals =
      step < 1 ? Math.max(0, Math.min(4, String(step).split(".")[1]?.length ?? 2)) : 0;
    onChange(Number(n.toFixed(decimals)));
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Input
          type="number"
          value={value ?? ""}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              bump(e.shiftKey ? step * 10 : step);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              bump(e.shiftKey ? -step * 10 : -step);
            }
          }}
          className="h-8 text-xs pr-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
      {suffix && <span className="text-[10px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}
