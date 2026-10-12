// TimeInput - wspólny atom godziny: natywny <input type="time">.
//
// Wartość to lokalny łańcuch "HH:mm" ("HH:mm:ss" przy step < 60), a pusty
// łańcuch oznacza brak godziny - atom nigdy nie wymyśla północy. `min`,
// `max`, `step` i `required` korzystają z natywnej walidacji, wyłączone pole
// nie trafia do FormData, `onChange` dostaje prawdziwe ChangeEvent, a
// etykieta wskazuje dokładnie to jedno pole. Geometria pochodzi ze wspólnej
// osi `.platform-field` i jest identyczna w obu motywach.

import * as React from "react";
import { cn } from "@/lib/utils";

type TimeInputProps = Omit<React.ComponentPropsWithoutRef<"input">, "type"> & {
  type?: "time";
};

export const TimeInput = React.forwardRef<HTMLInputElement, TimeInputProps>(function TimeInput(
  { className, type: _type, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type="time"
      data-slot="platform-time"
      className={cn(
        "platform-field w-full min-w-0 border border-input bg-background text-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
});
TimeInput.displayName = "TimeInput";
