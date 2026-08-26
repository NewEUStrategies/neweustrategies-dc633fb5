// Molekuła: opisana DROPLISTA wartości ze zbioru zamkniętego.
//
// PO CO. Enum w tym repo ma trzy kawałki żyjące osobno: tablicę `as const`
// (zbiór), mapę `Record<Enum, string>` (klucze i18n) i droplistę (widok). Sklejone
// ręcznie w formularzu, rozjeżdżają się w jedną stronę, której nie widać:
// dopisany wariant enuma dostaje typ i klucz, ale NIE pojawia się w dropliście,
// bo tablica opcji była wypisana z ręki. Ta molekuła buduje opcje Z TABLICY
// ENUMA, więc nowy wariant jest w UI natychmiast albo nie kompiluje się wcale.
//
// OPCJE SĄ TŁUMACZONE PRZEZ WYWOŁUJĄCEGO. Molekuła przyjmuje gotową funkcję
// `labelFor`, a nie klucz i18n: klucze każdego modułu mieszkają w innym pliku
// nakładki, a molekuła w `admin/molecules` nie ma prawa o nich wiedzieć (ta sama
// granica co `AdminCatalogRow`).
//
// UŻYWAMY `FormSelect`, NIE natywnego `<select>`. Natywna droplista rysuje
// systemowy popup niezgodny z layoutem panelu; `FormSelect` bierze popup,
// klawiaturę, focus-ring i promień 6 px z naszych tokenów.
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { FormSelect } from "@/components/atoms/FormSelect";
import { cn } from "@/lib/utils";

export function AdminFormEnumRow<T extends string>({
  id,
  label,
  value,
  options,
  labelFor,
  onValueChange,
  hint,
  disabled,
  className,
  placeholder,
}: {
  id?: string;
  label: string;
  value: T;
  /** Zbiór wartości - tablica enuma, nie ręcznie wypisane opcje. */
  options: readonly T[];
  /** Gotowa etykieta wariantu; wywołujący ma `t()`, molekuła nie. */
  labelFor: (option: T) => string;
  onValueChange: (value: T) => void;
  hint?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Tekst zastępczy dla stanu „nic nie wybrano". Bez niego pusta wartość rysuje
   * PUSTY przycisk - kontrolka wygląda na zepsutą, choć droplista ma opcje.
   */
  placeholder?: string;
}) {
  const reactId = useId();
  const fieldId = id ?? reactId;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={fieldId}>{label}</Label>
      <FormSelect
        id={fieldId}
        value={value}
        options={options.map((option) => ({ value: option, label: labelFor(option) }))}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        // Zawężenie z powrotem do enuma: `FormSelect` jest generyczny po stringu,
        // ale droplista nie ma jak oddać wartości spoza `options`.
        onValueChange={(next) => onValueChange(next as T)}
      />
      {hint === undefined ? null : (
        <p className="text-xs leading-snug text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
