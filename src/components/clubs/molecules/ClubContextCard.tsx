// Molekuła: karta w szynie kontekstu.
//
// Wszystkie karty prawej kolumny wyglądają tak samo, bo są tym samym gatunkiem
// obiektu: skrótem panelu, który stoi obok rozmowy i prowadzi do pełnej wersji.
// Sześć kart w sześciu układach czyta się jak sześć różnych stron doklejonych
// do siebie.
//
// „Zobacz wszystko" jest PRZYCISKIEM, nie linkiem: panel nie ma własnego
// adresu (wątek ma zostać jednym adresem do zacytowania), więc nawigacja jest
// zmianą stanu, a nie przejściem. Element, który wygląda jak link i nie da się
// go otworzyć w nowej karcie, to obietnica bez pokrycia.
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function ClubContextCard({
  icon,
  title,
  count,
  onOpen,
  openLabel,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  /** `null` = bez licznika przy tytule. */
  count?: number | null;
  onOpen?: () => void;
  openLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border/60 bg-card/60 p-3.5 transition-colors hover:border-border",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span aria-hidden="true" className="text-muted-foreground/80">
            {icon}
          </span>
          <span className="truncate">{title}</span>
          {count !== null && count !== undefined && count > 0 ? (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none tabular-nums">
              {count}
            </span>
          ) : null}
        </h3>
        {onOpen !== undefined && openLabel !== undefined ? (
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex shrink-0 items-center gap-0.5 rounded text-[11px] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {openLabel}
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}
