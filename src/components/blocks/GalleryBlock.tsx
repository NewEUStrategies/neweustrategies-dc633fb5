// Galeria z otwieraniem zdjęć w lightboxie. Używana w BlocksRenderer
// dla bloku "gallery" - wyciągnięta do osobnego komponentu, bo musi
// trzymać state otwarcia.
//
// LIGHTBOX LENIWIE, montowany dopiero przy pierwszym otwarciu. Statyczny import
// wciągał `yet-another-react-lightbox` (~34 KB JS, ~12,8 KB gzip) do chunku
// `BlocksRenderer`, który jest w serii bootu każdej strony `/$`, a jego arkusz
// trafiał do `css` manifestu Start dla dziewięciu tras: `<link rel="stylesheet">`
// blokował render także artykułów bez żadnej galerii. Teraz chunk i arkusz
// przychodzą przy najechaniu/fokusie na miniaturę (rozgrzanie) albo przy kliknięciu;
// pomocnik `import()` Vite czeka na arkusz, zanim moduł się wykona, więc lightbox nie
// błyska bez stylów. Serwer i pierwszy render klienta nie renderują go wcale, więc
// hydratacja się nie zmienia.
import { lazy, Suspense, useState } from "react";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { buildScaledImageUrl, isSupabaseStorageUrl } from "@/lib/cropSizes";

const loadLightbox = () => import("@/components/Lightbox");
const ImageLightbox = lazy(() => loadLightbox().then((m) => ({ default: m.ImageLightbox })));

/** Rozgrzanie chunku przed kliknięciem. Błąd sieci tu nie ma znaczenia: kliknięcie
 *  ponowi import, a nieudany chunk obsługuje siatka `cacheBusting`. */
function warmLightbox(): void {
  void loadLightbox().catch(() => undefined);
}

/** Slajd lightboxa: przeskalowany wariant zamiast pełnego oryginału
 *  (oryginały z aparatu potrafią mieć >10 MB; 1920 px starcza na 4K okno). */
function lightboxSrc(url: string): string {
  return isSupabaseStorageUrl(url) ? buildScaledImageUrl(url, 1920, 82) : url;
}

interface GalleryItem {
  url: string;
  alt: string;
}

interface Props {
  images: GalleryItem[];
  className?: string;
}

export function GalleryBlock({ images, className }: Props) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  // Raz zamontowany zostaje: zamknięcie przechodzi przez `open={false}`, żeby
  // biblioteka odegrała animację wyjścia.
  const [mounted, setMounted] = useState(false);

  if (images.length === 0) return null;

  return (
    <>
      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 not-prose ${className ?? ""}`}>
        {images.map((img, i) => (
          <button
            key={i}
            type="button"
            onPointerEnter={warmLightbox}
            onFocus={warmLightbox}
            onClick={() => {
              setIndex(i);
              setOpen(true);
              setMounted(true);
            }}
            className="group relative block overflow-hidden rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={img.alt || `Zdjęcie ${i + 1}`}
          >
            <OptimizedImage
              src={img.url}
              alt={img.alt}
              responsive
              sizes="(min-width: 640px) 33vw, 50vw"
              className="w-full h-full object-cover aspect-square transition-transform duration-500 group-hover:scale-[1.04]"
            />
          </button>
        ))}
      </div>
      {mounted && (
        <Suspense fallback={null}>
          <ImageLightbox
            open={open}
            index={index}
            slides={images.map((img) => ({
              src: lightboxSrc(img.url),
              alt: img.alt,
              description: img.alt,
            }))}
            onClose={() => setOpen(false)}
            onIndexChange={setIndex}
          />
        </Suspense>
      )}
    </>
  );
}
