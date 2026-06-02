// Atom: per-device responsive size input. Wraps StepperInput so the
// currently selected device's value gets px/rem/em/% arrows for free.
import type { Device, ResponsiveValue } from "@/lib/builder/types";
import { StepperInput } from "./StepperInput";

interface Props {
  value: ResponsiveValue<string> | undefined;
  device: Device;
  onChange: (next: ResponsiveValue<string>) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}

export function ResponsiveInput({ value, device, onChange, placeholder, min, max, step }: Props) {
  const cur = value?.[device];
  return (
    <StepperInput
      value={cur}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      onChange={(next) => onChange({ ...(value ?? {}), [device]: next })}
    />
  );
}
