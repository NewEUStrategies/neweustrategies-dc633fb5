// Atom: per-device responsive text input. Edits the currently selected device's
// value while always showing it as a flat input (no extra device picker — the
// builder toolbar owns the device switch).
import type { Device, ResponsiveValue } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";

interface Props {
  value: ResponsiveValue<string> | undefined;
  device: Device;
  onChange: (next: ResponsiveValue<string>) => void;
  placeholder?: string;
  type?: "text" | "number";
}

export function ResponsiveInput({ value, device, onChange, placeholder, type = "text" }: Props) {
  const cur = value?.[device] ?? "";
  return (
    <Input
      type={type}
      value={cur}
      placeholder={placeholder}
      className="h-8 text-xs"
      onChange={(e) => onChange({ ...(value ?? {}), [device]: e.target.value || undefined })}
    />
  );
}
