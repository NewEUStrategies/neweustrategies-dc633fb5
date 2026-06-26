import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type {
  BuilderDocument,
  SectionChild,
  SectionNode,
  WidgetContent,
  WidgetNode,
} from "@/lib/builder/types";
import type { Lang } from "@/lib/builder/postListQuery";
import { postListQueryOptions } from "@/lib/builder/postListQuery";
import { postRefQueryOptions } from "@/lib/builder/contentRefs";
import { sliderFallbackImagesQueryOptions } from "@/lib/builder/sliderVariants";

/** A single cache target for a widget: its query key + matching stale-time. */
export interface WidgetCacheTarget {
  key: QueryKey;
  staleTime: number;
}

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

export function collectSectionWidgets(section: SectionNode): WidgetNode[] {
  const widgets: WidgetNode[] = [];
  section.children.forEach((child) => collectWidgetsFromChild(child, widgets));
  return widgets.filter(isWidget);
}

export function collectBuilderWidgets(doc: BuilderDocument): WidgetNode[] {
  const widgets: WidgetNode[] = [];
  doc.sections.forEach((section) => collectSectionWidgets(section).forEach((w) => widgets.push(w)));
  return widgets;
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

/**
 * Prefetch all data-bound queries for a set of widgets.
 * Reused by both whole-document prefetch (SSR/loader) and per-section
 * lazy prefetch driven by IntersectionObserver.
 */
export async function prefetchWidgets(
  queryClient: QueryClient,
  widgets: WidgetNode[],
  lang: Lang,
): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  for (const widget of widgets) {
    if (widget.type === "post-list" || widget.type === "carousel") {
      tasks.push(queryClient.prefetchQuery(postListQueryOptions(widget.content, lang)));
    }

    if (widget.type === "slider") {
      const items = contentItems(widget.content);
      const postIds = Array.from(
        new Set(
          items
            .map((item) => item.postId)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      );
      postIds.forEach((id) => tasks.push(queryClient.prefetchQuery(postRefQueryOptions(id, lang))));
      tasks.push(
        queryClient.prefetchQuery(sliderFallbackImagesQueryOptions(Math.max(3, items.length || 3))),
      );
    }
  }

  await Promise.allSettled(tasks);
}

export async function prefetchSectionQueries(
  queryClient: QueryClient,
  section: SectionNode,
  lang: Lang,
): Promise<void> {
  await prefetchWidgets(queryClient, collectSectionWidgets(section), lang);
}

/**
 * Enumerate the cache targets (query key + stale-time) covered by a widget.
 * Used by the SWR gate in useSectionPreload to decide whether a prefetch is
 * even necessary.
 */
function coerceStaleTime(st: unknown): number {
  return typeof st === "number" ? st : 0;
}

export function widgetCacheTargets(widget: WidgetNode, lang: Lang): WidgetCacheTarget[] {
  const out: WidgetCacheTarget[] = [];
  if (widget.type === "post-list" || widget.type === "carousel") {
    const opts = postListQueryOptions(widget.content, lang);
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  if (widget.type === "slider") {
    const items = contentItems(widget.content);
    const postIds = Array.from(
      new Set(
        items
          .map((item) => item.postId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );
    postIds.forEach((id) => {
      const opts = postRefQueryOptions(id, lang);
      out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
    });
    const opts = sliderFallbackImagesQueryOptions(Math.max(3, items.length || 3));
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  return out;
}

/** Aggregate cache targets across all widgets in a list (e.g. one section). */
export function sectionCacheTargets(widgets: WidgetNode[], lang: Lang): WidgetCacheTarget[] {
  return widgets.flatMap((w) => widgetCacheTargets(w, lang));
}

export async function prefetchBuilderDocumentQueries(
  queryClient: QueryClient,
  doc: BuilderDocument,
  lang: Lang,
): Promise<void> {
  await prefetchWidgets(queryClient, collectBuilderWidgets(doc), lang);
}
