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
 * Paleta jasna spójna z tokenami marki: akcent na brandzie NES (#fa9346),
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
    accent: "#fa9346",
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

// ---------- koercja ----------

/**
 * Ikona trafia do resolvera `DynamicIcon` po nazwie - przepuszczamy wyłącznie
 * kebab-case, żeby zapis z bazy nie mógł wskazać niczego spoza katalogu.
 */
function sanitizeIconName(value: string): string {
  const v = value.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) ? v : "";
}

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

/** Nadpisania kontrolek: przepuszczamy wyłącznie stringi, reszta = brak zmian. */
function resolveControlColors(raw: unknown): PopupControlColors {
  const d = emptyPopupControlColors();
  if (!isRecord(raw)) return d;
  const pick = (key: keyof PopupControlColors) =>
    typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
  return {
    checkboxBorder: pick("checkboxBorder"),
    checkboxHover: pick("checkboxHover"),
    checkboxChecked: pick("checkboxChecked"),
    checkboxLabel: pick("checkboxLabel"),
    checkboxLink: pick("checkboxLink"),
    buttonBg: pick("buttonBg"),
    buttonFg: pick("buttonFg"),
    buttonBorder: pick("buttonBorder"),
    buttonHoverBg: pick("buttonHoverBg"),
  };
}

/** Scala zapisany JSON z defaultami - zawsze zwraca komplet ustawień. */
export function resolvePopupDesign(raw: unknown): PopupDesign {
  const d = defaultPopupDesign();
  if (!isRecord(raw)) return d;

  const panel = isRecord(raw.panel) ? raw.panel : {};
  const gallery = isRecord(raw.gallery) ? raw.gallery : {};
  const form = isRecord(raw.form) ? raw.form : {};
  const controls = isRecord(raw.controls) ? raw.controls : {};

  return {
    colorScheme: oneOf(raw.colorScheme, ["dark", "light", "auto"] as const, d.colorScheme),
    light: resolveLightTheme(raw.light),
    controls: {
      dark: resolveControlColors(controls.dark),
      light: resolveControlColors(controls.light),
    },
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
      showEyebrow: bool(form.showEyebrow, d.form.showEyebrow),
      titleNoWrap: bool(form.titleNoWrap, d.form.titleNoWrap),
      titleSizePx: int(form.titleSizePx, d.form.titleSizePx, 18, 64),
      maxWidthPx: int(form.maxWidthPx, d.form.maxWidthPx, 280, 720),
      twoColumnPairs: bool(form.twoColumnPairs, d.form.twoColumnPairs),
      hintPl: str(form.hintPl, d.form.hintPl),
      hintEn: str(form.hintEn, d.form.hintEn),
      showLoginLink: bool(form.showLoginLink, d.form.showLoginLink),
      loginLinkPl: filled(form.loginLinkPl, d.form.loginLinkPl),
      loginLinkEn: filled(form.loginLinkEn, d.form.loginLinkEn),
      loginLinkHref: filled(form.loginLinkHref, d.form.loginLinkHref),
      // `str` (nie `filled`): pusty zapis to świadomy wybór „bez ikony",
      // więc nie może cofać się do domyślnej ikony przy każdym odczycie.
      ctaIcon: sanitizeIconName(str(form.ctaIcon, d.form.ctaIcon)),
    },
  };
}

// ---------- paleta ----------

