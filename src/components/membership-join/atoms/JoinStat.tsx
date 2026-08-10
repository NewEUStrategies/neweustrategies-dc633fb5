// Atom: pojedyncza liczba dowodowa w nagłówku strony "Dołącz do nas".
// Bez logiki i bez zapytań - tylko prezentacja, żeby dało się jej użyć
// w dowolnym module (hero, stopka sekcji, karta klubu).
import { cn } from "@/lib/utils";

export function JoinStat({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-2xl font-black leading-none tracking-tight text-foreground sm:text-3xl">
        {value}
      </p>
      <p className="mt-1 text-xs leading-snug text-muted-foreground sm:text-sm">{label}</p>
    </div>
  );
}
