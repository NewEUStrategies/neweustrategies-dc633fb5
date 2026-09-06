import type { ReactNode } from "react";

// Test adapter for the control boundary. Route tests exercise values/events;
// Radix focus, positioning and keyboard behavior remain its own concern.
export function Select({
  value,
  onValueChange,
  children,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  );
}
export function SelectContent({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
export function SelectItem({ value, children }: { value: string; children: ReactNode }) {
  return <option value={value}>{children}</option>;
}
export function SelectTrigger() {
  return null;
}
export function SelectValue() {
  return null;
}
