// Atom: nakładające się awatary uczestników.
//
// To jest pojedynczy najmocniejszy sygnał „tu są ludzie" - i dlatego stoi
// w nagłówku wątku, nad treścią, a nie w panelu, do którego trzeba kliknąć.
// Licznik „12 odpowiedzi" mówi, ile powstało tekstu; sześć twarzy mówi, ilu
// jest rozmówców, i mówi to bez czytania.
//
// Nakładanie idzie w PRAWO z malejącym z-indexem, więc pierwsza osoba jest
// na wierzchu. Odwrotna kolejność (ostatnia na wierzchu) sprawia, że przy
// dosuniętych awatarach wzrok czyta stos od końca.
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { cn } from "@/lib/utils";

export interface FacepilePerson {
  key: string;
  name: string;
  avatarUrl: string | null;
  /** Anonim pod aliasem - awatar stonowany, bez akcentu marki. */
  muted: boolean;
}

export function ClubFacepile({
  people,
  total,
  max = 6,
  size = "md",
  className,
}: {
  people: readonly FacepilePerson[];
  /** Pełna liczba uczestników - może być większa niż `people.length`. */
  total: number;
  max?: number;
  size?: "sm" | "md";
  className?: string;
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const rest = Math.max(0, total - shown.length);

  return (
    <div className={cn("flex items-center", className)}>
      <div className="flex -space-x-2">
        {shown.map((person, index) => (
          <span
            key={person.key}
            // Ramka w kolorze tła wycina awatar ze stosu - bez niej nakładające
            // się kółka zlewają się w jedną plamę.
            className="rounded-full ring-2 ring-background transition-transform hover:z-10 hover:-translate-y-0.5"
            style={{ zIndex: shown.length - index }}
            title={person.name}
          >
            <ClubAuthorAvatar
              name={person.name}
              avatarUrl={person.avatarUrl}
              size={size === "sm" ? "sm" : "md"}
              muted={person.muted}
            />
          </span>
        ))}
      </div>
      {rest > 0 ? (
        <span
          className={cn(
            "ml-2 grid shrink-0 place-items-center rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-background",
            size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-[11px]",
          )}
        >
          +{rest}
        </span>
      ) : null}
    </div>
  );
}
