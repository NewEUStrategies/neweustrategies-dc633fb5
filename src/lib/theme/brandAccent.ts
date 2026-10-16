/** Display compatibility for saved brand accents; unrelated colors stay intact. */
export const BRAND_ACCENT = "#FA9346";
const LEGACY = new Set([
  "#fa9346",
  "#a94e0b",
  "#c5652d",
  "#c2410c",
  "#b45309",
  "#d97706",
  "#f59e0b",
  "#fbbf24",
  "#ed6d1f",
  "#d95a12",
  "#f8934a",
  "#d9b26a",
  "#e3c992",
]);
export function resolveBrandAccent(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  return LEGACY.has(normalized) || /^rgb\(\s*197\s*,\s*101\s*,\s*45\s*\)$/.test(normalized)
    ? BRAND_ACCENT
    : value;
}
