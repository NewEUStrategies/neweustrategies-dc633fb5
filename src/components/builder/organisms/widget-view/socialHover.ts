// Podświetlenie ikon social po najechaniu: paleta gradientów, ton ikony i CSS
// o zasięgu instancji widgetu.
//
// DLACZEGO CSS W <style>, A NIE KLASY TAILWINDA
//  1. Ważność zapisuje się w Tailwindzie 4 SUFIKSEM (`[color:red]!`). Klasa
//     `group-hover:![color:var(--sb-fg)]` (składnia z v3, używana tu wcześniej)
//     nie generowała ŻADNEJ reguły, więc ikona z jawnym kolorem (`colorMode`
//     dark / custom / brand / official) zostawała po najechaniu ciemna także w
//     light mode. Kafelek trzyma kolor w atrybucie `style`, a bez `!important`
//     żadna klasa go nie przebije - stąd reguła w arkuszu, nie w klasie.
//  2. Kolory hovera są USTAWIENIEM redakcji (tonacja, własny kolor). Skaner
//     Tailwinda widzi wyłącznie klasy literalne w źródle, więc wartości z bazy
//     nie da się wyrazić klasą - CSS o zasięgu instancji przyjmuje dowolną
//     wartość przepuszczoną przez `safeWidgetColor`.
//  3. Jedna definicja obsługuje `:hover`, `:focus-visible` ORAZ wymuszony
//     podgląd hovera w panelu buildera (`[data-social-hover-preview]`), więc
//     podgląd nie może rozjechać się ze stroną publiczną - to ta sama reguła.
//
// BEZPIECZEŃSTWO: do arkusza wchodzą tylko wartości z tabel w tym pliku albo
// kolory przepuszczone przez `safeWidgetColor` (whitelist zapisów CSS), a nazwa
// klasy jest skrótem treści arkusza - nie ma drogi dla treści redakcyjnej.

/** Klasy-uchwyty części wiersza. Nie są klasami Tailwinda - celują w nie
 *  wyłącznie reguły z `socialHoverStyle`, zawsze zawężone klasą instancji. */
export const SB_ROW = "sb-row";
export const SB_CHIP = "sb-chip";
export const SB_SEP = "sb-sep";
export const SB_LABEL = "sb-label";
export const SB_CTA = "sb-cta";
/** Kafelek ikony w układzie „rząd" (bez etykiety i CTA). */
export const SB_TILE = "sb-tile";

/** Atrybut, którym panel buildera wymusza stan hovera w podglądzie widgetu. */
export const SOCIAL_HOVER_PREVIEW_ATTR = "data-social-hover-preview";

/** Oficjalne kolory marek - używane przez tryby „oficjalne" (ikona, tło, hover). */
export const SOCIAL_OFFICIAL_COLORS: Readonly<Record<string, string | undefined>> = {
  facebook: "#1877F2",
  x: "#000000",
  youtube: "#FF0000",
  instagram: "#E4405F",
  linkedin: "#0A66C2",
  spotify: "#1DB954",
};

/** Tryby podświetlenia wiersza / kafelka po najechaniu. */
export const SOCIAL_ROW_HOVER_MODES = [
  "brand",
  "house",
  "soft",
  "outline",
  "custom",
  "none",
] as const;
export type SocialRowHover = (typeof SOCIAL_ROW_HOVER_MODES)[number];

/** Ton ikony po najechaniu. */
export const SOCIAL_HOVER_ICON_MODES = [
  "auto",
  "light",
  "brand",
  "official",
  "custom",
  "keep",
] as const;
export type SocialHoverIcon = (typeof SOCIAL_HOVER_ICON_MODES)[number];

/** Tonacje firmowego (pomarańczowego) gradientu. */
export const SOCIAL_HOUSE_TONES = ["amber", "cognac", "ember", "sunset"] as const;
export type SocialHouseTone = (typeof SOCIAL_HOUSE_TONES)[number];

