// Zakładki strony "Pixels" (/admin/settings/marketing?tab=...). Wspólne dla
// trasy (walidacja adresu) i paska bocznego (skróty do zakładek).
export const PIXELS_TABS = ["google", "meta", "linkedin", "other"] as const;
export type PixelsTab = (typeof PIXELS_TABS)[number];
export const DEFAULT_PIXELS_TAB: PixelsTab = "google";

export function parsePixelsTab(value: unknown): PixelsTab | undefined {
  return PIXELS_TABS.find((tab) => tab === value);
}
