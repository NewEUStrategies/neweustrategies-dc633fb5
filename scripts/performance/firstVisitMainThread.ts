export interface FirstVisitLongTask {
  start: number;
  duration: number;
}

declare global {
  interface Window {
    __firstVisitMainThread: {
      read: () => { longTasks: FirstVisitLongTask[]; fontsLoadingDoneMs: number[] };
    };
  }
}

// Self-contained: Playwright serializes this function into the document before
// navigation. A late LCP candidate whose resource arrived early is explained by
// the main thread, not the network: the image load notification, an SVG parse
// and the font swap all wait for the running task. Long tasks (>= 50 ms) show
// those windows; `loadingdone` marks when the document's font set finished a
// loading cycle, i.e. the earliest moment the swapped text could be laid out.
export function installFirstVisitMainThreadObserver() {
  const longTasks: FirstVisitLongTask[] = [];
  const fontsLoadingDoneMs: number[] = [];
  const record = (entries: PerformanceEntryList) => {
    for (const entry of entries)
      longTasks.push({ start: entry.startTime, duration: entry.duration });
  };
  const observer = new PerformanceObserver((list) => record(list.getEntries()));
  observer.observe({ type: "longtask", buffered: true });
  document.fonts.addEventListener("loadingdone", () => {
    fontsLoadingDoneMs.push(performance.now());
  });
  window.__firstVisitMainThread = {
    read: () => {
      // Observer delivery is asynchronous: include tasks that ended before this
      // read but whose callback has not run yet.
      record(observer.takeRecords());
      return { longTasks: [...longTasks], fontsLoadingDoneMs: [...fontsLoadingDoneMs] };
    },
  };
}
