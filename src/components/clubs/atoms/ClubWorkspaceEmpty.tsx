// Atom: pusty panel przestrzeni roboczej.
//
// Pustka nie jest błędem i nie ma tak wyglądać. Panel bez pozycji ma powiedzieć
// DWIE rzeczy: czego tu nie ma i co z tym zrobić - a jeśli czytelnik nie ma
// prawa nic dopisać, to przynajmniej pierwszą z nich, bez martwego przycisku
// obok.
//
// Jeden komponent na wszystkie panele, żeby "brak dokumentów" i "brak pytań"
// wyglądały jak ten sam stan systemu, a nie jak dwie różne awarie.
import type { ReactNode } from "react";

export function ClubWorkspaceEmpty({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  /** Zaproszenie do wniesienia pierwszej pozycji - tylko gdy wolno ją wnieść. */
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center sm:py-10">
      {icon !== undefined ? (
        <span
          aria-hidden="true"
          className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-muted/60 text-muted-foreground"
        >
          {icon}
        </span>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {hint !== undefined ? (
        <p className="mx-auto mt-1.5 max-w-prose text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {action !== undefined ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
