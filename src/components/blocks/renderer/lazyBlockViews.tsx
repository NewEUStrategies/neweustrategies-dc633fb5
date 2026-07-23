// Code-split registry for heavy / rare dynamic block views.
//
// The blocks renderer (BlocksRenderer -> BlockView -> registry) resolves EVERY
// block type through one totalna mapa. Statically importing every view means a
// reader of a plain text+image article still downloads the code for the rare
// interactive blocks - the realtime live blog, the poll (pulls PollCard +
// community queries + auth), the calendar grid, and the data-viz engine (custom
// SVG charts + choropleth map + geo assets). None of these appear on a typical
// article, yet they rode along in the reader bundle.
//
// Each view below is wrapped in React.lazy + Suspense so its code lives in a
// separate chunk loaded on demand. Under TanStack Start's streaming SSR the
// dynamic import resolves on the SERVER, so the rendered HTML is identical
// (crawlers and first paint see the real content, prefetched into react-query
// via blockQueryOptionsList) - only the *client* download is deferred. The same
// pattern already backs the builder widgets in lazyWidgets.tsx.
//
// Fallback contract: `null`. On the public reader the SSR stream fills the
// boundary, so it is ~never shown and layout stays stable; on a client-side SPA
// navigation to an article that does use one of these blocks, the chunk streams
// in and the brief gap is the same trade-off lazyWidgets makes on public pages.
//
// What stays EAGER (deliberately): the lightweight, frequently-present views -
// post title/date/author/excerpt/terms, breadcrumbs, reading time, share
// buttons, navigation and query-loop (its deps - AppLink, OptimizedImage,
// formatDate - are already in the shared graph, so splitting it would fragment
// NavLoopViews for no real byte win). Splitting those would add Suspense
// boundaries with no payoff.
//
// Runtime uses `React.lazy(() => import(...))`; the prop types come from
// `import type` so the compiler still sees each view's props without dragging
// the implementation into this file's static graph (that would collapse the
// split boundary).
import { lazy, Suspense, type ComponentProps, type ComponentType, type ReactElement } from "react";

import type { LiveBlogBlock as LiveBlogBlockImpl } from "../LiveBlogBlock";
import type { PollBlockView as PollBlockViewImpl } from "../PollBlockView";
import type { CalendarView as CalendarViewImpl } from "../CalendarView";
import type {
  ChartBlockView as ChartBlockViewImpl,
  DataMapBlockView as DataMapBlockViewImpl,
} from "../DataVizViews";

/** Wrap a `React.lazy` chunk in Suspense + typed prop forwarding. */
function withSuspense<P>(Lazy: ComponentType<P>): (props: P) => ReactElement {
  return function Suspended(props: P) {
    return (
      <Suspense fallback={null}>
        {/* @ts-expect-error - React.lazy component signature is compatible at runtime. */}
        <Lazy {...props} />
      </Suspense>
    );
  };
}

// --- realtime / interactive -----------------------------------------------
const LiveBlogBlockLazy = lazy(() =>
  import("../LiveBlogBlock").then((m) => ({ default: m.LiveBlogBlock })),
) as ComponentType<ComponentProps<typeof LiveBlogBlockImpl>>;
export const LiveBlogBlock = withSuspense(LiveBlogBlockLazy);

const PollBlockViewLazy = lazy(() =>
  import("../PollBlockView").then((m) => ({ default: m.PollBlockView })),
) as ComponentType<ComponentProps<typeof PollBlockViewImpl>>;
export const PollBlockView = withSuspense(PollBlockViewLazy);

const CalendarViewLazy = lazy(() =>
  import("../CalendarView").then((m) => ({ default: m.CalendarView })),
) as ComponentType<ComponentProps<typeof CalendarViewImpl>>;
export const CalendarView = withSuspense(CalendarViewLazy);

// --- data-viz (custom SVG chart engine + choropleth + geo assets) ----------
const ChartBlockViewLazy = lazy(() =>
  import("../DataVizViews").then((m) => ({ default: m.ChartBlockView })),
) as ComponentType<ComponentProps<typeof ChartBlockViewImpl>>;
export const ChartBlockView = withSuspense(ChartBlockViewLazy);

const DataMapBlockViewLazy = lazy(() =>
  import("../DataVizViews").then((m) => ({ default: m.DataMapBlockView })),
) as ComponentType<ComponentProps<typeof DataMapBlockViewImpl>>;
export const DataMapBlockView = withSuspense(DataMapBlockViewLazy);
