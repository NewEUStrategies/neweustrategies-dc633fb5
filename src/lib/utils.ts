import { clsx, type ClassValue } from "clsx";
import { useRef } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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
// zrobi `preventDefault()`, hook niczego nie rusza. Nie są celem: element
// odpięty od DOM (np. pozycja menu, które się zamknęło) ani <body> - klik
// myszą w Safari nie ogniskuje przycisku, więc „otwierającym" bywa <body>,
// a wtedy właściwym celem jest `Trigger` Radiksa. W obu przypadkach zostaje
// domyślne zachowanie biblioteki.
//
// DLACZEGO TUTAJ, A NIE W OSOBNYM MODULE ANI W `dialog.tsx` (2026-10-03):
// - nowy moduł, choćby 0,6 KB, staje się małym chunkiem, który Rollup
//   (`experimentalMinChunkSize`) dokleja według rozmiarów innych chunków;
//   to przestawiało kolejne scalenia i do domknięcia startowego KAŻDEJ strony
//   wchodziły obce chunki (pomocnicy date-fns albo całe `vendor-lucide`,
//   +5 do +18 KB gz, zmierzone `check:bundle`). Ten plik jest już w chunku
//   wejściowym i importują go wszystkie trzy prymitywy, więc graf modułów
//   zostaje taki jak bez hooka, a jedyny przyrost ląduje w chunku, którego
//   rozmiar nie wpływa na decyzje scalania;
// - eksport z `dialog.tsx` wywracał 66 plików testowych, które zastępują
//   `@/components/ui/dialog` atrapą (`Sheet` i `AlertDialog` importowały hook
//   z atrapy); tego modułu nie atrapuje żaden test.

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
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
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
