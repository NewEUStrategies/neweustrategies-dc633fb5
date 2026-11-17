// Warstwa prezentacji popupu REJESTRACJI konta (nie newslettera - newsletter to
// tylko opcjonalny checkbox w formularzu). Jedno źródło prawdy dla:
//   - publicznego popupu (SignupPopupPanel),
//   - podglądu w Admin → Popupy → "Popup rejestracji",
//   - i18n etykiet (każdy tekst ma wariant PL i EN).
//
// Cała konfiguracja wizualna trzymana jest w JEDNEJ kolumnie jsonb
// (`newsletter_settings.popup_design`), więc dodanie kolejnego pokrętła nie
// wymaga migracji. Brakujące klucze uzupełniamy defaultami poniżej, dzięki
// czemu starsze tenanty renderują się identycznie jak przed wdrożeniem.
//
// Kolory: kolumny `popup_*_color` pozostają paletą CIEMNĄ (kompatybilność
// wstecz), a paleta JASNA żyje w `popup_design.light`. `colorScheme` decyduje,
// która obowiązuje: "dark" | "light" | "auto" (auto = motyw strony).
//
// Ten moduł (typy i wartości domyślne) jedzie w chunku startowym razem
// z `hooks/useNewsletterSettings` (rejestr prefetchu widgetów), bo
// `defaultNewsletterSettings()` woła `defaultPopupDesign()`. Koercja zapisu
// z bazy (`resolvePopupDesign`) i paleta popupu mieszkają w liściu
// `./popupDesignResolve` - czytają je wyłącznie popup rejestracji, jego
// podgląd i edytor w panelu oraz leniwe ciało odczytu ustawień (roadmapa
// ładowania §9.10).

export type PopupColorScheme = "dark" | "light" | "auto";
/** Siatka galerii: "reference" = układ 1:1 z projektem, "mosaic" = 3x3, "single" = jeden kadr. */
export type PopupGalleryGrid = "reference" | "mosaic" | "single";
export type PopupAlign = "center" | "left";
export type PopupSplit = "half" | "gallery-wide" | "form-wide";

/** Bloki lewej kolumny - kolejność jest edytowalna w panelu admina. */
export const GALLERY_BLOCKS = ["brand", "grid", "caption", "tagline", "dots"] as const;
export type GalleryBlock = (typeof GALLERY_BLOCKS)[number];

export interface PopupThemeColors {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  accentFg: string;
  overlay: string;
  /** Gradient tła galerii; puste = wyliczone z accent/bg. */
  gradFrom: string;
  gradTo: string;
}

export interface PopupGalleryDesign {
  grid: PopupGalleryGrid;
  /** Kąt gradientu tła w stopniach (0-360). */
  gradientAngle: number;
  align: PopupAlign;
  order: GalleryBlock[];
  showLogo: boolean;
  /** Nadpisanie logotypu; puste = poziome logo z menu admina (theme_options). */
  logoUrl: string;
  logoHeightPx: number;
  /** Miękkie wygaszenia u góry i u dołu mozaiki (jak w projekcie). */
  showFades: boolean;
  /** Naroża "celownika" na aktywnym kaflu. */
  showCorners: boolean;
  /** Strzałka "następny kadr" w karcie podpisu. */
  showArrow: boolean;
  /** Ramka karty podpisu przerywana (1:1) albo pełna. */
  captionDashed: boolean;
  /** Wyróżniony prefiks podpisu (odpowiednik "/imagine" z projektu). */
  captionPrefixPl: string;
  captionPrefixEn: string;
  gapPx: number;
  paddingPx: number;
  /** Wysokość mozaiki na desktopie. */
  gridHeightPx: number;
  /** Przygaszenie nieaktywnych kafli (0-100%). */
  inactiveDim: number;
}

export interface PopupFormDesign {
  align: PopupAlign;
  showEyebrow: boolean;
  /** Nagłówek w jednej linii (`whitespace-nowrap`) jak w projekcie. */
  titleNoWrap: boolean;
  titleSizePx: number;
  maxWidthPx: number;
  /** Imię i nazwisko (oraz e-mail/telefon, hasła) w dwóch kolumnach. */
  twoColumnPairs: boolean;
  /** Podpowiedź nad polami (opcjonalna, np. "Wypełnij dane"). */
  hintPl: string;
  hintEn: string;
  /** Link "Masz już konto? Zaloguj się". */
  showLoginLink: boolean;
  loginLinkPl: string;
  loginLinkEn: string;
  loginLinkHref: string;
  /**
   * Ikona przycisku CTA - nazwa z biblioteki Lucide w kebab-case (ta sama
   * konwencja co picker w builderze). Pusty string = przycisk bez ikony.
   */
  ctaIcon: string;
}

