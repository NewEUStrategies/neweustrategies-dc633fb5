// Atom: thin wrapper over the shared NumberInput that guarantees a defined
// numeric value (falls back to `min` when cleared).
import { NumberInput } from "@/components/admin/builder/ui/atoms";

export function NumStepper({
  value,
  onChange,
  step = 100,
  min = 0,
  max = 9999,
}: {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <NumberInput
      value={value}
      onChange={(next) => onChange(next ?? min)}
      step={step}
      min={min}
      max={max}
    />
  );
}
