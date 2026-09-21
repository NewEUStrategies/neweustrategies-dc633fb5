/**
 * Atom: chip, który JEST przyciskiem - wyzwalacz dymka osiągalny z klawiatury.
 *
 * PO CO OSOBNY ATOM. `Badge` renderuje `div`, a `TooltipTrigger asChild` tylko
 * go klonuje - nie dokłada ani `tabindex`, ani roli. Chip zbudowany na `Badge`
 * jest więc niewidoczny dla klawiatury i dla czytnika ekranu, a w warstwie
 * semantycznej pod dymkami chipów siedzi treść, której NIE MA nigdzie indziej
 * w drzewie (bramka zgody, ziarno tożsamości, tryb deduplikacji, opóźnienie,
 * zastrzeżenia strumienia). Dlatego wyzwalacz jest prawdziwym `button
 * type="button"` - fokus, rola i `aria-describedby` Radiksa dojeżdżają wtedy
 * bez dokładania atrybutów ręcznie.
 *
 * Wygląd jest ZGODNY z `Badge variant="outline"`: te same klasy bazowe, żeby
 * chip w panelu nie różnił się od pozostałych odznak. `Badge` nie eksportuje
 * swojego `cva`, a plik `components/ui` należy do wspólnego designu, więc klasy
 * są tu powtórzone świadomie - w jednym miejscu, nie w każdym wywołaniu.
 */
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Klasy bazowe `Badge variant="outline"` - patrz `src/components/ui/badge.tsx`. */
const CHIP_BASE =
  "inline-flex items-center rounded-[6px] border px-2.5 py-0.5 text-xs font-semibold " +
  "text-foreground transition-colors focus:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:ring-offset-2";

export const ChipButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function ChipButton({ className, ...props }, ref) {
    return <button ref={ref} type="button" className={cn(CHIP_BASE, className)} {...props} />;
  },
);
