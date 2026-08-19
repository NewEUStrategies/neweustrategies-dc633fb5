// Atom: nadtytuł sekcji („Następny artykuł", „Dossier", „Powiązane analizy").
//
// POWSTAŁ Z TRZECH KOPII tego samego łańcucha klas
// (`text-xs uppercase tracking-widest text-muted-foreground`) w
// `AutoLoadNextPost`, `PostSeriesNav` i `RelatedPosts`. Same klasy nie byłyby
// powodem do atomu - powodem jest to, że każda kopia rozstrzygała inaczej, czy
// nadtytuł jest NAGŁÓWKIEM sekcji, czy tylko ozdobnym napisem. Atom ma to
// jawnie: `as` decyduje o semantyce, a domyślnie napis jest ozdobą.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const SECTION_EYEBROW_CLASS = "text-xs uppercase tracking-widest text-muted-foreground";

export interface SectionEyebrowProps {
  children: ReactNode;
  /**
   * `p` (domyślnie) - napis ozdobny, poza konspektem strony.
   * `h2`/`h3` - nadtytuł JEST nagłówkiem sekcji i wchodzi do konspektu, więc
   * czytnik ekranu może po nim nawigować.
   */
  as?: "p" | "h2" | "h3";
  className?: string;
}

export function SectionEyebrow({ children, as = "p", className }: SectionEyebrowProps) {
  const Tag = as;
  return <Tag className={cn(SECTION_EYEBROW_CLASS, className)}>{children}</Tag>;
}
