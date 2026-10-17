// Cienki wrapper na yet-another-react-lightbox z domyślną konfiguracją.
// CSS pakietu bundlowany przez Vite (ekstrakcja do chunku CSS) zamiast
// ładowania z cdn.jsdelivr.net przy pierwszym otwarciu - zero zależności od
// zewnętrznego CDN, zero błysku niestylowanego lightboxa i działa offline/
// za restrykcyjnym CSP.
//
// Moduł ładuje się WYŁĄCZNIE leniwie (`GalleryBlock`, przy pierwszym otwarciu), więc
// i on, i jego arkusz są poza serią bootu i poza `css` manifestu tras. Statyczny import
// tego pliku z modułu renderowanego na stronach publicznych przywróciłby blokujący
// render arkusz na każdej stronie `/$`.
import Lightbox, { type SlideImage } from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";

interface Props {
  open: boolean;
  index: number;
  slides: SlideImage[];
  onClose: () => void;
  onIndexChange?: (index: number) => void;
}

export function ImageLightbox({ open, index, slides, onClose, onIndexChange }: Props) {
  return (
    <Lightbox
      open={open}
      close={onClose}
      index={index}
      slides={slides}
      on={{ view: ({ index: i }) => onIndexChange?.(i) }}
      carousel={{ finite: slides.length <= 1 }}
      controller={{ closeOnBackdropClick: true }}
      animation={{ fade: 220, swipe: 260 }}
    />
  );
}
