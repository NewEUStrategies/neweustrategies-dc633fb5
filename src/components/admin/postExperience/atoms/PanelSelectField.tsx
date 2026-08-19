import { useId } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface PanelSelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

interface PanelSelectFieldProps {
  label: string;
  value: string;
  options: readonly PanelSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Atom: lista rozwijana panelu z powiązaną etykietą.
 *
 * CO SCALIŁ I CO NAPRAWIŁ. Siedem list rozwijanych w panelach modułu (układ
 * ToC, dolny i górny poziom nagłówka, pozycja rekomendacji, układ, liczba
 * kolumn, źródło doboru) miało etykietę postawioną OBOK kontrolki, bez
 * `htmlFor` i bez `aria-label`. Radix renderuje wyzwalacz jako `role="combobox"`
 * i przy braku powiązania czytnik ekranu ogłasza wyłącznie aktualną wartość -
 * użytkownik słyszy „H3", nie wiedząc, czy to poziom dolny czy górny. Atom
 * wiąże etykietę z wyzwalaczem przez `htmlFor`/`id`.
 */
export function PanelSelectField({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: PanelSelectFieldProps) {
  const triggerId = useId();
  return (
    <div className={className}>
      <Label htmlFor={triggerId} className="text-xs">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={triggerId} aria-label={label} className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
