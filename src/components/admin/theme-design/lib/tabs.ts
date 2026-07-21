// Single source of truth for the Theme Design preview sections (tabs).
// Both the editor tab-nav and the live preview stage derive their behaviour
// from this list, so adding a section is a one-line change here.

/** Every editable / previewable aspect of the global "Theme Design". */
export const PREVIEW_SECTIONS = [
  "block-heading",
  "thumbnail",
  "read-more",
  "meta",
  "toolbar",
  "mode-switch",
  "social",
  "post-title",
  "post-excerpt",
  "list-index",
  "carousel",
  "overlay",
] as const;

export type PreviewSection = (typeof PREVIEW_SECTIONS)[number];

/** i18n key (under `adminThemeDesign.tabs`) for each section's tab label. */
export const TAB_ITEMS: ReadonlyArray<{ value: PreviewSection; labelKey: string }> = [
  { value: "block-heading", labelKey: "adminThemeDesign.tabs.blockHeading" },
  { value: "thumbnail", labelKey: "adminThemeDesign.tabs.thumbnail" },
  { value: "read-more", labelKey: "adminThemeDesign.tabs.readMore" },
  { value: "meta", labelKey: "adminThemeDesign.tabs.meta" },
  { value: "toolbar", labelKey: "adminThemeDesign.tabs.toolbar" },
  { value: "mode-switch", labelKey: "adminThemeDesign.tabs.modeSwitch" },
  { value: "social", labelKey: "adminThemeDesign.tabs.social" },
  { value: "post-title", labelKey: "adminThemeDesign.tabs.postTitle" },
  { value: "post-excerpt", labelKey: "adminThemeDesign.tabs.postExcerpt" },
  { value: "list-index", labelKey: "adminThemeDesign.tabs.listIndex" },
  { value: "carousel", labelKey: "adminThemeDesign.tabs.carousel" },
  { value: "overlay", labelKey: "adminThemeDesign.tabs.overlay" },
];

/** Type guard used when reading the tab value back from the DOM/Radix. */
export function isPreviewSection(value: string): value is PreviewSection {
  return (PREVIEW_SECTIONS as readonly string[]).includes(value);
}
