// Galeria z otwieraniem zdjęć w lightboxie. Używana w BlocksRenderer
// dla bloku "gallery" - wyciągnięta do osobnego komponentu, bo musi
// trzymać state otwarcia (use client).
import { useState } from "react";
import { ImageLightbox } from "@/components/Lightbox";

export interface GalleryItem {
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

  if (images.length === 0) return null;

  return (
    <>
      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 not-prose ${className ?? ""}`}>
        {images.map((img, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              setIndex(i);
              setOpen(true);
            }}
            className="group relative block overflow-hidden rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={img.alt || `Zdjęcie ${i + 1}`}
          >
            <img
              src={img.url}
              alt={img.alt}
              className="w-full h-full object-cover aspect-square transition-transform duration-500 group-hover:scale-[1.04]"
              loading="lazy"
            />
          </button>
        ))}
      </div>
      <ImageLightbox
        open={open}
        index={index}
        slides={images.map((img) => ({ src: img.url, alt: img.alt, description: img.alt }))}
        onClose={() => setOpen(false)}
        onIndexChange={setIndex}
      />
    </>
  );
}
