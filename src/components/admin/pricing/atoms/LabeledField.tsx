// Atom: pole formularza z etykietą FAKTYCZNIE z nim powiązaną.
//
// DEFEKT, KTÓRY TEN ATOM NAPRAWIA. W panelach cennika i członkostwa 42 pola
// stały w układzie `<Label>Nazwa PL</Label><Input />` - etykieta obok pola,
// ale bez `htmlFor`, bez `id` i bez zagnieżdżenia. Dla osoby widzącej wygląda
// to poprawnie; dla czytnika ekranu to 42 pola BEZ NAZWY, w formularzach,
// w których redakcja ustawia ceny, benefity i wygaśnięcie dostępu. Widać to
// było wprost w testach: pól nie dało się znaleźć po etykiecie, tylko po
// wpisanej wartości albo po pozycji na liście.
//
// Etykieta i pole dostają wspólny, stabilny identyfikator z `useId`. Podpowiedź
// (`hint`) jest podłączona przez `aria-describedby`, więc czytnik przeczyta ją
// PO nazwie pola, a nie jako osobny, niepowiązany akapit.
import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

export function LabeledField({
  label,
  hint,
  className,
  labelClassName,
  children,
}: {
  /** Tekst etykiety; może zawierać ikonę dekoracyjną obok napisu. */
  label: ReactNode;
  /** Zdanie pod polem - trafia do `aria-describedby`, nie tylko na ekran. */
  hint?: string;
  className?: string;
  /** Dodatkowe klasy dla etykiety (np. zmniejszenie czcionki w kompaktowym oknie). */
  labelClassName?: string;
  /** Pole formularza; dostaje `id` (i `aria-describedby`, gdy jest podpowiedź). */
  children: (props: { id: string; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={className}>
      <Label className={cn("text-[10px] font-medium", labelClassName)} htmlFor={id}>
        {label}
      </Label>
      {children(hint ? { id, "aria-describedby": hintId } : { id })}
      {hint ? (
        <p id={hintId} className="mt-1 text-[10px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
