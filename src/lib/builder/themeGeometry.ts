const SHARED_KEYS = new Set([
  "typography",
  "padding",
  "margin",
  "borderRadius",
  "borderStyle",
  "borderWidth",
  "boxShadow",
  "shadow",
  "scale",
  "translateY",
  "transitionMs",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sharedValue(value: unknown): unknown {
  if (!isRecord(value) || (!("light" in value) && !("dark" in value))) return value;
  return value.light ?? value.dark;
}

/**
 * Removes legacy per-theme geometry from Builder JSON. Theme-specific colors
 * and media remain untouched; responsive desktop/tablet/mobile values remain.
 */
export function normalizeThemeGeometry<T>(value: T): T {
  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(visit);
    if (!isRecord(current)) return current;
    return Object.fromEntries(
      Object.entries(current).map(([key, child]) => {
        const normalized = SHARED_KEYS.has(key) ? sharedValue(child) : child;
        return [key, visit(normalized)];
      }),
    );
  };

  return visit(value) as T;
}