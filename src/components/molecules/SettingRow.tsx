// Molecule: jeden wiersz ustawienia - etykieta, podpowiedź i miejsce na
// kontrolkę (przełącznik, select, przycisk).
//
// PO CO OSOBNY KOMPONENT. Hub prywatności (§10 audytu IA) ma dziewięć takich
// wierszy, a przed konsolidacją każdy był ręcznie sklejonym `div`-em z tym
// samym zestawem klas - i te zestawy zdążyły się rozjechać (raz `gap-3`, raz
// `gap-2`, raz podpowiedź `text-xs`, raz `text-[11px]`). Jeden wiersz = jedno
// miejsce na siatkę, odstępy i separator.
//
// RESPONSYWNOŚĆ. Do `sm` treść i kontrolka układają się w pion (kontrolka pod
// opisem, wyrównana do lewej), od `sm` w poziom z kontrolką po prawej - te same
// progi, co reszta paneli profilu.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SettingRowProps {
  label: string;
  hint?: string;
  /** Dodatkowa nota pod podpowiedzią (mniejsza, przygaszona). */
  note?: ReactNode;
  /** Kontrolka: przełącznik, select, przycisk. */
  control: ReactNode;
  /**
   * Szerokość kolumny kontrolki od `sm`. `auto` pasuje do przełączników,
   * `wide` do selectów, które potrzebują miejsca na najdłuższą etykietę.
   */
  controlWidth?: "auto" | "wide";
  /** Pierwszy wiersz w sekcji nie rysuje górnej linii. */
  first?: boolean;
  className?: string;
  children?: ReactNode;
}

export function SettingRow({
  label,
  hint,
  note,
  control,
  controlWidth = "auto",
  first = false,
  className,
  children,
}: SettingRowProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start",
        !first && "border-t border-border/40 pt-3",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{label}</p>
        {hint !== undefined && (
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p>
        )}
        {note}
        {children}
      </div>
      <div
        className={cn(
          "shrink-0 sm:pt-0.5",
          controlWidth === "wide" ? "w-full sm:w-64" : "sm:w-auto",
        )}
      >
        {control}
      </div>
    </div>
  );
}
