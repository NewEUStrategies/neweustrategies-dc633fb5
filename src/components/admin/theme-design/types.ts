// Shared prop contracts for the Theme Design atomic-design tree.
//
// Keeping these here (instead of inlined in every organism) means the editor
// sections all speak the exact same, fully-typed language - no `any`, no
// structural drift between the page and the sections it composes.
import type { ThemeDesign } from "@/lib/theme/themeDesign";

/** Light / dark slot that the color controls currently write to. */
export type PreviewMode = "light" | "dark";

/**
 * Patches a whole (non-color) section of the draft, e.g.
 * `set("blockHeading", { fontSize: "20px" })`.
 */
export type ThemeDesignSetter = <K extends keyof ThemeDesign>(
  key: K,
  patch: Partial<ThemeDesign[K]>,
) => void;

/**
 * Writes a single color-typed field to the light slot or the dark override,
 * depending on the active preview mode. `null` / "" clears the value so the
 * inherited global token wins.
 */
export type ThemeColorSetter = (section: string, field: string, value: string | null) => void;

/**
 * The uniform contract every editor "section" organism consumes. All sections
 * that touch the ThemeDesign draft (all but Carousel + Overlay, which own their
 * own draft slices) receive exactly this.
 */
export interface SectionEditorProps {
  draft: ThemeDesign;
  set: ThemeDesignSetter;
  setColor: ThemeColorSetter;
  previewMode: PreviewMode;
}
