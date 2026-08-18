// Atom: wiersz pola formularza - etykieta (wersaliki, wyciszona) + kontrolka,
// opcjonalnie z podpowiedzią `InfoHint` i znacznikiem braku wymaganego do
// publikacji.
//
// PO CO ATOM, A NIE LOKALNY HELPER W KAŻDEJ KARCIE. Dokładnie ten sam kształt
// („uppercase tracking-wide text-muted-foreground" + kontrolka pod nim) był
// wpisany trzy razy niezależnie: jako `FieldRow` w
// components/profile/CompanyPickerDialog, jako `Field` w dialogu organizacji
// i jako `FieldBlock` w karcie oznaczenia komercyjnego. Trzy kopie tego samego
// wiersza rozjeżdżają się przy pierwszej zmianie gęstości formularza, a żadna
// bramka tego nie widzi - to nie jest defekt typów ani i18n. Atom zamyka klasę.
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { InfoHint } from "./InfoHint";

export function FieldRow({
  label,
  hint,
  missing = false,
  htmlFor,
  children,
}: {
  label: string;
  /** Treść dymka „?" - podawaj gotowy tekst z `t()`, nie klucz. */
  hint?: string;
  /**
   * Pole wymagane do publikacji, którego brakuje. Podświetlamy ETYKIETĘ, nie
   * blokujemy pisania: wersja robocza ma prawo być niekompletna, a redaktor
   * potrzebuje widzieć, czego dobrać przed publikacją.
   */
  missing?: boolean;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label
        htmlFor={htmlFor}
        className={`inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide ${
          missing ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {label}
        {missing && <span aria-hidden="true">*</span>}
        {hint && <InfoHint text={hint} />}
      </Label>
      {children}
    </div>
  );
}
