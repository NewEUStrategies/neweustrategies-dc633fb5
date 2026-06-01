// Atom: numeric input with optional unit suffix.
import { Input } from "@/components/ui/input";

export function NumberInput({ value, onChange, min, max, step = 1, suffix }: { value?: number; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        value={value ?? ""}
        min={min} max={max} step={step}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className="h-8 text-xs"
      />
      {suffix && <span className="text-[10px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}
