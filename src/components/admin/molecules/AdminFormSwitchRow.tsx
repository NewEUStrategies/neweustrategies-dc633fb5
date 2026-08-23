// Molekuła: opisany PRZEŁĄCZNIK w formularzu panelu.
//
// PO CO. Wiersz `Label + Switch` w ramce jest w panelu przeklejony kilkanaście
// razy i każda kopia miała własne odstępy. Ważniejsze: przełącznik bez
// `htmlFor`/`id` nie daje się kliknąć etykietą, a przełącznik bez podpowiedzi
// zmusza redaktora do zgadywania, co się stanie - „Zasada Chatham House" nie
// wyjaśnia się sama.
//
// PRZEŁĄCZNIK MA DOSTĘPNĄ NAZWĘ. `Switch` nie ma treści, więc bez powiązania
// z etykietą czytnik ekranu przy sześciu wierszach mówi sześć razy to samo.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać stan i oddać zmianę. Molekuła nie zna słownika
// i nie wie, co przełącznik włącza.
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function AdminFormSwitchRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  id?: string;
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const reactId = useId();
  const fieldId = id ?? reactId;
  const hintId = hint === undefined ? undefined : `${fieldId}-hint`;

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2",
        className,
      )}
    >
      <div className="min-w-0">
        <Label htmlFor={fieldId} className="text-sm">
          {label}
        </Label>
        {hintId === undefined ? null : (
          <p id={hintId} className="mt-1 text-xs leading-snug text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <Switch
        id={fieldId}
        checked={checked}
        disabled={disabled}
        aria-describedby={hintId}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
