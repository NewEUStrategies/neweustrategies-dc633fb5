// Czysty model widgetu "promo-card" (karta promocyjna z okładką i CTA).
//
// Poza komponentami, żeby renderer, molekuła UI, panel właściwości i testy
// miały JEDNO źródło prawdy dla: listy proporcji kadru, rekomendacji rozmiaru
// pliku przy wgrywaniu oraz adresu CTA. Moduł jest czysty (bez Reacta, DOM-u,
// sieci i zegara), więc każda z tych reguł daje się sprawdzić bez montowania
// czegokolwiek - i, co ważniejsze, liczy się IDENTYCZNIE na serwerze (SSR)
// i w przeglądarce (hydratacja). Żadna wartość tutaj nie zależy od `Date.now()`,
// `window` ani strefy maszyny.
//
// Pierwowzór (wklejony komponent 21st.dev) trzymał kartę na `framer-motion`:
// `useMotionValue` + `useSpring` przeliczały pozycję kursora na `rotateX/rotateY`,
// a treść jechała na `translateZ(50px)`. Zrezygnowaliśmy z tego CAŁKOWICIE:
//   * przesunięcie pod kursorem jest dla klawiatury i dotyku niedostępne,
//     a dla myszy to ruch, którego redakcja nie ma jak wyłączyć,
//   * `transform` na kontenerze tworzy nowy kontekst układu (containing block),
//     więc karta potrafiła "wyprzedzać" sąsiadów i psuć CLS w kolumnie,
//   * stan pochodzący z kursora nie istnieje przy renderze serwerowym, więc
//     pierwszy render klienta musiałby się od SSR różnić.
// Animacja NIE ZNIKA - zmienia klasę. Zostają efekty, które nie ruszają kartą
// ani jej sąsiadami: przenikanie (krycie) i delikatny zoom SAMEJ okładki
// wewnątrz kadru z `overflow: hidden` - patrz `PROMO_CARD_HOVERS` i
// `PROMO_CARD_ENTRANCES`. Liczy je arkusz stylów (CSS), nie biblioteka animacji:
// `framer-motion` nie wchodzi już do grafu tego widgetu, a każdy efekt jest pod
// `prefers-reduced-motion`.

/** Proporcje kadru okładki. `auto` = wysokość z pola `heightPx`. */
export const PROMO_CARD_RATIOS = [
  "21:9",
  "16:9",
  "3:2",
  "4:3",
  "1:1",
  "4:5",
  "3:4",
  "auto",
] as const;
export type PromoCardRatio = (typeof PROMO_CARD_RATIOS)[number];

/** Dopasowanie okładki do kadru. */
export const PROMO_CARD_FITS = ["cover", "contain"] as const;
export type PromoCardFit = (typeof PROMO_CARD_FITS)[number];

/** Punkt kadrowania okładki (`object-position`). */
export const PROMO_CARD_POSITIONS = ["center", "top", "bottom", "left", "right"] as const;
export type PromoCardPosition = (typeof PROMO_CARD_POSITIONS)[number];

/**
 * Reakcja na kursor. ŻADNA z tych wartości nie przesuwa karty ani jej treści -
 * to jest twardy warunek tego widgetu, nie preferencja stylistyczna:
 *   * `fade`      - zmienia się wyłącznie KRYCIE (nakładka ciemnieje, okładka
 *                   delikatnie rozjaśnia się), zero `transform`,
 *   * `zoom-in`   - skaluje SAMĄ okładkę wewnątrz kadru z `overflow: hidden`,
 *   * `zoom-out`  - to samo w drugą stronę (okładka startuje powiększona),
 *   * `shadow`    - zmienia wyłącznie cień ramki,
 *   * `none`      - bez reakcji.
 *
 * Zoom działa na `<img>` ZAMKNIĘTYM w kadrze, więc geometria karty jest stała:
 * sąsiedzi w kolumnie się nie ruszają, a CLS zostaje zerowy. Karta jako całość
 * nie dostaje `transform` NIGDY - to właśnie ono w pierwowzorze przesuwało
 * kafelek spod kursora.
 */