/**
 * Firmowe tonacje gradientu - liczone z tokenu `--brand` (#fa9346), żeby zmiana
 * koloru marki w Opcjach motywu przeszła przez cały zestaw.
 *
 * Każda rampa jest DOMIESZANA ciepłą ciemnością (palona umbra, nie zimna czerń),
 * bo na gradiencie leżą biała etykieta i białe CTA: czysty `--brand` daje z
 * bielą ~2,2:1, a te miksy trzymają >= 4,5:1 na całej długości paska. Rampa
 * jaśnieje przy ikonie i gaśnie po prawej, gdzie siedzi CTA - stąd wrażenie
 * głębi zamiast płaskiej plamy.
 */
export const SOCIAL_HOUSE_GRADIENTS: Readonly<Record<SocialHouseTone, string>> = {
  // Bursztyn - domyślny: najbliżej `--gradient-brand`, ciepły i spokojny.
  amber:
    "linear-gradient(135deg, color-mix(in oklab, var(--brand) 62%, #2B1408) 0%, color-mix(in oklab, var(--brand) 45%, #1D0E06) 54%, color-mix(in oklab, var(--brand) 28%, #150B05) 100%)",
  // Koniak - więcej czerwieni, mniej żółci; cieplejszy „skórzany" ton.
  cognac:
    "linear-gradient(135deg, color-mix(in oklab, var(--brand) 56%, #5C2109) 0%, color-mix(in oklab, var(--brand) 38%, #351206) 55%, color-mix(in oklab, var(--brand) 20%, #1A0A05) 100%)",
  // Żar - najgłębsza rampa, do ciemnych sekcji i stopki.
  ember:
    "linear-gradient(135deg, color-mix(in oklab, var(--brand) 48%, #241008) 0%, color-mix(in oklab, var(--brand) 30%, #170A06) 52%, color-mix(in oklab, var(--brand) 15%, #0E0705) 100%)",
  // Zachód słońca - pomarańcz schodzący w przygaszony burgund.
  sunset:
    "linear-gradient(120deg, color-mix(in oklab, var(--brand) 66%, #33170A) 0%, color-mix(in oklab, var(--brand) 44%, #46161A) 56%, color-mix(in oklab, var(--brand) 22%, #1B0C10) 100%)",
};

/**
 * Gradienty marek zewnętrznych - kolory pochodzą z ich oficjalnych palet, ale
 * rampy są POGŁĘBIONE względem barwy logotypu, bo na nich leży biały tekst
 * (surowy `#1ED760` Spotify daje z bielą 1,7:1). Odcień pozostaje rozpoznawalny,
 * a kontrast wchodzi w AA.
 */
export const SOCIAL_BRAND_GRADIENTS: Readonly<Record<string, string | undefined>> = {
  facebook: "linear-gradient(135deg, #1567D6 0%, #0A3E85 100%)",
  x: "linear-gradient(135deg, #262626 0%, #000000 100%)",
  youtube: "linear-gradient(135deg, #D8221A 0%, #8E0F0A 100%)",
  instagram: "linear-gradient(135deg, #C2551F 0%, #B4225F 48%, #6A2A9C 100%)",
  linkedin: "linear-gradient(135deg, #0A66C2 0%, #013A70 100%)",
  spotify: "linear-gradient(135deg, #0C7A35 0%, #064F20 100%)",
};

/**
 * Warstwa blasku kładziona NAD gradientem - delikatne rozjaśnienie górnej
 * krawędzi. To ona odpowiada za „prestiżowy", a nie plakatowy odbiór paska.
 */
const SHEEN =
  "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.05) 38%, rgba(255,255,255,0) 62%)";

/** Uniesienie paska - cień pod wierszem, tylko dla trybów z gradientem. */
const LIFT = "0 10px 24px -16px rgba(0,0,0,0.55)";

/** Delikatne podświetlenie tokenem marki (tryb „soft"). */
const SOFT_TINT =
  "linear-gradient(135deg, color-mix(in oklab, var(--brand) 16%, transparent) 0%, color-mix(in oklab, var(--brand) 7%, transparent) 100%)";

