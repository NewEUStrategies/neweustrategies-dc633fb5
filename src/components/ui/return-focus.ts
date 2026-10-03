// Powrót ogniska po zamknięciu okna modalnego (Dialog, Sheet, AlertDialog).
//
// Radix po zamknięciu oddaje ognisko WYŁĄCZNIE swojemu `Trigger`. Większość
// okien w tym repozytorium jest sterowana propem `open` (przycisk w panelu,
// skrót klawiszowy, host globalnych okien) i żadnego `Trigger` nie ma - wtedy
// ognisko lądowało na <body>, a użytkownik klawiatury i czytnika ekranu wracał
// na początek strony (WCAG 2.4.3). Ten hook zapamiętuje element, który miał
// ognisko w chwili otwarcia, i oddaje mu je przy zamknięciu.
//
// Pierwszeństwo ma wywołujący: jego `onCloseAutoFocus` biegnie pierwszy i jeśli
// zrobi `preventDefault()`, hook niczego nie rusza. Element odpięty od DOM
// (np. pozycja menu, które się zamknęło) nie jest celem - wtedy zostaje
// domyślne zachowanie Radiksa.
import { useRef } from "react";

type FocusHandler = (event: Event) => void;

export function useReturnFocus(
  onOpenAutoFocus: FocusHandler | undefined,
  onCloseAutoFocus: FocusHandler | undefined,
): { onOpenAutoFocus: FocusHandler; onCloseAutoFocus: FocusHandler } {
  const openerRef = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event) => {
      // Zdarzenie montowania przychodzi, zanim Radix przeniesie ognisko do okna.
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement ? active : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event);
      const opener = openerRef.current;
      openerRef.current = null;
      if (event.defaultPrevented || !opener?.isConnected) return;
      event.preventDefault();
      opener.focus();
    },
  };
}