export const PROMO_CARD_HOVERS = ["none", "fade", "zoom-in", "zoom-out", "shadow"] as const;
export type PromoCardHover = (typeof PROMO_CARD_HOVERS)[number];

/** Skala okładki przy wariantach zoomu - 4% to ruch widoczny, ale nienachalny. */
export const PROMO_CARD_ZOOM_SCALE = 1.04;

/**
 * Animacja WEJŚCIA karty (po zamontowaniu / wjechaniu w kadr). Też bez
 * przesunięć: `fade` to czyste krycie, `zoom` to skala samej okładki w kadrze.
 */
export const PROMO_CARD_ENTRANCES = ["none", "fade", "zoom"] as const;
export type PromoCardEntrance = (typeof PROMO_CARD_ENTRANCES)[number];

/** Wyrównanie treści w karcie. */
export const PROMO_CARD_ALIGNS = ["left", "center"] as const;
export type PromoCardAlign = (typeof PROMO_CARD_ALIGNS)[number];

/** Źródło CTA: ręczny adres albo wydarzenie z wewnętrznego kreatora. */
export const PROMO_CARD_MODES = ["link", "event"] as const;
export type PromoCardMode = (typeof PROMO_CARD_MODES)[number];

/** Wartości domyślne prezentacji - te same liczby siedzą w `WIDGET_SCHEMAS`. */
export const PROMO_CARD_DEFAULTS = {
  ratio: "16:9" as PromoCardRatio,
  /** Używane tylko przy `ratio: "auto"`. */
  heightPx: 288,
  /** 0 = pełna szerokość kolumny. */
  maxWidth: 512,
  fit: "cover" as PromoCardFit,
  imagePosition: "center" as PromoCardPosition,
  overlayAlphaTop: 0,
  overlayAlphaBottom: 0.7,
  /** Platformowe 6 px zamiast `rounded-xl` pierwowzoru. */
  radius: 6,
  align: "left" as PromoCardAlign,
  hover: "zoom-in" as PromoCardHover,
  entrance: "fade" as PromoCardEntrance,
  mode: "link" as PromoCardMode,
} as const;

/** Kolor nakładki, gdy panel nie narzucił własnego (grafit wzorca). */
export const PROMO_CARD_DEFAULT_OVERLAY = "#0B1220";

/**
 * Szerokość odniesienia, gdy karta nie ma limitu (`maxWidth = 0`): tyle ma
 * kolumna treści w najszerszym układzie serwisu. Rekomendacja pliku musi
 * zakładać najgorszy (najszerszy) przypadek, bo obraz da się zmniejszyć bez
 * straty, a powiększyć - nie.
 */
export const PROMO_CARD_FULL_WIDTH = 1200;

/** Mnożnik gęstości ekranu: 2× pokrywa ekrany Retina bez sztucznego rozdęcia. */
const DPR_FACTOR = 2;

/** Sensowne granice pliku okładki - poza nimi rekomendacja przestaje pomagać. */
const MIN_RECOMMENDED_WIDTH = 800;
const MAX_RECOMMENDED_WIDTH = 2400;

/** Proporcja kadru jako liczba (szerokość / wysokość). `auto` nie ma proporcji. */
const RATIO_VALUE: Readonly<Record<Exclude<PromoCardRatio, "auto">, number>> = {
  "21:9": 21 / 9,
  "16:9": 16 / 9,
  "3:2": 3 / 2,
  "4:3": 4 / 3,
  "1:1": 1,
  "4:5": 4 / 5,
  "3:4": 3 / 4,
};

/** Wartość treści sprowadzona do znanej proporcji (nieznana -> domyślna). */
export function promoCardRatio(raw: unknown): PromoCardRatio {
  return (PROMO_CARD_RATIOS as readonly string[]).includes(raw as string)
    ? (raw as PromoCardRatio)
    : PROMO_CARD_DEFAULTS.ratio;
}