/** Ustawienia hovera po normalizacji (kolory już przepuszczone whitelistą). */
export interface SocialHoverPlan {
  readonly mode: SocialRowHover;
  readonly tone: SocialHouseTone;
  readonly iconMode: SocialHoverIcon;
  /** Własny kolor podświetlenia (tryb „custom"); "" = brak. */
  readonly rowColor: string;
  /** Własny kolor ikony po najechaniu (tryb „custom"); "" = brak. */
  readonly iconColor: string;
}

/** Czy tryb maluje tło wiersza (a więc korzysta z `--sb-grad`). */
const paintsBackground = (mode: SocialRowHover): boolean =>
  mode === "brand" || mode === "house" || mode === "custom" || mode === "soft";

/** Czy tło jest pełne i głębokie - tylko wtedy dokładamy blask i uniesienie. */
const isDeep = (mode: SocialRowHover): boolean =>
  mode === "brand" || mode === "house" || mode === "custom";

/** Kanały sRGB (0-255) plus alfa (0-1), wyłuskane z zapisu koloru. */
interface RgbaChannels {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_FUNC_RE = /^rgba?\(([^()]*)\)$/i;
const HSL_FUNC_RE = /^hsla?\(([^()]*)\)$/i;

/** Argumenty funkcji koloru: `a, b, c` i `a b c / d` dają tę samą listę. */
function splitColorArgs(inside: string): string[] {
  return inside
    .replace(/\//g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);
}

/** Liczba albo procent skalowany do `scale`; `deg` przy odcieniu jest opcjonalny. */
function colorNumber(token: string, scale: number): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(%|deg)?$/.exec(token);
  if (!m) return null;
  const v = Number.parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  return m[2] === "%" ? (v / 100) * scale : v;
}

/** Nasycenie i jasność w `hsl()` są z definicji procentami - bez `%` odrzucamy. */
function colorPercent(token: string): number | null {
  return token.endsWith("%") ? colorNumber(token, 1) : null;
}

function parseHexColor(value: string): RgbaChannels | null {
  const m = HEX_RE.exec(value);
  if (!m) return null;
  const d = m[1];
  const twice = (ch: string) => Number.parseInt(ch + ch, 16);
  if (d.length === 3 || d.length === 4) {
    return {
      r: twice(d[0]),
      g: twice(d[1]),
      b: twice(d[2]),
      a: d.length === 4 ? twice(d[3]) / 255 : 1,
    };
  }
  if (d.length === 6 || d.length === 8) {
    const pair = (i: number) => Number.parseInt(d.slice(i, i + 2), 16);
    return { r: pair(0), g: pair(2), b: pair(4), a: d.length === 8 ? pair(6) / 255 : 1 };
  }
  // Zapisy 5- i 7-znakowe nie są kolorem, choć przechodzą przez `HEX_RE`.
  return null;
}

function parseRgbColor(value: string): RgbaChannels | null {
  const m = RGB_FUNC_RE.exec(value);
  if (!m) return null;
  const parts = splitColorArgs(m[1]);
  if (parts.length < 3 || parts.length > 4) return null;
  const r = colorNumber(parts[0], 255);
  const g = colorNumber(parts[1], 255);
  const b = colorNumber(parts[2], 255);
  const a = parts.length === 4 ? colorNumber(parts[3], 1) : 1;
  if (r === null || g === null || b === null || a === null) return null;
  return { r, g, b, a };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(Math.max(s, 0), 1);
  const light = Math.min(Math.max(l, 0), 1);
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  const seg = Math.floor(hue / 60) % 6;
  const rgb =
    seg === 0
      ? [c, x, 0]
      : seg === 1
        ? [x, c, 0]
        : seg === 2
          ? [0, c, x]
          : seg === 3
            ? [0, x, c]
            : seg === 4
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 };
}

