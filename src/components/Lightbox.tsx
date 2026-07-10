// Cienki wrapper na yet-another-react-lightbox z domyślną konfiguracją.
// CSS pakietu bundlowany przez Vite (ekstrakcja do chunku CSS) zamiast
// ładowania z cdn.jsdelivr.net przy pierwszym otwarciu - zero zależności od
// zewnętrznego CDN, zero błysku niestylowanego lightboxa i działa offline/
// za restrykcyjnym CSP. SSR-friendly: renderer tylko po stronie klienta.
import { useEffect, useState } from "react";
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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (open) setReady(true);
  }, [open]);

  if (!ready) return null;

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
