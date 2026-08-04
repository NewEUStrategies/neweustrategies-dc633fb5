// Ustawienia prezentacji karty profilu autora - JEDEN odczyt dla obu edytorów.
//
// Te same klucze zapisuje panel widgetu `author-profile-card` (builder
// Elementor-like) i panel wariantu `profile` bloku `author-bio` (block editor /
// Gutenberg). Wspólny czytnik gwarantuje, że dokument przeniesiony między
// edytorami wygląda identycznie, a dodanie ustawienia po jednej stronie nie
// może po cichu ominąć drugiej.
//
// Zakresy są celowo TAKIE SAME jak `min`/`max` pól w panelu i jak clamp w
// `ProfileCard`: wartość spoza zakresu (stary dokument, ręczna edycja JSON)
// nie rozjeżdża układu, tylko wraca do granicy.
import type { ProfileCardStyle } from "@/components/ui/profile-card";

/** Klucze treści czytane przez kartę. Kolejność = kolejność pól w panelu. */
export const PROFILE_CARD_STYLE_KEYS = [
  "imageSize",
  "overlap",
  "cardMaxWidth",
  "shadow",
  "socialStyle",
  "socialSize",
  "mobileAlign",
  "animate",
] as const;

const SHADOWS = new Set(["none", "sm", "md", "lg", "xl"]);

/** Puste pole liczbowe = „użyj domyślnej", nie zero. */
function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Czyta wszystkie klucze BEZWARUNKOWO - również wtedy, gdy wartość jest pusta.
 * To celowe: bramka wierności ustawień liczy odczyty przez Proxy, więc odczyt
 * skrócony (`??`) na pierwszym niepustym polu ukryłby resztę ustawień jako
 * „martwe" i bramka kazałaby je usunąć z panelu.
 */
export function readProfileCardStyle(c: Record<string, unknown>): ProfileCardStyle {
  const imageSize = num(c.imageSize);
  const overlap = num(c.overlap);
  const cardMaxWidth = num(c.cardMaxWidth);
  const shadow = typeof c.shadow === "string" ? c.shadow : "";
  const socialStyle = c.socialStyle === "outline" ? "outline" : "solid";
  const socialSize = num(c.socialSize);
  const mobileAlign = c.mobileAlign === "left" ? "left" : "center";
  const animate = c.animate !== false;

  return {
    imageSize,
    overlap,
    maxWidth: cardMaxWidth,
    shadow: SHADOWS.has(shadow) ? (shadow as ProfileCardStyle["shadow"]) : undefined,
    socialStyle,
    socialSize,
    align: mobileAlign,
    animate,
  };
}
