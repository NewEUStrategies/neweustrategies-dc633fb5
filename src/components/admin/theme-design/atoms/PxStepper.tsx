// Atom: thin wrapper over the shared StepperInput that guarantees a defined
// CSS length value (falls back to `${min}px` when cleared) - Theme Design
// tokens must never be `undefined` or the serialized CSS breaks.
import { StepperInput } from "@/components/admin/builder/ui/atoms";

export function PxStepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 999,
}: {
  value: string;
  onChange: (value: string) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <StepperInput
      value={value}
      onChange={(next) => onChange(next ?? `${min}px`)}
      step={step}
      min={min}
      max={max}
    />
  );
}
