export interface FirstVisitLcpCandidate {
  startTime: number;
  renderTime: number;
  loadTime: number;
  observedAt: number;
  size: number;
  url: string;
  element: {
    tagName: string;
    id: string;
    className: string;
    widgetId: string | null;
  } | null;
}

type LcpEntry = PerformanceEntry & {
  renderTime: number;
  loadTime: number;
  size: number;
  url: string;
  element: Element | null;
};

declare global {
  interface Window {
    __firstVisitLcp: {
      read: () => { lcpMs: number; lcpEntries: FirstVisitLcpCandidate[] };
    };
  }
}

// Self-contained: Playwright serializes this function into the document before
// navigation. Snapshot element attribution while it is available; a later DOM
// removal can make LargestContentfulPaint.element return null.
export function installFirstVisitLcpObserver() {
  const candidates: FirstVisitLcpCandidate[] = [];
  const record = (entries: PerformanceEntryList) => {
    for (const entry of entries as LcpEntry[]) {
      const element = entry.element;
      candidates.push({
        startTime: entry.startTime,
        renderTime: entry.renderTime,
        loadTime: entry.loadTime,
        observedAt: performance.now(),
        size: entry.size,
        url: entry.url,
        element: element
          ? {
              tagName: element.tagName,
              id: element.id,
              className: element.getAttribute("class") ?? "",
              widgetId: element.closest("[data-widget-id]")?.getAttribute("data-widget-id") ?? null,
            }
          : null,
      });
    }
  };
  const observer = new PerformanceObserver((list) => record(list.getEntries()));
  observer.observe({ type: "largest-contentful-paint", buffered: true });
  window.__firstVisitLcp = {
    read: () => {
      // Observer delivery is asynchronous. Include queued candidates even when
      // Playwright reads the metric before the observer callback is scheduled.
      record(observer.takeRecords());
      return { lcpMs: candidates.at(-1)?.startTime ?? 0, lcpEntries: [...candidates] };
    },
  };
}
