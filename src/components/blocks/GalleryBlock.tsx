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
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentProps,
  type ComponentType,
} from "react";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { buildScaledImageUrl, isSupabaseStorageUrl } from "@/lib/cropSizes";
import { reportPlatformError } from "@/lib/platform-error-reporting";

const loadLightbox = () => import("@/components/Lightbox");

type LightboxProps = ComponentProps<typeof import("@/components/Lightbox").ImageLightbox>;

/**
 * Porażka rozgrzania (najechanie/fokus) przekazana pierwszemu otwarciu. Pomocnik `import()` Vite
 * nie ponawia arkusza, który już raz próbował wczytać, więc ponowiony import po nieudanym
 * rozgrzaniu zamontowałby lightbox bez stylów - kliknięcie ma zamiast tego dostać pierwotny błąd.
 */
let warmFailure: unknown;

/**
 * Nieudane pobranie chunku (wdrożenie usunęło stary plik, zerwane łącze) NIE może zabrać galerii:
 * odrzucony `lazy` rzucałby w renderze do granicy błędu bloku, której fallback produkcyjny to
 * `null` - znikałyby też miniatury. Zamiast tego:
 *  - chunk-load error idzie do siatki cache-bustingu (jednorazowe przeładowanie), każdy inny błąd
 *    do raportu błędów platformy (tak jak dawniej z granicy błędu bloku);
 *  - zastępczy komponent zamyka lightbox (`onClose`), więc kolejne kliknięcie - także w tę samą
 *    miniaturę - jest prawdziwą zmianą stanu i renderuje już świeży `lazy` (`React.lazy` zapamiętuje
 *    wynik, także porażkę). Zamknięty lightbox, który nigdy się nie wczytał, nie jest renderowany
 *    (`lightboxLoaded`), więc porażka nie ponawia importu w tle - jedna próba na kliknięcie.
 */
function lazyLightbox() {
  return lazy(() => {
    const failed = warmFailure;
    warmFailure = undefined;
    return (failed !== undefined ? Promise.reject(failed) : loadLightbox()).then(
      (m): { default: ComponentType<LightboxProps> } => {
        lightboxLoaded = true;
        return { default: m.ImageLightbox };
      },
      (error: unknown) => {
        ImageLightbox = lazyLightbox();
        void import("@/lib/cacheBusting").then(
          (m) =>
            m.looksLikeChunkLoadError(error)
              ? m.handleChunkLoadFailure(error)
              : reportPlatformError(error, { label: "block:gallery:lightbox" }),
          () => reportPlatformError(error, { label: "block:gallery:lightbox" }),
        );
        return { default: LightboxLoadFailed };
      },
    );
  });
}
let ImageLightbox = lazyLightbox();
/** Moduł lightboxa wczytany: zamknięty zostaje zamontowany (animacja wyjścia). */
let lightboxLoaded = false;

function LightboxLoadFailed({ onClose }: LightboxProps) {
  useEffect(() => {
    onClose();
  }, [onClose]);
  return null;
}

/** Rozgrzanie chunku przed kliknięciem. Porażka czeka na pierwsze otwarcie (`warmFailure`),
 *  które oddaje ją siatce `cacheBusting` zamiast montować lightbox bez arkusza. */
function warmLightbox(): void {
  void loadLightbox().catch((error: unknown) => {
    warmFailure ??= error;
  });
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
  // Raz zamontowany i wczytany zostaje: zamknięcie przechodzi przez `open={false}`, żeby
  // biblioteka odegrała animację wyjścia. Niewczytany (porażka chunku) znika po zamknięciu.
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
      {mounted && (open || lightboxLoaded) && (
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
