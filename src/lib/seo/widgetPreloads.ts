import { sliderUsesPostsSource } from "@/lib/builder/sliderPostsQuery";
import type { BuilderDocument, SectionNode, WidgetNode } from "@/lib/builder/types";

// Replaced only in the server build, after browser chunk names are known.
// HTTP Link hints avoid introducing server-only nodes into the hydrated head.
export const WIDGET_CHUNK_URLS: Readonly<Record<string, readonly string[]>> = {};

export function widgetPreloadHeaders(
  doc: BuilderDocument,
  sectionCount: number,
  chunks = WIDGET_CHUNK_URLS,
): string[] {
  const urls = new Set<string>();
  const visit = (node: SectionNode | SectionNode["children"][number] | WidgetNode) => {
    if (!node) return;
    if (node.kind === "widget") {
      // Image-only sliders do not need the posts query module.
      const type =
        node.type === "slider" && !sliderUsesPostsSource(node.content ?? {})
          ? "image-slider"
          : node.type;
      for (const url of chunks[type] ?? []) urls.add(url);
    } else if (node.kind === "inner-section") {
      for (const column of node.columns ?? []) visit(column);
    } else if ("children" in node) {
      for (const child of node.children ?? []) visit(child);
    }
  };
  for (const section of doc.sections.slice(0, sectionCount)) visit(section);
  return [...urls].map((url) => `<${url}>; rel="modulepreload"; crossorigin`);
}
