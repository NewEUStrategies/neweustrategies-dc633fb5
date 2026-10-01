export interface FirstVisitPendingWidget {
  widgetId: string | null;
  type: string;
  insertedAt: number;
  swappedAt: number | null;
}

declare global {
  interface Window {
    __firstVisitStreaming: {
      read: () => { pendingWidgets: FirstVisitPendingWidget[] };
    };
  }
}

const PENDING_WIDGET_ATTRIBUTE = "data-chrome-widget-pending";

// Self-contained: Playwright serializes this function into the document before
// navigation. Streaming SSR ships a code-split widget as a 40 px placeholder
// (DeferredWidgetView) and completes it later in the same document. The parser
// reaches that completion only after the rest of the shell, so a first-fold
// widget can be absent from the first paint. Record when each placeholder was
// parsed and when it was replaced; the comparison with fcpMs and the LCP
// candidates then shows whether the LCP element waited for the swap.
export function installFirstVisitStreamingObserver() {
  const boundaries = new Map<Element, FirstVisitPendingWidget>();
  const attribute = "data-chrome-widget-pending";
  const register = (placeholder: Element, now: number) => {
    if (boundaries.has(placeholder)) return;
    boundaries.set(placeholder, {
      widgetId: placeholder.closest("[data-widget-id]")?.getAttribute("data-widget-id") ?? null,
      type: placeholder.getAttribute(attribute) ?? "",
      insertedAt: now,
      swappedAt: null,
    });
  };
  new MutationObserver((records) => {
    const now = performance.now();
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.hasAttribute(attribute)) register(node, now);
        for (const nested of node.querySelectorAll(`[${attribute}]`)) register(nested, now);
      }
      for (const node of record.removedNodes) {
        const boundary = node instanceof Element ? boundaries.get(node) : undefined;
        if (boundary && boundary.swappedAt === null) boundary.swappedAt = now;
      }
    }
  }).observe(document, { childList: true, subtree: true });
  window.__firstVisitStreaming = {
    read: () => ({ pendingWidgets: [...boundaries.values()].map((boundary) => ({ ...boundary })) }),
  };
}

export { PENDING_WIDGET_ATTRIBUTE };
