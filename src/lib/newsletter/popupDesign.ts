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

export type PopupColorScheme = "dark" | "light" | "auto";
/** Siatka galerii: "reference" = układ 1:1 z projektem, "mosaic" = 3x3, "single" = jeden kadr. */
export type PopupGalleryGrid = "reference" | "mosaic" | "single";
export type PopupAlign = "center" | "left";
/** Etykieta pola: "floating" = platformowa pływająca, "inline" = po prawej w polu (1:1). */
export type PopupFieldLabelStyle = "floating" | "inline";
export type PopupSplit = "half" | "gallery-wide" | "form-wide";
export type PopupSocialPosition = "top" | "bottom";

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
  labelStyle: PopupFieldLabelStyle;
  showEyebrow: boolean;
  /** Nagłówek w jednej linii (`whitespace-nowrap`) jak w projekcie. */
  titleNoWrap: boolean;
  titleSizePx: number;
  maxWidthPx: number;
  /** Imię i nazwisko (oraz e-mail/telefon, hasła) w dwóch kolumnach. */
  twoColumnPairs: boolean;
  showDivider: boolean;
  dividerPl: string;
  dividerEn: string;
  socialEnabled: boolean;
  socialPosition: PopupSocialPosition;
  socialGoogleLabelPl: string;
  socialGoogleLabelEn: string;
  /** Podpowiedź nad polami (opcjonalna, np. "Wypełnij dane"). */
  hintPl: string;
  hintEn: string;
  /** Link "Masz już konto? Zaloguj się". */
  showLoginLink: boolean;
  loginLinkPl: string;
  loginLinkEn: string;
  loginLinkHref: string;
}

export interface PopupPanelDesign {
  maxWidthPx: number;
  split: PopupSplit;
  showBorder: boolean;
  /** Cień panelu (0 = brak, 100 = maksymalny). */
  shadow: number;
}

export interface PopupDesign {
  colorScheme: PopupColorScheme;
  light: PopupThemeColors;
  panel: PopupPanelDesign;
  gallery: PopupGalleryDesign;
  form: PopupFormDesign;
}

/** Rozdzielczości rekomendowane dla kafli galerii (kolejność = slot w siatce). */
export const GALLERY_SLOT_DIMENSIONS = [
  { w: 1200, h: 1200, ratio: "1:1" },
  { w: 600, h: 600, ratio: "1:1" },
  { w: 600, h: 600, ratio: "1:1" },
  { w: 1200, h: 600, ratio: "2:1" },
] as const;

/**
 * Paleta jasna spójna z tokenami marki: akcent na --brand-ink (#b85410), bo
 * jasny pomarańcz nie przechodzi WCAG AA jako tło tekstu. Galeria zostaje
 * ciemna (jak w projekcie referencyjnym) - zdjęcia mają na czym oddychać.
 */
export function defaultPopupLightTheme(): PopupThemeColors {
  return {
    bg: "#ffffff",
    fg: "#0b0b0f",
    muted: "#55555f",
    accent: "#b85410",
    accentFg: "#ffffff",
    overlay: "rgba(10,10,15,0.55)",
    gradFrom: "#101014",
    gradTo: "#b85410",
  };
}

export function defaultPopupDesign(): PopupDesign {
  return {
    colorScheme: "dark",
    light: defaultPopupLightTheme(),
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
      labelStyle: "floating",
      showEyebrow: false,
      titleNoWrap: false,
      titleSizePx: 38,
      maxWidthPx: 460,
      twoColumnPairs: true,
      showDivider: true,
      dividerPl: "lub",
      dividerEn: "or",
      socialEnabled: false,
      socialPosition: "top",
      socialGoogleLabelPl: "Kontynuuj z Google",
      socialGoogleLabelEn: "Continue with Google",
      hintPl: "",
      hintEn: "",
      showLoginLink: true,
      loginLinkPl: "Masz już konto? Zaloguj się",
      loginLinkEn: "Already have an account? Sign in",
      loginLinkHref: "/login",
    },
  };
}

// ---------- koercja ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** Jak `str`, ale puste/białe znaki też wracają do defaultu (etykiety, kolory). */
function filled(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Kolejność bloków: znane id-ki bez duplikatów, brakujące dopięte na końcu. */
export function resolveGalleryOrder(raw: unknown): GalleryBlock[] {
  const out: GalleryBlock[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const block = GALLERY_BLOCKS.find((b) => b === item);
      if (block && !out.includes(block)) out.push(block);
    }
  }
  for (const block of GALLERY_BLOCKS) if (!out.includes(block)) out.push(block);
  return out;
}

