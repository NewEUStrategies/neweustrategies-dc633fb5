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
import { safeParseBuilderDoc } from "@/lib/builder/schema";

/** A single cache target for a widget: its query key + matching stale-time. */
export interface WidgetCacheTarget {
  key: QueryKey;
  staleTime: number;
}

function isWidget(node: SectionChild | WidgetNode): node is WidgetNode {
  return !!node && node.kind === "widget";
}

function collectWidgetsFromChild(child: SectionChild | null | undefined, out: WidgetNode[]) {
  if (!child) return;
  if (child.kind === "column") {
    (child.children ?? []).forEach((node) => { if (node) out.push(node); });
    return;
  }
  (child.columns ?? []).forEach((column) =>
    (column?.children ?? []).forEach((node) => { if (node) out.push(node); }),
  );
}

export function collectSectionWidgets(section: SectionNode): WidgetNode[] {
  const widgets: WidgetNode[] = [];
  (section.children ?? []).forEach((child) => collectWidgetsFromChild(child, widgets));
  return widgets.filter(isWidget);
}


export function collectBuilderWidgets(doc: BuilderDocument): WidgetNode[] {
  const safeDoc = safeParseBuilderDoc(doc);
  const widgets: WidgetNode[] = [];
  safeDoc.sections.forEach((section) => collectSectionWidgets(section).forEach((w) => widgets.push(w)));
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

/**
 * How many leading sections a route loader prefetches on the server. The rest
 * stream in lazily on the client via `useSectionPreload` (IntersectionObserver
 * with a 1200px lookahead), so they are usually warm before the reader scrolls
 * to them. Three covers a hero plus the first content rows on every breakpoint;
 * bump it if a layout puts more data-bound widgets above the fold.
 *
 * Note: edge-cached content routes use {@link prefetchCachedRouteQueries}
 * instead, which warms the whole document - this cap applies to any uncached /
 * per-request loader that opts into above-the-fold-only prefetching.
 */
export const ABOVE_FOLD_SECTION_COUNT = 3;

/**
 * Upper bound (ms) on how long a loader will block waiting for above-the-fold
 * widget data before it hands control back and lets the cached/skeleton state
 * render. A generous safety net: real queries resolve well under it, but a
 * single pathologically slow query (or a cold upstream) can never hang the
 * whole server response. The widget then resolves client-side on hydration.
 */
export const ABOVE_FOLD_PREFETCH_BUDGET_MS = 2500;

export interface AboveFoldPrefetchOptions {
  /** Leading sections to prefetch. Defaults to {@link ABOVE_FOLD_SECTION_COUNT}. */
  sections?: number;
  /**
   * Latency budget in ms. `0` / non-finite awaits the full prefetch with no
   * cap. Defaults to {@link ABOVE_FOLD_PREFETCH_BUDGET_MS}.
   */
  budgetMs?: number;
}

/** Collect data-bound widgets from the first `sectionCount` sections only. */
export function collectAboveFoldWidgets(
  doc: BuilderDocument,
  sectionCount: number,
): WidgetNode[] {
  const widgets: WidgetNode[] = [];
  doc.sections
    .slice(0, Math.max(0, sectionCount))
    .forEach((section) => collectSectionWidgets(section).forEach((w) => widgets.push(w)));
  return widgets;
}

/**
 * Resolve when `work` settles or `ms` elapses, whichever is first - without
 * leaving a dangling timer on the (server) event loop. `work` is expected to
 * never reject (callers pass an already-`allSettled` prefetch), but rejections
 * are swallowed so a budget race can never surface an unhandled error.
 */
function raceBudget(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    // Node keeps the process alive for pending timers; edge runtimes lack unref.
    const maybeUnref = timer as unknown as { unref?: () => void };
    if (typeof maybeUnref.unref === "function") maybeUnref.unref();
    work.then(finish, finish);
  });
}

/**
 * Prefetch only the above-the-fold sections of a builder document, bounded by a
 * latency budget. This is the loader-friendly counterpart to
 * {@link prefetchBuilderDocumentQueries}: the server renders the critical, first
 * sections with live data while below-the-fold sections hydrate progressively
 * on the client. Net effect - a far lower TTFB on content-heavy pages with no
 * change to the rendered layout.
 */
export async function prefetchAboveFoldQueries(
  queryClient: QueryClient,
  doc: BuilderDocument,
  lang: Lang,
  options: AboveFoldPrefetchOptions = {},
): Promise<void> {
  const sectionCount = options.sections ?? ABOVE_FOLD_SECTION_COUNT;
  const widgets = collectAboveFoldWidgets(doc, sectionCount);
  if (widgets.length === 0) return;

  const work = prefetchWidgets(queryClient, widgets, lang);
  const budgetMs = options.budgetMs ?? ABOVE_FOLD_PREFETCH_BUDGET_MS;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    await work;
    return;
  }
  await raceBudget(work, budgetMs);
}

/**
 * Upper bound (ms) on a full-document server prefetch for an edge-cached route.
 * More generous than {@link ABOVE_FOLD_PREFETCH_BUDGET_MS} because the cost is
 * amortized: these routes are CDN-cached with a long stale-while-revalidate
 * window (see lib/http/cachePolicy), so a visitor is served instantly from the
 * shared cache while the full render happens at most once per revalidation. The
 * budget is only a hang-guard - any query that overruns it falls back to the
 * client-side `useSectionPreload` path.
 */
export const CACHED_ROUTE_PREFETCH_BUDGET_MS = 6000;

/**
 * Prefetch EVERY section's data for an edge-cached content route (home, public
 * page/post). Where {@link prefetchAboveFoldQueries} deliberately caps at the
 * first {@link ABOVE_FOLD_SECTION_COUNT} sections to keep TTFB low on
 * per-request renders, this warms the whole document so the entire page ships
 * as server-rendered HTML and below-the-fold content never pops in on the
 * client after a refresh. Safe precisely because the route is share-cached: the
 * work is paid once per revalidation, not per visitor. All section queries run
 * in parallel and the whole batch is bounded by `budgetMs`, so a single slow
 * upstream can never hang the SSR response.
 */
export async function prefetchCachedRouteQueries(
  queryClient: QueryClient,
  doc: BuilderDocument,
  lang: Lang,
  budgetMs: number = CACHED_ROUTE_PREFETCH_BUDGET_MS,
): Promise<void> {
  await prefetchAboveFoldQueries(queryClient, doc, lang, {
    sections: doc.sections.length,
    budgetMs,
  });
}
