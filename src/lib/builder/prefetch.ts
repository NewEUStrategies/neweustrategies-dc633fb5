import type { QueryClient } from "@tanstack/react-query";
import type { BuilderDocument, SectionChild, WidgetContent, WidgetNode } from "@/lib/builder/types";
import type { Lang } from "@/lib/builder/postListQuery";
import { postListQueryOptions } from "@/lib/builder/postListQuery";
import { postRefQueryOptions } from "@/lib/builder/contentRefs";
import { sliderFallbackImagesQueryOptions } from "@/lib/builder/sliderVariants";

function isWidget(node: SectionChild | WidgetNode): node is WidgetNode {
  return node.kind === "widget";
}

function collectWidgetsFromChild(child: SectionChild, out: WidgetNode[]) {
  if (child.kind === "column") {
    child.children.forEach((node) => out.push(node));
    return;
  }
  child.columns.forEach((column) => column.children.forEach((node) => out.push(node)));
}

export function collectBuilderWidgets(doc: BuilderDocument): WidgetNode[] {
  const widgets: WidgetNode[] = [];
  doc.sections.forEach((section) => section.children.forEach((child) => collectWidgetsFromChild(child, widgets)));
  return widgets.filter(isWidget);
}

function contentItems(c: WidgetContent): Record<string, unknown>[] {
  const raw = c.items;
  if (!Array.isArray(raw)) return [];
  const items: Record<string, unknown>[] = [];
  raw.forEach((item: unknown) => {
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      items.push(item as Record<string, unknown>);
    }
  });
  return items;
}

export async function prefetchBuilderDocumentQueries(
  queryClient: QueryClient,
  doc: BuilderDocument,
  lang: Lang,
): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  for (const widget of collectBuilderWidgets(doc)) {
    if (widget.type === "post-list" || widget.type === "carousel") {
      tasks.push(queryClient.prefetchQuery(postListQueryOptions(widget.content, lang)));
    }

    if (widget.type === "slider") {
      const items = contentItems(widget.content);
      const postIds = Array.from(
        new Set(items.map((item) => item.postId).filter((id): id is string => typeof id === "string" && id.length > 0)),
      );
      postIds.forEach((id) => tasks.push(queryClient.prefetchQuery(postRefQueryOptions(id, lang))));
      tasks.push(queryClient.prefetchQuery(sliderFallbackImagesQueryOptions(Math.max(3, items.length || 3))));
    }
  }

  await Promise.allSettled(tasks);
}