function parseHslColor(value: string): RgbaChannels | null {
  const m = HSL_FUNC_RE.exec(value);
  if (!m) return null;
  const parts = splitColorArgs(m[1]);
  if (parts.length < 3 || parts.length > 4) return null;
  const h = colorNumber(parts[0], 360);
  const s = colorPercent(parts[1]);
  const l = colorPercent(parts[2]);
  const a = parts.length === 4 ? colorNumber(parts[3], 1) : 1;
  if (h === null || s === null || l === null || a === null) return null;
  return { ...hslToRgb(h, s, l), a };
}

/**
 * Luminancja postrzegana (WCAG relative luminance) dla zapisów, które da się
 * policzyć LOKALNIE, bez layoutu: hex 3/4/6/8, `rgb()`/`rgba()` i `hsl()`/`hsla()`
 * w obu składniach (przecinkowej i ze spacją + `/`), kanały jako liczby lub procenty.
 *
 * `null` (czyli „nie wiem") dla wszystkiego, czego policzyć się NIE DA:
 * `var(--…)`, `currentcolor`, `transparent` oraz przestrzeni percepcyjnych
 * (`hwb`, `oklab`, `oklch`, `lab`, `lch`, `color()`). Zgadywanie ich jasności
 * wymagałoby wartości obliczonej z layoutu, której ten moduł nie widzi.
 *
 * ALFA. Kolor NIEPRZEZROCZYSTY liczymy normalnie (`#ffffffff`, `#ffff`,
 * `rgba(…, 1)`). Kolor półprzezroczysty daje `null`, bo komponuje się z tłem
 * strony, którego ten moduł nie zna - dokładnie z tego samego powodu, dla
 * którego `transparent` nie ma luminancji.
 */
