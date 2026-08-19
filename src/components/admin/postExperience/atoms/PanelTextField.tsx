import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PanelTextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

/**
 * Atom: pole tekstowe panelu z powiązaną etykietą.
 *
 * CO SCALIŁ. Sześć kopii pary `<Label>` + `<Input>` w panelach ToC i sekcji
 * „dowiesz się", z których ŻADNA nie wiązała etykiety z polem - `<Label>` bez
 * `htmlFor` stojąca nad `<Input>` bez `id` jest dla czytnika ekranu polem bez
 * nazwy. Atom domyka to jednym `useId`.
 */
export function PanelTextField({
  label,
  value,
  onChange,
  placeholder,
  className,
  inputClassName = "h-9",
}: PanelTextFieldProps) {
  const inputId = useId();
  return (
    <div className={className}>
      <Label htmlFor={inputId} className="text-xs">
        {label}
      </Label>
      <Input
        id={inputId}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputClassName}
      />
    </div>
  );
}
