// Atom: pigułka statusu w przestrzeni roboczej wątku.
//
// Statusy z DWÓCH słowników (harmonogram, pytania) rysuje jeden komponent,
// bo mówią o tej samej rzeczy: gdzie w cyklu życia jest ten wpis. Dwa
// komponenty oznaczałyby dwa zestawy kolorów, a wtedy "zrobione" w kalendarzu
// i "odpowiedziane" w Q&A wyglądałyby jak dwa różne stany.
//
// Kolor NIE jest jedynym nośnikiem znaczenia - obok stoi tekst statusu.
// Wersja z samą kropką nie przeszłaby WCAG 1.4.1.
import { cn } from "@/lib/utils";

/** Tony niezależne od dziedziny: neutralny, w toku, domknięty, odwołany. */
export type ClubStatusTone = "neutral" | "active" | "done" | "cancelled";

const TONES: Record<ClubStatusTone, string> = {
  neutral: "border-border/60 bg-muted/50 text-muted-foreground",
  active: "border-primary/40 bg-primary/10 text-foreground",
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelled: "border-border/60 bg-muted/40 text-muted-foreground line-through",
};

export function ClubStatusPill({
  label,
  tone = "neutral",
  className,
}: {
  label: string;
  tone?: ClubStatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-lg border px-2 py-0.5 text-[11px] font-medium leading-none",
        TONES[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Mapowanie statusu harmonogramu na ton. Trzymane tutaj, żeby lista, kalendarz
 *  i formularz nie miały trzech własnych zdań na ten temat. */
export function milestoneTone(status: string): ClubStatusTone {
  switch (status) {
    case "active":
      return "active";
    case "done":
      return "done";
    case "cancelled":
      return "cancelled";
    default:
      return "neutral";
  }
}

export function questionTone(status: string): ClubStatusTone {
  switch (status) {
    case "answered":
      return "done";
    case "declined":
    case "hidden":
      return "cancelled";
    default:
      return "active";
  }
}
