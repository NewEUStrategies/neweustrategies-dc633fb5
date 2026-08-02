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
  className,
  style,
  "aria-label": ariaLabel,
  "data-edit-target": editTarget,
}: FormSelectProps) {
  // Radix nie akceptuje pustego stringa jako wartości itemu - pusty stan
  // odwzorowujemy przez `undefined` (trigger pokaże placeholder).
  const current = value === "" ? undefined : value;

  return (
    <>
      <Select value={current} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          aria-label={ariaLabel}
          aria-required={required || undefined}
          className={cn("w-full", className)}
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
      {/* Wartość dla formularzy wysyłanych natywnie (FormData). */}
      {name ? <input type="hidden" name={name} value={value} /> : null}
    </>
  );
}

export default FormSelect;
