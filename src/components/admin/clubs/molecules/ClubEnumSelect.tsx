// Molekuła: droplista nad słownikiem domkniętym CHECK-iem w bazie.
//
// Generyczna po to, żeby ISTNIAŁA JEDNA implementacja dla wszystkich sześciu
// słowników klubu. Alternatywą jest sześć niemal identycznych komponentów,
// z których pięć prędzej czy później rozjedzie się z bazą przy dodaniu wartości
// do CHECK-a. Tablica `options` pochodzi zawsze z src/lib/clubs/types.ts, więc
// zmiana CHECK-a w migracji ma dokładnie jedno miejsce do poprawienia po
// stronie klienta.
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface ClubEnumSelectProps<T extends string> {
  label?: string;
  value: T;
  options: readonly T[];
  /** Prefiks klucza i18n; etykieta powstaje jako `${i18nPrefix}.${wartość}`. */
  i18nPrefix: string;
  /** Opcjonalny prefiks podpowiedzi pod dropListą (to samo złożenie klucza). */
  hintPrefix?: string;
  onChange: (value: T) => void;
  disabled?: boolean;
  id?: string;
}

export function ClubEnumSelect<T extends string>({
  label,
  value,
  options,
  i18nPrefix,
  hintPrefix,
  onChange,
  disabled,
  id,
}: ClubEnumSelectProps<T>) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5">
      {label ? (
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
      ) : null}
      <Select
        value={value}
        onValueChange={(next) => {
          // Radix oddaje string; zawężamy po tablicy słownika, więc do
          // onChange nigdy nie trafi wartość spoza CHECK-a.
          if ((options as readonly string[]).includes(next)) onChange(next as T);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {t(`${i18nPrefix}.${option}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hintPrefix ? (
        <p className="text-xs text-muted-foreground">{t(`${hintPrefix}.${value}`)}</p>
      ) : null}
    </div>
  );
}
