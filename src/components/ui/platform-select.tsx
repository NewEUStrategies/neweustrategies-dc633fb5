// PlatformSelect - wspólny atom listy rozwijanej: natywny <select> ze
// wspólną osią pól formularza (`.platform-field`) i tokenami motywu.
//
// Natywny element jest kontraktem, nie detalem: FormData niesie wybraną
// wartość (także pusty łańcuch, bez sentineli), `required` i `disabled`
// działają jak w przeglądarce, <label htmlFor> i etykieta-otoczka wskazują
// dokładnie jedną kontrolkę, a `onChange` dostaje prawdziwe
// ChangeEvent<HTMLSelectElement> (target.value, currentTarget.selectedIndex).
// Opcje (<option>, <optgroup>, fragmenty, mapowane tablice) renderują się
// bez zmian, więc `select.options` działa bez otwierania listy.
//
// Wygląd: strzałka rysowana w currentColor (`.platform-select` w
// styles.css), lista systemowa dziedziczy motyw przez `color-scheme`.
// Geometria jest wspólna dla jasnego i ciemnego motywu.

import * as React from "react";
import { cn } from "@/lib/utils";

type PlatformSelectProps = React.ComponentPropsWithoutRef<"select"> & {
  /** Pierwsza, niewybieralna pozycja `value=""` - pomijana, gdy dzieci już ją mają. */
  placeholder?: string;
};

function hasEmptyOption(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) return false;
    if (child.type === "option") {
      const value = (child.props as { value?: unknown }).value;
      return value != null && String(value) === "";
    }
    if (child.type === React.Fragment || child.type === "optgroup") {
      return hasEmptyOption((child.props as { children?: React.ReactNode }).children);
    }
    return false;
  });
}

export const PlatformSelect = React.forwardRef<HTMLSelectElement, PlatformSelectProps>(
  function PlatformSelect({ className, placeholder, children, ...props }, ref) {
    const showPlaceholder = placeholder !== undefined && !hasEmptyOption(children);
    return (
      <select
        ref={ref}
        data-slot="platform-select"
        className={cn(
          "platform-field platform-select w-full min-w-0 cursor-pointer appearance-none border border-input bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
          className,
        )}
        {...props}
      >
        {showPlaceholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {children}
      </select>
    );
  },
);
PlatformSelect.displayName = "PlatformSelect";
