// Jedno źródło prawdy dla kolorystyki widgetu „Ikony social".
//
// Te same wartości zasilają:
//  - renderer (podgląd w builderze ORAZ strona publiczna - ten sam komponent),
//  - panel właściwości, który pokazuje FAKTYCZNIE użyty kolor zamiast pustego
//    pola „dziedziczy z global colors" (osobno dla light i dark mode).
//
// To są kolory MAREK ZEWNĘTRZNYCH - świadomie nie są tokenami naszego motywu.

export type SocialPlatformKey =
  "facebook" | "x" | "youtube" | "instagram" | "linkedin" | "spotify" | "newsletter";

/** Oficjalne kolory marek (bazowe, „surowe"). */
export const SOCIAL_OFFICIAL_COLOR: Record<string, string> = {
  facebook: "#1877F2",
  x: "#000000",
  youtube: "#FF0000",
  instagram: "#E4405F",
  linkedin: "#0A66C2",
  spotify: "#1DB954",
};

/**
 * Kolor ikony realnie wyrenderowany w stanie spoczynku, per tryb.
 * Light mode rozjaśnia kolor marki (czytelność na jasnym tle), dark mode
 * zostawia surowy kolor. Newsletter to nasza marka - token `--brand`.
 */
export const SOCIAL_IDLE_ICON_COLOR: Record<string, { light: string; dark: string }> = {
  facebook: { light: "#7BB0F8", dark: "#1877F2" },
  x: { light: "#9E9E9E", dark: "#FFFFFF" },
  youtube: { light: "#FF9E99", dark: "#FF0000" },
  instagram: { light: "#F09BAA", dark: "#E4405F" },
  linkedin: { light: "#74AAE3", dark: "#0A66C2" },
  spotify: { light: "#87E3AC", dark: "#1DB954" },
  newsletter: { light: "var(--brand)", dark: "#FFFFFF" },
};

/** Stopnie gradientu hoveru per platforma (od / do). */
export const SOCIAL_HOVER_GRADIENT: Record<string, { from: string; to: string }> = {
  facebook: { from: "#1877F2", to: "#0C5FD1" },
  x: { from: "#1A1A1A", to: "#000000" },
  youtube: { from: "#FF3B30", to: "#CC0000" },
  instagram: { from: "#F58529", to: "#8134AF" },
  linkedin: { from: "#0A66C2", to: "#004182" },
  spotify: { from: "#1ED760", to: "#14833B" },
  newsletter: {
    from: "color-mix(in oklab, var(--brand) 64%, #17110C)",
    to: "color-mix(in oklab, var(--brand) 16%, #0B0B10)",
  },
};

/** Ikona i tekst na hover: biel w OBU trybach - tak samo w builderze i public. */
export const SOCIAL_HOVER_ICON_COLOR = "#FFFFFF";
export const SOCIAL_HOVER_TEXT_COLOR = "#FFFFFF";

/** Gotowy CSS gradientu marki dla danej platformy. */
export function socialBrandGradient(key: string): string | undefined {
  const stops = SOCIAL_HOVER_GRADIENT[key];
  if (!stops) return undefined;
  if (key === "instagram") {
    return "linear-gradient(135deg, #F58529 0%, #DD2A7B 55%, #8134AF 100%)";
  }
  if (key === "newsletter") {
    return `linear-gradient(135deg, ${stops.from} 0%, color-mix(in oklab, var(--brand) 40%, #0F0C0A) 52%, ${stops.to} 100%)`;
  }
  return `linear-gradient(135deg, ${stops.from} 0%, ${stops.to} 100%)`;
}

/** Podpis „faktyczny kolor" pokazywany w panelu (light / dark). */
export function socialIdleColorHint(key: string): string {
  const tone = SOCIAL_IDLE_ICON_COLOR[key];
  if (!tone) return "";
  return `light: ${tone.light} - dark: ${tone.dark}`;
}
