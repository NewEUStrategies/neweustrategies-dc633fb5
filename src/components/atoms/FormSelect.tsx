// FormSelect - atom listy rozwijanej dla formularzy PUBLICZNYCH (newsletter,
// "Dołącz do nas", formularze kontaktowe budowane w CMS).
//
// Zamiast natywnego <select> (który na macOS/Windows rysuje systemowy popup
// niezgodny z layoutem serwisu) używamy Radix Select z shadcn - dzięki temu
// popup, klawiatura, focus-ring, light/dark i zaokrąglenie (--radius = 6px)
// pochodzą z naszych design tokenów.
//
// Komponent jest kontrolowany i celowo bez `any`: pusta wartość ("") oznacza
// brak wyboru i renderuje placeholder.

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface FormSelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface FormSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly FormSelectOption[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  /** Komunikat błędu (już przetłumaczony) - wiąże aria-invalid/aria-describedby. */
  error?: string | null;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  "aria-label"?: string;
  "data-edit-target"?: string;
}

export function FormSelect({
  value,
  onValueChange,
  options,
  placeholder,
  required,
  disabled,
  name,
  error,
  id,
  className,
  style,
  "aria-label": ariaLabel,
  "data-edit-target": editTarget,
}: FormSelectProps) {
  // Radix nie akceptuje pustego stringa jako wartości itemu - pusty stan
  // odwzorowujemy przez `undefined` (trigger pokaże placeholder).
  const current = value === "" ? undefined : value;
  const reactId = React.useId();
  const triggerId = id ?? reactId;
  const errorId = error ? `${triggerId}-err` : undefined;

  return (
    <>
      <Select value={current} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id={triggerId}
          aria-label={ariaLabel}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={cn("w-full", error && "border-destructive", className)}
          style={style}
          data-edit-target={editTarget}
        >
          <SelectValue placeholder={placeholder ?? ""} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p id={errorId} className="mt-1.5 pl-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {/* Wartość dla formularzy wysyłanych natywnie (FormData). */}
      {name ? <input type="hidden" name={name} value={value} /> : null}
    </>
  );
}

export default FormSelect;