export function luminance(color: string): number | null {
  const value = color.trim();
  const rgba = parseHexColor(value) ?? parseRgbColor(value) ?? parseHslColor(value);
  if (!rgba) return null;
  // Zapis odwrotny (`!(a >= 1)`) łapie też NaN, którego `a < 1` by przepuściło.
  if (!(rgba.a >= 1)) return null;
  const lin = [rgba.r, rgba.g, rgba.b].map((channel) => {
    const v = Math.min(Math.max(channel, 0), 255) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Ciemny tusz treści - token `--background` motywu ciemnego (`styles.css:304`). */
const READABLE_INK = "#141414";

/**
 * Próg jasności tła, powyżej którego czytelniejszy jest ciemny tusz.
 *
 * ZMIERZONE 2026-09-04 (`src/components/builder/organisms/widget-view/__tests__/socialHoverContrast.test.ts`,
 * wzór kontrastu WCAG `(L1+0,05)/(L2+0,05)`):
 *   L(#ffffff) = 1,000000 ; L(#141414) = 0,00699541
 *   biel trzyma 4,5:1 tylko dla   L(tła) <= 0,183333
 *   #141414 trzyma 4,5:1 tylko dla L(tła) >= 0,206479
 * Te dwa okna SIĘ NIE STYKAJĄ, więc dla TEJ PARY kolorów NIE ISTNIEJE próg,
 * który utrzymałby 4,5:1 na całym zakresie - w paśmie (0,1833 ; 0,2065) żaden
 * z dwóch kolorów nie osiąga AA. To jest zarejestrowane jako `it.fails`
 * w teście wyżej, razem z wartością, która by to naprawiła: tusz nie jaśniejszy
 * niż #060606 (wtedy próg 0,1832 domyka obie strony). Nie biorę tej zmiany
 * tutaj, bo #141414 to token palety (`--background` trybu ciemnego), a nie
 * lokalna stała tego modułu - to decyzja o palecie, nie o kontraście.
 *
 * Próg poniżej jest punktem ZRÓWNANIA obu kontrastów, czyli maksymalizuje
 * gwarantowane minimum: `(t+0,05)^2 = 1,05 * (L(#141414)+0,05)` daje
 * t = 0,194633 i podłogę 4,292:1 po OBU stronach.
 * Poprzednia wartość 0,42 dawała bieli na tle o tej jasności 2,234:1 - czyli
 * mniej niż połowę wymagania AA i źródło defektu „biel na bieli".
 */
const READABLE_ON_LUMINANCE_THRESHOLD = 0.1946;

/**
 * Czytelny kolor treści na podanym tle.
 *
 * Tło NIEPOLICZALNE nie dostaje już bieli (to był defekt: `safeWidgetColor`
 * przepuszcza dziesięć zapisów, których stary `luminance` nie umiał, a każdy
 * z nich lądował na `#ffffff` - biały napis na jasnym wierszu). Zamiast tego
 * oddajemy `var(--foreground)`, ten sam token, co gałąź „soft" niżej: jest
 * czytelny na `--background` z definicji, więc jest bezpieczny na tle, którego
 * jasności nie znamy.
 */
export function readableOn(bg: string): string {
  const l = luminance(bg);
  if (l === null) return "var(--foreground)";
  return l > READABLE_ON_LUMINANCE_THRESHOLD ? READABLE_INK : "#ffffff";
}

/** Kolor tekstu wiersza po najechaniu; `undefined` = nie zmieniaj. */
export function socialHoverForeground(plan: SocialHoverPlan): string | undefined {
  switch (plan.mode) {
    case "brand":
    case "house":
      return "#ffffff";
    case "custom":
      return plan.rowColor ? readableOn(plan.rowColor) : "#ffffff";
    case "soft":
      return "var(--foreground)";
    case "outline":
      return "var(--brand-ink, var(--brand))";
    default:
      return undefined;
  }
}

/** Tło (background-image) wiersza danej platformy; `undefined` = brak tła. */
export function socialHoverGradient(plan: SocialHoverPlan, platform: string): string | undefined {
  const house = SOCIAL_HOUSE_GRADIENTS[plan.tone];
  switch (plan.mode) {
    case "brand":
      // Newsletter to NASZA marka, więc bierze firmową tonację, a nie paletę
      // obcego serwisu - dlatego rampa domowa jest tu fallbackiem.
      return SOCIAL_BRAND_GRADIENTS[platform] ?? house;
    case "house":
      return house;
    case "soft":
      return SOFT_TINT;
    case "custom":
      return plan.rowColor
        ? `linear-gradient(135deg, ${plan.rowColor} 0%, color-mix(in oklab, ${plan.rowColor} 72%, #120A06) 100%)`
        : house;
    default:
      return undefined;
  }
}

/** Kolor ikony po najechaniu; `undefined` = zostaw kolor podstawowy. */
export function socialHoverIconColor(plan: SocialHoverPlan, platform: string): string | undefined {
  switch (plan.iconMode) {
    case "light":
      return "#ffffff";
    case "brand":
      return "var(--brand)";
    case "official":
      return SOCIAL_OFFICIAL_COLORS[platform] ?? "var(--brand)";
    case "custom":
      return plan.iconColor || "#ffffff";
    case "keep":
      return undefined;
    default:
      // „Automatycznie" = dobierz do tła hovera. Na gradiencie marki / firmowym
      // ikona musi być JASNA również w light mode (tego wymaga redakcja), a na
      // delikatnym lub przezroczystym tle bierze ciemniejszy atrament marki.
      if (plan.mode === "brand" || plan.mode === "house" || plan.mode === "custom")
        return "#ffffff";
      if (plan.mode === "soft" || plan.mode === "outline") return "var(--brand-ink, var(--brand))";
      return undefined;
  }
}

/** Obramowanie wiersza po najechaniu; `undefined` = bez zmiany. */
function hoverBorder(plan: SocialHoverPlan): string | undefined {
  if (plan.mode === "outline") return "var(--brand)";
  if (plan.mode === "soft") return "color-mix(in oklab, var(--brand) 32%, transparent)";
  if (plan.mode === "none") return undefined;
  return "transparent";
}

/** Skrót FNV-1a - nazwa klasy instancji jest funkcją TREŚCI arkusza, więc dwa
 *  widgety o tej samej konfiguracji dzielą regułę, a różne nigdy nie kolidują. */
function hashCss(css: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < css.length; i += 1) {
    h ^= css.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const UID = "%U%";

/** Trzy stany, które mają wyglądać identycznie: hover, fokus i podgląd panelu. */
function states(root: string): string[] {
  return [
    `.${UID} ${root}:hover`,
    `.${UID} ${root}:focus-visible`,
    `[${SOCIAL_HOVER_PREVIEW_ATTR}] .${UID} ${root}`,
  ];
}

const on = (roots: string[], child?: string): string =>
  roots.map((s) => (child ? `${s} ${child}` : s)).join(",");

/**
 * Arkusz o zasięgu instancji dla podświetlenia ikon. `null`, gdy ustawienia nie
 * zmieniają niczego po najechaniu (tryb „brak" bez własnego tonu ikony).
 *
 * Zwracana klasa idzie na kontener widgetu; per-wiersz renderer podaje jeszcze
 * `--sb-grad` (gradient platformy) i `--sb-ico-h` (ton ikony platformy).
 */
export function socialHoverStyle(plan: SocialHoverPlan): { uid: string; css: string } | null {
  const fg = socialHoverForeground(plan);
  const border = hoverBorder(plan);
  const paintsIcon = socialHoverIconColor(plan, "facebook") !== undefined;
  const paintsRow = plan.mode !== "none";
  if (!paintsRow && !paintsIcon) return null;

  const rowStates = states(`.${SB_ROW}`);
  const tileStates = states(`.${SB_TILE}`);
  const rules: string[] = [
    `.${UID} .${SB_ROW},.${UID} .${SB_TILE}{transition:background-image .2s ease,background-color .2s ease,color .18s ease,border-color .18s ease,box-shadow .2s ease}`,
  ];

  const rowDecls: string[] = [];
  if (border) rowDecls.push(`border-color:${border}`);
  if (fg) rowDecls.push(`color:${fg}`);
  if (paintsBackground(plan.mode)) {
    // `--sb-grad` przychodzi z wiersza (gradient zależy od platformy). Blask i
    // uniesienie tylko tam, gdzie pod spodem leży pełne, głębokie tło.
    rowDecls.push(
      isDeep(plan.mode)
        ? `background-image:${SHEEN},var(--sb-grad)`
        : "background-image:var(--sb-grad)",
    );
    if (isDeep(plan.mode)) rowDecls.push(`box-shadow:${LIFT}`);
  }
  if (rowDecls.length) {
    rules.push(`${on(rowStates)}{${rowDecls.join(";")}}`);
    // Kafelek w układzie „rząd" dostaje to samo tło - inaczej to samo ustawienie
    // działałoby tylko w jednym układzie (regresja, którą już raz naprawialiśmy).
    const tileDecls = rowDecls.filter((d) => !d.startsWith("color:"));
    if (tileDecls.length) rules.push(`${on(tileStates)}{${tileDecls.join(";")}}`);
  }

  if (paintsIcon) {
    // `!important`, bo kafelek trzyma kolor i tło w atrybucie `style` (kolor
    // ikony jest ustawieniem, więc nie da się go wyrazić klasą). Kolor trzeba
    // wymusić również bezpośrednio na SVG: publiczny arkusz ikon nadaje SVG
    // własne `color`, przez co samo białe `color` na wrapperze nie było
    // dziedziczone. To był właściwy powód czarnych ikon w light mode.
    rules.push(
      `${on(rowStates, `.${SB_CHIP}`)},${on(rowStates, `.${SB_CHIP} svg`)},${on(tileStates)},${on(tileStates, "svg")}{color:var(--sb-ico-h)!important}`,
      `${on(rowStates, `.${SB_CHIP}`)}{background-color:transparent!important}`,
    );
  }

  if (fg) {
    rules.push(
      `${on(rowStates, `.${SB_LABEL}`)},${on(rowStates, `.${SB_CTA}`)}{color:${fg}}`,
      `${on(rowStates, `.${SB_SEP}`)}{background-color:color-mix(in oklab, ${fg} 65%, transparent)}`,
    );
  }

  const body = rules.join("");
  const uid = `sbw-${hashCss(body)}`;
  return { uid, css: body.split(UID).join(uid) };
}
