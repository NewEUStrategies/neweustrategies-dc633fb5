// Molekuła: JEDEN wiersz przełącznika rodzaju powiadomień (etykieta + Switch).
//
// Wydzielona z NotificationsCenter, bo po domknięciu katalogu (08.2026) ten sam
// wiersz renderuje się szesnaście razy w czterech sekcjach PLUS raz w wariancie
// always-on dla alertów bezpieczeństwa. Wariant `alwaysOn` nie jest osobnym
// komponentem celowo: to ten sam wiersz z zablokowanym Switchem i przerywaną
// ramką, więc rozjazd wyglądu między „przełączalny" i „zawsze włączony" jest
// niemożliwy.
//
// i18n: komponent NIE zna tekstów - dostaje gotową etykietę od organizmu, który
// czyta `notifications.settings.kinds.<kind>` (PL/EN, parytet pilnuje
// src/lib/notifications/__tests__/preferences.test.ts).
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { NotificationKind } from "@/lib/notifications/preferences";

export interface NotificationKindToggleProps {
  kind: NotificationKind;
  label: string;
  checked: boolean;
  /** Zapis w toku - blokuje interakcję, ale nie zmienia stanu wizualnego. */
  disabled?: boolean;
  /**
   * Rodzaj docierający ZAWSZE (baza omija dla niego bramkę preferencji).
   * Renderuje się jako wyszarzony, nieinteraktywny wiersz - użytkownik widzi,
   * że kanał istnieje i że nie da się go wyłączyć.
   */
  alwaysOn?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function NotificationKindToggle({
  kind,
  label,
  checked,
  disabled = false,
  alwaysOn = false,
  onCheckedChange,
}: NotificationKindToggleProps) {
  const id = `notif-kind-${kind}`;
  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2",
        alwaysOn ? "border-dashed border-border/60 opacity-70" : "border-border/60",
      )}
    >
      <Label
        htmlFor={alwaysOn ? undefined : id}
        className="min-w-0 text-sm font-normal leading-snug"
      >
        {label}
      </Label>
      <Switch
        {...(alwaysOn ? {} : { id })}
        checked={checked}
        disabled={alwaysOn || disabled}
        aria-label={label}
        {...(alwaysOn || !onCheckedChange ? {} : { onCheckedChange })}
      />
    </div>
  );
}
