// Atom: akcja wyłączona Z POWODEM, który da się przeczytać.
//
// DLACZEGO. Wyłączony przycisk bez wyjaśnienia wygląda jak usterka - redaktor
// nie wie, czy brakuje mu uprawnień, czy plan jest w złym stanie. Radix nie
// pokaże podpowiedzi na `disabled` (przycisk nie dostaje zdarzeń wskaźnika ani
// fokusu), więc owijamy go w fokusowalny `span`, który niesie podpowiedź
// i `aria-describedby` do tekstu `sr-only` (czytnik słyszy powód przy fokusie,
// nie tylko po najechaniu). `reason === null` = akcja dostępna, atom znika.
//
// Wspólny dla organizmów paywalla, cennika i członkostwa - także w trybie
// `readOnly` huba (S7), gdzie KAŻDY przycisk zapisu jest wyłączony z tym
// samym powodem.
import { useId, type ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function DisabledReason({
  reason,
  children,
}: {
  /** Powód (przetłumaczony) albo `null`, gdy akcja jest dostępna. */
  reason: string | null;
  /** Przycisk - przy `reason !== null` wołający podaje go z `disabled`. */
  children: ReactNode;
}) {
  const id = useId();
  if (reason === null) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-describedby={id} className="inline-flex rounded-[6px]">
          {children}
          <span id={id} className="sr-only">
            {reason}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{reason}</TooltipContent>
    </Tooltip>
  );
}
