// i18n komunikatów walidacji/optymalizacji karty OG (PL/EN). Osobny bundle,
// ładowany przez ekran /admin/settings/social-preview.
import i18n from "./i18n";

const pl = {
  ogUpload: {
    mime_unsupported: "Nieobsługiwany format pliku ({{mime}}). Wgraj JPG, PNG lub WebP.",
    mime_converted: "Format {{mime}} bywa pomijany przez scrapery - konwertuję do JPG/PNG.",
    dimensions_mismatch:
      "Wymagane proporcje 1200x630 px. Ten plik ma {{width}}x{{height}} px - przytnij go i spróbuj ponownie.",
    dimensions_too_small: "Obrazek jest za mały ({{width}}x{{height}} px). Minimum to 1200x630 px.",
    dimensions_downscaled: "Obrazek {{width}}x{{height}} px został przeskalowany do 1200x630 px.",
    file_too_large: "Po kompresji plik nadal waży sporo - rozważ prostszą grafikę.",
    optimized: "Zoptymalizowano: {{before}} → {{after}}.",
  },
};

const en = {
  ogUpload: {
    mime_unsupported: "Unsupported file type ({{mime}}). Upload JPG, PNG or WebP.",
    mime_converted: "The {{mime}} format is often skipped by scrapers - converting to JPG/PNG.",
    dimensions_mismatch:
      "A 1200x630 px ratio is required. This file is {{width}}x{{height}} px - crop it and try again.",
    dimensions_too_small:
      "The image is too small ({{width}}x{{height}} px). Minimum is 1200x630 px.",
    dimensions_downscaled: "The {{width}}x{{height}} px image was scaled down to 1200x630 px.",
    file_too_large: "The file is still heavy after compression - consider simpler artwork.",
    optimized: "Optimized: {{before}} → {{after}}.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/**
 * No-op wołany w KOMPONENCIE trasy (nie side-effectowym importem w pliku
 * trasy): route splitter przenosi wtedy import razem z komponentem do jego
 * chunku, a rejestracja (addResourceBundle wyżej) uruchamia się przy
 * załadowaniu tego chunku - słownik nie wchodzi do chunku wejściowego
 * KAŻDEJ strony. Wzorzec: i18n-club.ts / i18n-network.ts.
 */
export function ensureI18n(): void {}