export interface PopupPalette extends PopupThemeColors {
  /** true = powierzchnia ciemna (pola formularza w wariancie on-dark). */
  onDark: boolean;
  mode: "dark" | "light";
  /** Nadpisania kolorów checkboxów i przycisku CTA dla tego trybu. */
  controls: PopupControlColors;
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

/** Czy tło jest ciemne (decyduje o atramencie galerii i sile ramek). */
export function isDarkSurface(bg: string): boolean {
  const l = colorLuminance(bg);
  return l === null ? true : l < 0.4;
}

/** Kontrast WCAG między dwoma kolorami; null gdy któregoś nie da się sparsować. */
export function contrastRatio(a: string, b: string): number | null {
  const la = colorLuminance(a);
  const lb = colorLuminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Czytelny atrament dla danego tła - wybieramy z dwóch kandydatów ten o
 * lepszym kontraście, a nie po progu luminancji: markowy pomarańcz
 * (#fa9346, L≈0.42) leży dokładnie na granicy i próg wskazywałby biel,
 * która daje na nim 2.2:1, gdy ciemny atrament daje 8:1.
 */
export function readableInk(bg: string): string {
  const dark = "#141414";
  const light = "#ffffff";
  const onDark = contrastRatio(bg, dark);
  const onLight = contrastRatio(bg, light);
  if (onDark === null || onLight === null) return light;
  return onDark >= onLight ? dark : light;
}

/**
 * Atrament na akcencie z bramką kontrastu: zapisany kolor wygrywa, dopóki daje
 * min. 3:1 (progiem WCAG dla dużego tekstu i elementów UI). Historyczne wiersze
 * mają tu białą czcionkę na jasnym pomarańczu (~2.2:1) - w takim przypadku
 * podmieniamy na czytelny atrament, zamiast renderować nieczytelny przycisk.
 */
export function accentInk(accent: string, configured: string): string {
  const ratio = contrastRatio(accent, configured);
  if (ratio === null || ratio >= 3) return configured;
  return readableInk(accent);
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
    return {
      ...l,
      accentFg: accentInk(l.accent, l.accentFg),
      mode: "light",
      onDark: isDarkSurface(l.bg),
      controls: source.popup_design.controls.light,
    };
  }
  const bg = source.popup_bg_color || "#0b0b0f";
  const accent = source.popup_accent_color || "#fa9346";
  return {
    bg,
    fg: source.popup_text_color || "#ffffff",
    muted: source.popup_muted_color || "#a8a8b3",
    accent,
    accentFg: accentInk(accent, source.popup_accent_text_color || "#141414"),
    overlay: source.popup_overlay_color || dark.light.overlay,
    // Domyślny gradient galerii to spokojna, ciemna baza z delikatną poświatą
    // marki - akcent jako punkt startowy zalewał lewą kolumnę pomarańczem
    // i zabijał czytelność zdjęć oraz podpisów.
    gradFrom: source.popup_showcase_grad_from || bg,
    gradTo: source.popup_showcase_grad_to || `color-mix(in srgb, ${accent} 14%, ${bg})`,
    mode: "dark",
    onDark: isDarkSurface(bg),
    controls: source.popup_design.controls.dark,
  };
}

/**
 * Zmienne CSS panelu popupu. Poza własnymi tokenami `--nl-*` przedefiniowujemy
 * TU tokeny platformy (--background, --foreground, --border, --ring, --primary,
 * --brand, --gc-input-*), dzięki czemu popup jest hermetycznym zakresem: te same
 * komponenty (pola z pływającą etykietą, checkboxy, linki zgód, a nawet reguła
 * autouzupełniania Chrome, która maluje pole `var(--background)`) renderują się
 * poprawnie zarówno na stronie publicznej, jak i w podglądzie w jasnym adminie.
 * Bez tego panel dziedziczył kolory motywu adminu - stąd białe plamy w polach
 * i ciemny nagłówek na ciemnym tle.
 */
export function popupPaletteVars(palette: PopupPalette, radiusPx: number): Record<string, string> {
  const border = `color-mix(in srgb, ${palette.fg} 18%, transparent)`;
  // Kontrolki: nadpisanie z panelu admina wygrywa, w przeciwnym razie wartość
  // wyliczona z palety - dokładnie taka, jaka obowiązywała przed wdrożeniem
  // sekcji „Checkboxy i przyciski".
  const c = palette.controls;
  const btnBg = c.buttonBg || palette.accent;
  return {
    "--nl-cb-border": c.checkboxBorder || `color-mix(in srgb, ${palette.fg} 45%, transparent)`,
    "--nl-cb-hover": c.checkboxHover || c.checkboxChecked || palette.accent,
    "--nl-cb-checked": c.checkboxChecked || palette.accent,
    "--nl-cb-label": c.checkboxLabel || palette.muted,
    "--nl-cb-link": c.checkboxLink || palette.accent,
    "--nl-btn-bg": btnBg,
    "--nl-btn-fg": c.buttonFg || palette.accentFg,
    "--nl-btn-border": c.buttonBorder || `color-mix(in oklab, ${btnBg} 55%, transparent)`,
    "--nl-btn-hover-bg": c.buttonHoverBg || btnBg,
    "--nl-bg": palette.bg,
    "--nl-fg": palette.fg,
    "--nl-muted": palette.muted,
    "--nl-accent": palette.accent,
    "--nl-accent-fg": palette.accentFg,
    "--nl-radius": `${radiusPx}px`,
    // Tokeny platformy przemapowane na paletę popupu.
    "--background": palette.bg,
    "--foreground": palette.fg,
    "--card": palette.bg,
    "--card-foreground": palette.fg,
    "--popover": palette.bg,
    "--popover-foreground": palette.fg,
    "--border": border,
    "--input": border,
    "--ring": palette.accent,
    "--primary": palette.accent,
    "--primary-foreground": palette.accentFg,
    "--muted-foreground": palette.muted,
    "--brand": palette.accent,
    "--brand-foreground": palette.accentFg,
    "--brand-ink": palette.accent,
    // Etykiety pływające i placeholdery pól. 74% atramentu, bo 62% gubiło się
    // na ciemnym panelu referencyjnym - to JEDEN token dla podpowiedzi i dla
    // etykiety w spoczynku, dokładnie jak w widgecie „Dołącz do nas".
    "--gc-input-placeholder": `color-mix(in srgb, ${palette.fg} 74%, transparent)`,
    "--gc-input-placeholder-dark": `color-mix(in srgb, ${palette.fg} 74%, transparent)`,
    "--gc-input-placeholder-focus": `color-mix(in srgb, ${palette.fg} 48%, transparent)`,
    "--gc-input-placeholder-focus-dark": `color-mix(in srgb, ${palette.fg} 48%, transparent)`,
    "--gc-input-hover-border": `color-mix(in srgb, ${palette.fg} 34%, transparent)`,
    "--gc-input-focus-border": palette.accent,
    // Tło / atrament / ramka / rozmiar pisma pól. BEZ tych tokenów runtime'owy
    // <style> globalnych kolorów (globalColors.ts) - reguła BEZWARSTWOWA, więc
    // bije `@layer components`, niezależnie od specyficzności - malował pola
    // popupu jasnym `--gc-input-bg` motywu strony. Na ciemnym panelu wychodziły
    // z tego białe prostokąty, a pływająca etykieta (jasny atrament panelu)
    // stawała się na nich niewidoczna. Wartości odwzorowują dawne reguły `.nlp`,
    // tylko trafiają tam, gdzie wygrywają kaskadę.
    "--gc-input-bg": `color-mix(in srgb, ${palette.fg} 4%, transparent)`,
    "--gc-input-hover-bg": `color-mix(in srgb, ${palette.fg} 7%, transparent)`,
    "--gc-input-text": palette.fg,
    "--gc-input-border": border,
    // 14 px - tyle samo co pola widgetu „Dołącz do nas" (i platformowe
    // `--form-input-font-size`). Token, nie `!important` w CSS: mobilna
    // bramka iOS (`font-size: 16px !important` poniżej 768 px, przeciw
    // auto-zoomowi) musi nadal wygrywać.
    "--gc-input-text-size": "0.875rem",
  };
}

/** Tło galerii - gradient pod kątem z ustawień. */
export function galleryBackground(palette: PopupPalette, angleDeg: number): string {
  return `linear-gradient(${angleDeg}deg, ${palette.gradFrom} 0%, ${palette.gradTo} 78%)`;
}
