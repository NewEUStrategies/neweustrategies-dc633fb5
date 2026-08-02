// Single source of truth for inline-editable font-size targets ("edit targets").
//
// Form widgets stamp `data-edit-target="<key>"` on their text elements
// (JoinUsForm / ContactFormView / CustomFieldsRenderer). Two editing surfaces
// consume that attribute and MUST stay in sync:
//   - the floating InlineSizeToolbar on the builder canvas,
//   - the "Rozmiary elementów formularza (px)" steppers in WidgetProperties.
// Keeping labels / ranges / per-widget field lists here prevents the two
// surfaces from drifting apart (e.g. join-us uses `buttonSize` while
// contact-form uses `buttonFontSize`).

export interface EditTargetMeta {
  label: string;
  min: number;
  max: number;
  /** Fallback when the element cannot be measured (SSR, detached node). */
  fallbackPx: number;
}

export const EDIT_TARGET_META: Record<string, EditTargetMeta> = {
  titleSize: { label: "Tytuł", min: 10, max: 96, fallbackPx: 24 },
  descriptionSize: { label: "Opis", min: 8, max: 48, fallbackPx: 14 },
  perkSize: { label: "Bulletpointy", min: 8, max: 32, fallbackPx: 14 },
  labelSize: { label: "Etykiety pól", min: 8, max: 24, fallbackPx: 12 },
  placeholderSize: { label: "Pola / placeholder", min: 8, max: 24, fallbackPx: 14 },
  buttonSize: { label: "Przycisk", min: 8, max: 28, fallbackPx: 14 },
  buttonFontSize: { label: "Przycisk", min: 8, max: 28, fallbackPx: 14 },
  consentSize: { label: "Zgody / stopka", min: 8, max: 20, fallbackPx: 11 },
  // Ikony (✓ przy korzyściach, ikona przycisku, chevron listy). Puste = ikona
  // skaluje się razem z tekstem, przy którym stoi.
  iconSize: { label: "Ikony", min: 8, max: 64, fallbackPx: 16 },
};

/** Panel field lists per widget type (order = display order). */
export const FORM_SIZE_FIELDS: Record<string, Array<{ key: string }>> = {
  "join-us": [
    { key: "titleSize" },
    { key: "descriptionSize" },
    { key: "perkSize" },
    { key: "labelSize" },
    { key: "placeholderSize" },
    { key: "buttonSize" },
    { key: "consentSize" },
    { key: "iconSize" },
  ],
  "contact-form": [
    { key: "titleSize" },
    { key: "descriptionSize" },
    { key: "labelSize" },
    { key: "placeholderSize" },
    { key: "buttonFontSize" },
    { key: "consentSize" },
  ],
};

/** CustomEvent name: canvas toolbar asks the panel to reveal + flash a field. */
export const FOCUS_SIZE_FIELD_EVENT = "cms:focus-size-field";

export const isEditTargetKey = (key: string | null | undefined): key is string =>
  !!key && Object.prototype.hasOwnProperty.call(EDIT_TARGET_META, key);

export function clampEditTarget(key: string, value: number): number {
  const meta = EDIT_TARGET_META[key];
  if (!meta) return Math.round(value);
  return Math.max(meta.min, Math.min(meta.max, Math.round(value)));
}

export function escapeAttrSelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

/** The rendered canvas element for a widget's edit target (first match).
 *  May be an `<svg>` (icon targets), hence the SVGElement in the union. */
export function findEditTargetElement(
  widgetId: string,
  key: string,
): HTMLElement | SVGElement | null {
  if (typeof document === "undefined") return null;
  const widget = document.querySelector<HTMLElement>(
    `[data-visual-canvas] [data-widget-id="${escapeAttrSelector(widgetId)}"]`,
  );
  return (
    widget?.querySelector<HTMLElement | SVGElement>(
      `[data-edit-target="${escapeAttrSelector(key)}"]`,
    ) ?? null
  );
}

/**
 * Effective (computed) size of an edit target in px. Works whether or not the
 * widget has an explicit override — this is what makes the current size
 * VISIBLE to the user even when the field is set to "auto".
 *
 * Icon targets are `<svg>` nodes: their `font-size` says nothing about how big
 * the icon looks, so we measure the rendered box instead (the toolbar and the
 * panel stepper both edit a width/height in px for them).
 */
export function measureEditTargetPx(widgetId: string, key: string): number | null {
  const el = findEditTargetElement(widgetId, key);
  if (!el || typeof window === "undefined") return null;
  if (el instanceof SVGElement || el.tagName.toLowerCase() === "svg") {
    const box = el.getBoundingClientRect();
    const side = Math.max(box.width, box.height);
    return side > 0 ? Math.round(side) : null;
  }
  const px = parseFloat(window.getComputedStyle(el).fontSize);
  return Number.isFinite(px) ? Math.round(px) : null;
}
