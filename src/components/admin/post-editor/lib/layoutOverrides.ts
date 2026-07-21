// Pure layout-override helpers for the post editor. Extracted verbatim from the
// admin.posts.$slug orchestrator so the merge/collapse logic is unit-testable
// and shared 1:1 between the layout card and the blocks-canvas scaffold.
import {
  getLayoutSet,
  type LayoutOverrides,
  type LayoutPreset,
  type PostFormat,
} from "@/lib/postLayouts";
import type { PostForm } from "../types";

/** Read the post's layout overrides as a concrete object (never null). */
export function readLayoutOverrides(form: Pick<PostForm, "layout_overrides">): LayoutOverrides {
  return form.layout_overrides ?? {};
}

/**
 * Merge a patch into the current overrides and collapse an all-empty result
 * back to `null`, so the persisted column never accumulates noise. Returns the
 * value to store in `layout_overrides`.
 */
export function nextLayoutOverrides(
  current: LayoutOverrides,
  patch: Partial<LayoutOverrides>,
): LayoutOverrides | null {
  const next = { ...current, ...patch };
  const hasAny = Object.values(next).some((v) => v !== undefined && v !== null && v !== "");
  return hasAny ? next : null;
}

/**
 * The effective post format: a per-post override wins, otherwise the stored
 * format, otherwise "standard". Drives which preset set + scaffold apply.
 */
export function resolvePostFormat(
  ov: Pick<LayoutOverrides, "format">,
  form: Pick<PostForm, "post_format">,
): PostFormat {
  return ov.format ?? form.post_format ?? "standard";
}

/** Preset set for the effective format (named re-export for call-site clarity). */
export function layoutSetFor(format: PostFormat): LayoutPreset[] {
  return getLayoutSet(format);
}

/**
 * Build a single-field overrides patch in a type-safe way. The lone assertion
 * is localized here: a computed-key object literal widens to a string index
 * signature in TypeScript, which `Partial<LayoutOverrides>` does not accept -
 * yet both `key` and `value` are still fully checked against `LayoutOverrides`
 * at every call site (no `any` escapes this boundary).
 */
export function overridePatch<K extends keyof LayoutOverrides>(
  key: K,
  value: LayoutOverrides[K],
): Partial<LayoutOverrides> {
  return { [key]: value } as Partial<LayoutOverrides>;
}
