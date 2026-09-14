import type { Plugin } from "vite";

const WIDGET_DIR = "/src/components/builder/organisms/widget-view/";
const TARGETS: Record<string, string[]> = {
  "account-link": [`${WIDGET_DIR}AccountMenuWidget.tsx`],
  "search-button": [`${WIDGET_DIR}SearchButtonWidget.tsx`],
  "post-list": [`${WIDGET_DIR}PostListView.tsx`, "/src/components/archive/ArchivePostList.tsx"],
  slider: [`${WIDGET_DIR}PostsSliderWidget.tsx`, "/src/lib/builder/sliderVariants.tsx"],
  "image-slider": ["/src/lib/builder/sliderVariants.tsx"],
  text: [`${WIDGET_DIR}RichHtmlView.tsx`],
  "rich-text": [`${WIDGET_DIR}RichTextView.tsx`, `${WIDGET_DIR}RichHtmlView.tsx`],
  "section-label": ["/src/lib/builder/sectionLabelVariants.tsx"],
};

/** Discover the exact assets of this deployment, including nested lazy renderers. */
export function widgetChunkPlugin(): Plugin {
  const discovered: Record<string, string[]> = {};
  return {
    name: "nes:widget-chunks",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith("/src/lib/seo/widgetPreloads.ts")) return null;
      if (!Object.keys(discovered).length) return null;
      const placeholder = /(WIDGET_CHUNK_URLS\s*:[^=]+?=\s*)\{\}/;
      if (!placeholder.test(code)) this.error("Missing WIDGET_CHUNK_URLS placeholder");
      return {
        code: code.replace(
          placeholder,
          (_, declaration) => declaration + JSON.stringify(discovered),
        ),
        map: null,
      };
    },
    generateBundle(options, bundle) {
      if (!/client|public/.test(options.dir ?? "")) return;
      for (const [type, suffixes] of Object.entries(TARGETS)) {
        const urls = new Set<string>();
        for (const suffix of suffixes) {
          for (const output of Object.values(bundle)) {
            if (output.type !== "chunk" || output.isEntry) continue;
            if (
              Object.keys(output.modules).some((id) => id.replaceAll("\\", "/").endsWith(suffix))
            ) {
              urls.add(`/${output.fileName}`);
            }
          }
        }
        discovered[type] = [...urls];
      }
    },
  };
}
