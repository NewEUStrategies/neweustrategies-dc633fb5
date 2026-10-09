// PRÓBKA HERO W KSZTAŁCIE PRODUKCJI (P3.2a) - wspólna dla dwóch dowodów:
//  * `heroCandidateSelection.test.tsx` przypina ją do WYJŚCIA KODU: `<img
//    data-lcp-candidate>` z SSR renderera buildera i deskryptor preloadu
//    (`builderHeroPreloads`) dla dokumentu jak na produkcji (sekcja `full`,
//    kolumny 3/6/3, hero pierwsze na telefonie, slider `editorial-hero`) muszą dać
//    dokładnie te napisy;
//  * `e2e/hero-srcset.boot-home.spec.ts` podaje je PRAWDZIWEMU Chromium (fixture
//    `/` nie ma żadnego `srcset` - obrazy z `fixture.invalid` są nietransformowalne,
//    KRYTYKA L6) i sprawdza, którego kandydata przeglądarka żąda.
//
// Literały, nie wywołania: e2e nie może importować modułów aplikacji (stałe z
// `import.meta.env`), a test jednostkowy pilnuje, że próbka = kod. Zmiana drabiny
// albo marginesu kolumny robi test jednostkowy czerwonym, dopóki próbka (a więc
// i dowód w przeglądarce) nie przejdzie na nowe wartości.

/** Okładka hero z kanonicznego originu (adres markowy `/media/...`). */
export const HERO_COVER_URL = "https://neweuropeanstrategies.com/media/posts/hero-cover.webp";

export const HERO_SRCSET_SAMPLE = {
  /** `src` malowanego `<img>` - względny obok względnego `srcset` (P4.2). */
  src: "/media/posts/hero-cover.webp",
  srcset: [
    "/media/posts/hero-cover.webp?width=480&resize=contain&quality=76 480w",
    "/media/posts/hero-cover.webp?width=640&resize=contain&quality=76 640w",
    "/media/posts/hero-cover.webp?width=768&resize=contain&quality=80 768w",
    "/media/posts/hero-cover.webp?width=1280&resize=contain&quality=80 1280w",
    "/media/posts/hero-cover.webp?width=1920&resize=contain&quality=80 1920w",
  ].join(", "),
  /** Telefon: kolumna minus margines 2 x 32 px (LP-7); od 768 px kolumna 6/12. */
  sizes: "(max-width: 767px) calc(100vw - 64px), (max-width: 1023px) 50vw, 50vw",
  /** `sizes` sprzed P3.2a (telefon `100vw`) - udokumentowana regresja: 768w. */
  legacySizes: "(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 50vw",
} as const;
