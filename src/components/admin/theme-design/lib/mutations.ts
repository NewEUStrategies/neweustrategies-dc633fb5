// Pure, framework-free draft mutations for Theme Design.
//
// Extracted from the old inline `set` / `setColor` closures so the branching
// logic (light slot vs. dark override, clearing an override, pruning empty
// override maps) can be unit-tested in isolation and reused by the controller
// hook without duplicating it.
import type { ThemeDesign } from "@/lib/theme/themeDesign";
import type { PreviewMode } from "../types";

/** Immutably merges `patch` into one section of the draft. */
export function applySectionPatch<K extends keyof ThemeDesign>(
  draft: ThemeDesign,
  key: K,
  patch: Partial<ThemeDesign[K]>,
): ThemeDesign {
  return {
    ...draft,
    [key]: { ...(draft[key] as object), ...patch },
  } as ThemeDesign;
}

/**
 * Immutably writes a color-typed field.
 *
 * - `light` mode writes straight onto `draft[section][field]` (empty string
 *   means "inherit the global token").
 * - `dark` mode writes into `darkOverrides[section][field]`. Passing
 *   `null`/"" removes the override; when a section's override map becomes empty
 *   it is pruned so the serialized shape stays minimal.
 */
export function applyColor(
  draft: ThemeDesign,
  mode: PreviewMode,
  section: string,
  field: string,
  value: string | null,
): ThemeDesign {
  if (mode === "light") {
    const current = (draft as Record<string, unknown>)[section] as
      | Record<string, unknown>
      | undefined;
    return {
      ...draft,
      [section]: {
        ...(current ?? {}),
        [field]: value ?? "",
      },
    } as ThemeDesign;
  }

  const overrides: Record<string, Record<string, string>> = { ...(draft.darkOverrides ?? {}) };
  const sectionOverride: Record<string, string> = { ...(overrides[section] ?? {}) };

  if (value == null || value === "") {
    delete sectionOverride[field];
  } else {
    sectionOverride[field] = value;
  }

  if (Object.keys(sectionOverride).length === 0) {
    delete overrides[section];
  } else {
    overrides[section] = sectionOverride;
  }

  return { ...draft, darkOverrides: overrides };
}

/**
 * Computes the minimal patch of overlay-typography fields that actually
 * changed vs. the persisted server snapshot, so a save never clobbers columns
 * the user did not touch. Returns `null` when nothing changed.
 */
export function diffChangedFields<T extends object>(next: T, prev: T): Partial<T> | null {
  const patch: Partial<T> = {};
  let changed = false;
  for (const key of Object.keys(next) as Array<keyof T>) {
    if (next[key] !== prev[key]) {
      patch[key] = next[key];
      changed = true;
    }
  }
  return changed ? patch : null;
}
