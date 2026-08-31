// Atom: pojedynczy limit liczbowy warstwy (bilety w cenie, zniżka procentowa).
// Zero jest stanem „brak świadczenia" i tak jest opisane, żeby nikt nie musiał
// zgadywać, czy puste pole to zero, czy brak decyzji.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LimitField({
  id,
  label,
  value,
  max = 9999,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  max?: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className="space-y-1 font-sans">
      <Label htmlFor={id} className="text-[10px] font-medium">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        max={max}
        inputMode="numeric"
        className="h-9 rounded-[6px] tabular-nums"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}
