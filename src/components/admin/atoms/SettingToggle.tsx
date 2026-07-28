import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface SettingToggleProps {
  label: string;
  /** Krótkie wyjaśnienie pod etykietą (opcjonalne). */
  hint?: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Atom: przełącznik ustawienia w obramowanym wierszu. Całość jest `<label>`,
 * więc kliknięcie w tekst przełącza wartość, a czytnik ekranu wiąże opis z
 * kontrolką. Responsywny: na wąskich ekranach etykieta zawija się bez
 * spychania przełącznika poza kartę.
 */
export function SettingToggle({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: SettingToggleProps) {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="shrink-0"
      />
    </label>
  );
}
