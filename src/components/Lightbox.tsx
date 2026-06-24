// Cienki wrapper na yet-another-react-lightbox z domyślną konfiguracją
// i lazy-loadowanym CSS-em (link tag wstrzykiwany przy pierwszym mount).
// SSR-friendly: właściwy renderer jest tylko po stronie klienta.
import { useEffect, useState } from "react";
import Lightbox, { type SlideImage } from "yet-another-react-lightbox";

let cssInjected = false;

function ensureLightboxCss() {
  if (cssInjected || typeof document === "undefined") return;
  cssInjected = true;
  const id = "yarl-stylesheet";
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = "https://cdn.jsdelivr.net/npm/yet-another-react-lightbox@3.32.0/dist/styles.min.css";
  document.head.appendChild(link);
}

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
    if (open) {
      ensureLightboxCss();
      setReady(true);
    }
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