function resolveLightTheme(raw: unknown): PopupThemeColors {
  const d = defaultPopupLightTheme();
  if (!isRecord(raw)) return d;
  return {
    bg: filled(raw.bg, d.bg),
    fg: filled(raw.fg, d.fg),
    muted: filled(raw.muted, d.muted),
    accent: filled(raw.accent, d.accent),
    accentFg: filled(raw.accentFg, d.accentFg),
    overlay: filled(raw.overlay, d.overlay),
    gradFrom: filled(raw.gradFrom, d.gradFrom),
    gradTo: filled(raw.gradTo, d.gradTo),
  };
}

/** Scala zapisany JSON z defaultami - zawsze zwraca komplet ustawień. */
export function resolvePopupDesign(raw: unknown): PopupDesign {
  const d = defaultPopupDesign();
  if (!isRecord(raw)) return d;

  const panel = isRecord(raw.panel) ? raw.panel : {};
  const gallery = isRecord(raw.gallery) ? raw.gallery : {};
  const form = isRecord(raw.form) ? raw.form : {};

  return {
    colorScheme: oneOf(raw.colorScheme, ["dark", "light", "auto"] as const, d.colorScheme),
    light: resolveLightTheme(raw.light),
    panel: {
      maxWidthPx: int(panel.maxWidthPx, d.panel.maxWidthPx, 480, 1600),
      split: oneOf(panel.split, ["half", "gallery-wide", "form-wide"] as const, d.panel.split),
      showBorder: bool(panel.showBorder, d.panel.showBorder),
      shadow: int(panel.shadow, d.panel.shadow, 0, 100),
    },
    gallery: {
      grid: oneOf(gallery.grid, ["reference", "mosaic", "single"] as const, d.gallery.grid),
      gradientAngle: int(gallery.gradientAngle, d.gallery.gradientAngle, 0, 360),
      align: oneOf(gallery.align, ["center", "left"] as const, d.gallery.align),
      order: resolveGalleryOrder(gallery.order),
      showLogo: bool(gallery.showLogo, d.gallery.showLogo),
      logoUrl: str(gallery.logoUrl, d.gallery.logoUrl),
      logoHeightPx: int(gallery.logoHeightPx, d.gallery.logoHeightPx, 12, 96),
      showFades: bool(gallery.showFades, d.gallery.showFades),
      showCorners: bool(gallery.showCorners, d.gallery.showCorners),
      showArrow: bool(gallery.showArrow, d.gallery.showArrow),
      captionDashed: bool(gallery.captionDashed, d.gallery.captionDashed),
      captionPrefixPl: str(gallery.captionPrefixPl, d.gallery.captionPrefixPl),
      captionPrefixEn: str(gallery.captionPrefixEn, d.gallery.captionPrefixEn),
      gapPx: int(gallery.gapPx, d.gallery.gapPx, 0, 32),
      paddingPx: int(gallery.paddingPx, d.gallery.paddingPx, 8, 80),
      gridHeightPx: int(gallery.gridHeightPx, d.gallery.gridHeightPx, 200, 720),
      inactiveDim: int(gallery.inactiveDim, d.gallery.inactiveDim, 0, 100),
    },
    form: {
      align: oneOf(form.align, ["center", "left"] as const, d.form.align),
      labelStyle: oneOf(form.labelStyle, ["floating", "inline"] as const, d.form.labelStyle),
      showEyebrow: bool(form.showEyebrow, d.form.showEyebrow),
      titleNoWrap: bool(form.titleNoWrap, d.form.titleNoWrap),
      titleSizePx: int(form.titleSizePx, d.form.titleSizePx, 18, 64),
      maxWidthPx: int(form.maxWidthPx, d.form.maxWidthPx, 280, 720),
      twoColumnPairs: bool(form.twoColumnPairs, d.form.twoColumnPairs),
      showDivider: bool(form.showDivider, d.form.showDivider),
      dividerPl: filled(form.dividerPl, d.form.dividerPl),
      dividerEn: filled(form.dividerEn, d.form.dividerEn),
      socialEnabled: bool(form.socialEnabled, d.form.socialEnabled),
      socialPosition: oneOf(form.socialPosition, ["top", "bottom"] as const, d.form.socialPosition),
      socialGoogleLabelPl: filled(form.socialGoogleLabelPl, d.form.socialGoogleLabelPl),
      socialGoogleLabelEn: filled(form.socialGoogleLabelEn, d.form.socialGoogleLabelEn),
      hintPl: str(form.hintPl, d.form.hintPl),
      hintEn: str(form.hintEn, d.form.hintEn),
      showLoginLink: bool(form.showLoginLink, d.form.showLoginLink),
      loginLinkPl: filled(form.loginLinkPl, d.form.loginLinkPl),
      loginLinkEn: filled(form.loginLinkEn, d.form.loginLinkEn),
      loginLinkHref: filled(form.loginLinkHref, d.form.loginLinkHref),
    },
  };
}

