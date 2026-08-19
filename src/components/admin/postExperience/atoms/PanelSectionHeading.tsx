import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Trzy warianty wizualne nagłówka sekcji panelu, które istniały w czterech
 * plikach tras jako kopiowane łańcuchy klas:
 * - `eyebrow`  - mała kapitalizowana etykieta grupy pól,
 * - `display`  - nagłówek sekcji pisany krojem nagłówkowym,
 * - `field`    - podpis grupy pól tuż nad kontrolkami.
 */
export type PanelHeadingTone = "eyebrow" | "display" | "field";

interface PanelSectionHeadingProps {
  children: ReactNode;
  /** Poziom nagłówka w drzewie dokumentu. Domyślnie H2 - sekcja panelu. */
  as?: "h2" | "h3";
  tone?: PanelHeadingTone;
  className?: string;
}

const TONE_CLASS: Readonly<Record<PanelHeadingTone, string>> = {
  eyebrow: "text-sm font-semibold uppercase tracking-wider text-muted-foreground",
  display: "font-display text-base",
  field: "text-sm font-semibold",
};

/**
 * Atom: nagłówek sekcji panelu ustawień.
 *
 * CO SCALIŁ. Cztery panele modułu miały piętnaście kopii tego samego nagłówka
 * w trzech odmianach wizualnych, a część z nich renderowała `<Label>` - czyli
 * `<label>` BEZ powiązanej kontrolki. Dla czytnika ekranu taki nagłówek nie
 * istnieje: nie ma go w spisie nagłówków strony, a `<label>` bez `for` i bez
 * zagnieżdżonego pola jest znacznikiem bez znaczenia. Atom zawsze renderuje
 * PRAWDZIWY nagłówek (`h2`/`h3`), więc nawigacja po nagłówkach obejmuje cały
 * panel, a wariant wizualny jest osobnym wymiarem od semantyki.
 */
export function PanelSectionHeading({
  children,
  as: Tag = "h2",
  tone = "eyebrow",
  className,
}: PanelSectionHeadingProps) {
  return <Tag className={cn(TONE_CLASS[tone], className)}>{children}</Tag>;
}