/**
 * Wartość dla CSS `aspect-ratio` albo `null` dla kadru o stałej wysokości.
 * Zwracamy napis `"16 / 9"`, a nie liczbę: przeglądarki liczą wtedy proporcję
 * dokładnie, bez błędu zaokrąglenia na wartości zmiennoprzecinkowej.
 */
export function promoCardAspect(ratio: PromoCardRatio): string | null {
  return ratio === "auto" ? null : ratio.replace(":", " / ");
}

/** Rekomendowany rozmiar pliku okładki dla danego kadru. */
export interface PromoCardImageSize {
  readonly width: number;
  readonly height: number;
  /** Etykieta proporcji dla panelu (`16:9`, `stała wysokość`). */
  readonly ratio: PromoCardRatio;
}

/**
 * Rekomendacja rozmiaru zdjęcia PRZY WGRYWANIU.
 *
 * Redakcja wgrywa dziś albo miniatury (rozmyte po rozciągnięciu na kadr), albo
 * pliki z aparatu (kilkanaście MB na kartę o szerokości 512 px). Liczymy więc
 * jedną liczbę i pokazujemy ją przy polu: szerokość renderu × gęstość ekranu,
 * przycięta do rozsądnych granic, wysokość z proporcji kadru.
 *
 * `maxWidth = 0` (pełna szerokość kolumny) liczy się od `PROMO_CARD_FULL_WIDTH`,
 * bo wtedy karta może naprawdę urosnąć do szerokości kolumny treści.
 */
export function promoCardImageSize(
  ratio: PromoCardRatio,
  maxWidth: number,
  heightPx: number = PROMO_CARD_DEFAULTS.heightPx,
): PromoCardImageSize {
  const rendered = maxWidth > 0 ? maxWidth : PROMO_CARD_FULL_WIDTH;
  const raw = Math.round(rendered * DPR_FACTOR);
  const width =
    Math.round(Math.min(MAX_RECOMMENDED_WIDTH, Math.max(MIN_RECOMMENDED_WIDTH, raw)) / 100) * 100;
  if (ratio === "auto") {
    const height = Math.max(1, Math.round(Math.max(1, heightPx) * DPR_FACTOR));
    return { width, height, ratio };
  }
  return { width, height: Math.round(width / RATIO_VALUE[ratio]), ratio };
}

/**
 * Adres CTA. Tryb wydarzenia bierze stronę wydarzenia z jego adresu (`slug`),
 * a ręcznie wpisany adres MA PIERWSZEŃSTWO także tam - redakcja bywa zmuszona
 * skierować przycisk na stronę rejestracji partnera zamiast na kartę wydarzenia.
 *
 * Pusty wynik znaczy "nie ma dokąd kliknąć" i renderer nie rysuje wtedy
 * przycisku. To nie jest to samo co `"#"`: przycisk prowadzący donikąd jest
 * gorszy niż brak przycisku.
 */
export function promoCardCtaHref(mode: PromoCardMode, href: string, eventSlug: string): string {
  const manual = href.trim();
  if (manual) return manual;
  if (mode !== "event") return "";
  const slug = eventSlug.trim();
  return slug ? `/events/${slug}` : "";
}

/**
 * Etykieta przycisku, gdy redakcja nie wpisała własnej. Napis powstaje w języku
 * WIDOKU, nie treści - dlatego siedzi w tablicy, a nie w warunku po języku
 * (warunek `lang === "pl" ? … : …` omija bramkę parytetu PL/EN i zamyka drogę
 * do trzeciego języka).
 */
const FALLBACK_CTA: Record<PromoCardMode, Record<"pl" | "en", string>> = {
  link: { pl: "Dowiedz się więcej", en: "Learn more" },
  event: { pl: "Zobacz wydarzenie", en: "View event" },
};

export function promoCardCtaLabel(mode: PromoCardMode, lang: "pl" | "en"): string {
  return FALLBACK_CTA[mode][lang];
}