export interface PopupPanelDesign {
  maxWidthPx: number;
  split: PopupSplit;
  showBorder: boolean;
  /** Cień panelu (0 = brak, 100 = maksymalny). */
  shadow: number;
}

/**
 * Kolory KONTROLEK popupu: checkboxów zgód i przycisku CTA. Każde pole jest
 * NADPISANIEM - pusty string znaczy „użyj koloru wyliczonego z palety", dzięki
 * czemu tenanty, które nigdy nie dotknęły tej sekcji, renderują się identycznie
 * jak przed wdrożeniem, a redakcja może zmienić sam przycisk bez ruszania
 * całej palety.
 */
export interface PopupControlColors {
  /** Kreska nieaktywnego checkboxa. */
  checkboxBorder: string;
  /** Kreska po najechaniu / focusie. */
  checkboxHover: string;
  /** Kreska i „ptaszek" zaznaczonego checkboxa. */
  checkboxChecked: string;
  /** Tekst etykiety obok checkboxa (zgody, newsletter). */
  checkboxLabel: string;
  /** Linki wewnątrz treści zgód. */
  checkboxLink: string;
  /** Tło przycisku CTA. */
  buttonBg: string;
  /** Atrament przycisku CTA. */
  buttonFg: string;
  /** Ramka przycisku CTA. */
  buttonBorder: string;
  /** Tło przycisku CTA po najechaniu. */
  buttonHoverBg: string;
}

export interface PopupControlsDesign {
  dark: PopupControlColors;
  light: PopupControlColors;
}

export interface PopupDesign {
  colorScheme: PopupColorScheme;
  light: PopupThemeColors;
  panel: PopupPanelDesign;
  gallery: PopupGalleryDesign;
  form: PopupFormDesign;
  controls: PopupControlsDesign;
}

/** Puste nadpisania = kolory kontrolek płyną z palety. */
export function emptyPopupControlColors(): PopupControlColors {
  return {
    checkboxBorder: "",
    checkboxHover: "",
    checkboxChecked: "",
    checkboxLabel: "",
    checkboxLink: "",
    buttonBg: "",
    buttonFg: "",
    buttonBorder: "",
    buttonHoverBg: "",
  };
}

/** Rozdzielczości rekomendowane dla kafli galerii (kolejność = slot w siatce). */
export const GALLERY_SLOT_DIMENSIONS = [
  { w: 1200, h: 1200, ratio: "1:1" },
  { w: 600, h: 600, ratio: "1:1" },
  { w: 600, h: 600, ratio: "1:1" },
  { w: 1200, h: 600, ratio: "2:1" },
] as const;

/**
 * Paleta jasna spójna z tokenami marki: akcent na brandzie NES (#FA9346),
 * żeby przycisk CTA był rozpoznawalny jak reszta platformy. Tekst na akcencie
 * wybierany jest przez accentInk() - na jasnym tle zostanie ciemny atrament.
 * Galeria zostaje ciemna (jak w projekcie referencyjnym) - zdjęcia mają na
 * czym oddychać, a gradient to głęboka grafitowa baza z delikatną poświatą
 * marki na końcu.
 */
export function defaultPopupLightTheme(): PopupThemeColors {
  return {
    bg: "#ffffff",
    fg: "#0b0b0f",
    muted: "#55555f",
    accent: "#FA9346",
    accentFg: "#ffffff",
    overlay: "rgba(10,10,15,0.55)",
    gradFrom: "#101014",
    gradTo: "#241a13",
  };
}

export function defaultPopupDesign(): PopupDesign {
  return {
    colorScheme: "dark",
    light: defaultPopupLightTheme(),
    controls: { dark: emptyPopupControlColors(), light: emptyPopupControlColors() },
    panel: { maxWidthPx: 1040, split: "half", showBorder: true, shadow: 60 },

    gallery: {
      grid: "reference",
      gradientAngle: 160,
      align: "center",
      order: [...GALLERY_BLOCKS],
      showLogo: true,
      logoUrl: "",
      logoHeightPx: 26,
      showFades: true,
      showCorners: true,
      showArrow: true,
      captionDashed: true,
      captionPrefixPl: "",
      captionPrefixEn: "",
      gapPx: 8,
      paddingPx: 28,
      gridHeightPx: 380,
      inactiveDim: 55,
    },
    form: {
      align: "center",
      showEyebrow: false,
      titleNoWrap: false,
      titleSizePx: 38,
      maxWidthPx: 400,
      twoColumnPairs: true,
      hintPl: "",
      hintEn: "",
      showLoginLink: true,
      loginLinkPl: "Masz już konto? Zaloguj się",
      loginLinkEn: "Already have an account? Sign in",
      loginLinkHref: "/login",
      ctaIcon: "user-plus",
    },
  };
}