// ---------- paleta ----------

export interface PopupPalette extends PopupThemeColors {
  /** true = powierzchnia ciemna (pola formularza w wariancie on-dark). */
  onDark: boolean;
  mode: "dark" | "light";
}

/** Minimalny kontrakt kolorów, jaki musi spełniać wiersz `newsletter_settings`. */
export interface PopupColorSource {
  popup_bg_color: string;
  popup_text_color: string;
  popup_muted_color: string;
  popup_accent_color: string;
  popup_accent_text_color: string;
  popup_overlay_color: string;
  popup_showcase_grad_from: string | null;
  popup_showcase_grad_to: string | null;
  popup_design: PopupDesign;
}

/** Relatywna luminancja koloru zapisanego jako #rgb / #rrggbb / rgb(a)(). */
export function colorLuminance(color: string): number | null {
  const value = color.trim().toLowerCase();
  let r: number, g: number, b: number;

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (hex) {
    const h = hex[1];
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  } else {
    const rgb = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/.exec(value);
    if (!rgb) return null;
    r = Number(rgb[1]);
    g = Number(rgb[2]);
    b = Number(rgb[3]);
  }

  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Czy tło jest ciemne (decyduje o wariancie pól i sile ramek). */
export function isDarkSurface(bg: string): boolean {
  const l = colorLuminance(bg);
  return l === null ? true : l < 0.4;
}

/** Który wariant palety obowiązuje przy danym motywie strony. */
export function effectivePopupMode(
  design: PopupDesign,
  siteTheme: "light" | "dark",
): "light" | "dark" {
  if (design.colorScheme === "auto") return siteTheme;
  return design.colorScheme;
}

/** Efektywna paleta popupu - kolumny = ciemna, `popup_design.light` = jasna. */
export function resolvePopupPalette(
  source: PopupColorSource,
  mode: "light" | "dark",
): PopupPalette {
  const dark = defaultPopupDesign();
  if (mode === "light") {
    const l = source.popup_design.light;
    return { ...l, mode: "light", onDark: isDarkSurface(l.bg) };
  }
  const bg = source.popup_bg_color || "#0a0a0a";
  const accent = source.popup_accent_color || "#f97316";
  return {
    bg,
    fg: source.popup_text_color || "#ffffff",
    muted: source.popup_muted_color || "#b8b8b8",
    accent,
    accentFg: source.popup_accent_text_color || "#ffffff",
    overlay: source.popup_overlay_color || dark.light.overlay,
    gradFrom: source.popup_showcase_grad_from || accent,
    gradTo: source.popup_showcase_grad_to || bg,
    mode: "dark",
    onDark: isDarkSurface(bg),
  };
}

/** Zmienne CSS konsumowane przez panel popupu i atomy formularza. */
export function popupPaletteVars(palette: PopupPalette, radiusPx: number): Record<string, string> {
  return {
    "--nl-bg": palette.bg,
    "--nl-fg": palette.fg,
    "--nl-muted": palette.muted,
    "--nl-accent": palette.accent,
    "--nl-accent-fg": palette.accentFg,
    "--nl-radius": `${radiusPx}px`,
    "--brand": palette.accent,
    "--brand-foreground": palette.accentFg,
  };
}

/** Tło galerii - gradient pod kątem z ustawień. */
export function galleryBackground(palette: PopupPalette, angleDeg: number): string {
  return `linear-gradient(${angleDeg}deg, ${palette.gradFrom} 0%, ${palette.gradTo} 78%)`;
}

/** Przezroczysta warstwa koloru tekstu - ramki, tła kafelków, chipy. */
export function fgAlpha(percent: number): string {
  return `color-mix(in srgb, var(--nl-fg) ${percent}%, transparent)`;
}
