// Molekuły: opisane pola formularzy NABORU po stronie uczestnika (zgłoszenie,
// profil prelegenta, materiał, ocena recenzenta).
//
// WŁASNE, NIE Z PANELU. Strona zgłoszenia jest publiczna, a do jej chunku nie
// wolno wnosić molekuł panelu (`AdminFormTextRow` ciągnie słownik i style
// studia). Tu stoją dwa proste pola z etykietą, podpowiedzią i błędem -
// dokładnie tyle, ile potrzebują cztery formularze naboru.
//
// BŁĄD JEST POWIĄZANY Z POLEM (`aria-describedby` + `aria-invalid`), więc
// czytnik ekranu odczyta go razem z etykietą, a nie jako osobny komunikat.
import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function describedBy(ids: Array<string | null>): string | undefined {
  const joined = ids.filter((id): id is string => id !== null).join(" ");
  return joined === "" ? undefined : joined;
}

export function CfpTextField({
  label,
  value,
  onChange,
  hint,
  error = null,
  rows,
  maxLength,
  type = "text",
  required = false,
  readOnly = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  hint?: string;
  error?: string | null;
  /** Liczba wierszy = pole wielowierszowe. */
  rows?: number;
  maxLength?: number;
  type?: "text" | "email" | "url";
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const hintId = hint === undefined ? null : `${id}-hint`;
  const errorId = error === null ? null : `${id}-error`;
  const common = {
    id,
    value,
    maxLength,
    required,
    readOnly,
    placeholder,
    "aria-invalid": error !== null ? true : undefined,
    "aria-describedby": describedBy([hintId, errorId]),
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </Label>
      {rows === undefined ? (
        <Input {...common} type={type} onChange={(event) => onChange?.(event.target.value)} />
      ) : (
        <Textarea {...common} rows={rows} onChange={(event) => onChange?.(event.target.value)} />
      )}
      {errorId === null ? null : (
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {hintId === null ? null : (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function CfpSelectField<T extends string>({
  label,
  value,
  options,
  labelFor,
  onChange,
  placeholder,
  error = null,
  required = false,
}: {
  label: string;
  /** `""` = nic nie wybrano (pokazuje `placeholder`). */
  value: T | "";
  options: readonly T[];
  labelFor: (option: T) => string;
  onChange: (value: T) => void;
  placeholder?: string;
  error?: string | null;
  required?: boolean;
}) {
  const id = useId();
  const errorId = error === null ? null : `${id}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </Label>
      <Select
        value={value === "" ? undefined : value}
        onValueChange={(next) => {
          const found = options.find((option) => option === next);
          if (found !== undefined) onChange(found);
        }}
      >
        <SelectTrigger
          id={id}
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={describedBy([errorId])}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {labelFor(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {errorId === null ? null : (
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
