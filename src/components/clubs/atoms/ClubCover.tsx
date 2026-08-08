// Okładka klubu.
//
// Kolumna `cover_image_url` istnieje w `clubs` od A1, a `club_list` i
// `club_view` zwracały ją od początku - tylko nikt jej nie rysował. Zdjęcie
// dawało się wgrać w panelu i znikało bez śladu.
//
// Dwa warianty NIE różnią się kosmetyką, tylko zachowaniem przy braku zdjęcia:
//
//   `banner` (strona klubu) - bez okładki nie rysuje NIC. Pusty pas 3:1 nad
//     tytułem to gorsza strona niż brak pasa; nagłówek ma zaczynać się od
//     nazwy klubu.
//   `card` (kafel w katalogu) - bez okładki rysuje zastępnik. Tu odwrotnie:
//     siatka z częścią kafli wyższych o wysokość zdjęcia rozjeżdża się
//     wizualnie, więc każdy kafel dostaje ten sam blok.
//
// Zastępnik jest tym samym chwytem, co okładka podcastu bez grafiki
// (`podcasts.$show`): stonowane tło i ikona rodzaju treści.
import { MessagesSquare } from "lucide-react";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { cn } from "@/lib/utils";

export function ClubCover({
  url,
  variant,
  className,
}: {
  url: string | null | undefined;
  variant: "banner" | "card";
  className?: string;
}) {
  const hasCover = typeof url === "string" && url.trim() !== "";

  if (!hasCover && variant === "banner") return null;

  const shape =
    variant === "banner"
      ? "aspect-[3/1] w-full rounded-lg sm:aspect-[4/1]"
      : "aspect-[16/9] w-full rounded-t-lg";

  if (!hasCover) {
    return (
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden bg-muted",
          shape,
          className,
        )}
        aria-hidden="true"
      >
        <MessagesSquare className="h-8 w-8 text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden border border-border/60 bg-muted", shape, className)}>
      {/* alt="" celowo: nazwa klubu stoi obok w nagłówku albo w tytule kafla,
          więc czytnik ekranu przeczytałby ją dwa razy.

          `OptimizedImage`, nie surowy <img>: okładki wgrywa się przez
          CoverImagePicker do Supabase Storage, czyli dokładnie ten kształt URL,
          dla którego atom generuje `srcSet` wariantów szerokości. Bez tego
          kafel 16:9 o szerokości ~380 px ściągał plik w pełnej rozdzielczości,
          a siatka katalogu ma ich na ekranie kilkanaście. */}
      <OptimizedImage
        src={url}
        alt=""
        responsive
        sizes={
          variant === "banner"
            ? "(min-width: 1024px) 64rem, 100vw"
            : "(min-width: 1024px) 22rem, (min-width: 640px) 50vw, 100vw"
        }
        priority={variant === "banner"}
        className="h-full w-full object-cover"
      />
    </div>
  );
}
