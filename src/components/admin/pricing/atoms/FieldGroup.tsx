// Atom: grupa pól formularza z nagłówkiem i kolorowym znacznikiem.
//
// Kontrakt dostępności: to `<fieldset>` z `<legend>`, nie `<div>` z akapitem.
// Formularz warstwy ma cztery takie grupy po kilka pól każda; bez legendy
// czytnik czyta dwadzieścia pól jako jedną płaską listę i nie da się usłyszeć,
// że „Link kontaktowy" należy do „Przycisku zakupu", a nie do „Ceny".
// Znacznik i ikona są dekoracją (`aria-hidden`) - nazwę nosi tekst legendy.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function FieldGroup({
  icon: Icon,
  title,
  accent,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** Klasa tła kropki - tonacja grupy, wyłącznie dekoracyjna. */
  accent: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="rounded-md border border-border/60 bg-card/60 p-3">
      <legend className="mb-2 flex items-center gap-2 px-1">
        <span className={`h-1.5 w-1.5 rounded-full ${accent}`} aria-hidden="true" />
        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
      </legend>
      {children}
    </fieldset>
  );
}
