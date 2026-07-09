// Atom: numeric input with stepper arrows and an optional unit suffix.
import { Input } from "@/components/ui/input";
import { StepperButtons } from "./StepperButtons";

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
        <StepperButtons onIncrement={() => bump(step)} onDecrement={() => bump(-step)} />
      </div>
      {suffix && <span className="text-[10px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}
