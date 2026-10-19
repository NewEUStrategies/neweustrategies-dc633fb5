// Atom: podpowiedź „co to znaczy" przy polu formularza panelu monetyzacji.
//
// DLACZEGO WŁASNY ATOM, a nie `post-editor/atoms/InfoHint`. Tamten jest ikoną
// 14 px - poniżej celu 24 px z WCAG 2.2 (SPEC §6.8) - i nie wiąże treści
// z polem, którego dotyczy. Tutaj (1) przycisk ma cel 24 px, (2) ten sam tekst
// leży w DOM jako `sr-only` z `id`, więc pole wskazuje go przez
// `aria-describedby` - czytnik przeczyta wyjaśnienie razem z przełącznikiem,
// a nie dopiero po najechaniu myszą na ikonę, której nie widzi.
//
// Użycie: `const hintId = useId()`; pole dostaje `aria-describedby={hintId}`,
// atom - `id={hintId}`. Wspólny dla paywalla, cennika i członkostwa (ten sam
// katalog co `LabeledField`, który oba panele już dzielą).
import { Info } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function HintTooltip({
  id,
  text,
  label,
}: {
  /** Identyfikator opisu - cel `aria-describedby` pola. */
  id: string;
  /** Treść podpowiedzi (już przetłumaczona). */
  text: string;
  /** Dostępna nazwa przycisku („Co znaczy …?"). */
  label: string;
}) {
  return (
    <>
      <span id={id} className="sr-only">
        {text}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{text}</TooltipContent>
      </Tooltip>
    </>
  );
}
