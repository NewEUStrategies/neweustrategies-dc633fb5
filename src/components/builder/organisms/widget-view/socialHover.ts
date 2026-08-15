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

/** Luminancja postrzegana dla zapisów, które da się sparsować lokalnie. */
function luminance(color: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const digits = m[1];
  const pairs =
    digits.length === 3
      ? [...digits].map((ch) => ch + ch)
      : [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)];
  const lin = pairs.map((pair) => {
    const v = parseInt(pair, 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Czytelny kolor treści na podanym tle; dla zapisów nieparsowalnych - biel. */
function readableOn(bg: string): string {
  const l = luminance(bg);
  return l !== null && l > 0.42 ? "#141414" : "#ffffff";
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
