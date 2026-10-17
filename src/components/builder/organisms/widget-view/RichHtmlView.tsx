import { lazy } from "react";
import { createIsomorphicFn } from "@tanstack/react-start";
import { RichHtmlContent, type RichHtmlProps } from "./RichHtmlContent";
import { RichHtmlListView as ServerRichHtmlListView } from "./RichHtmlListView";

// List normalization runs on node-html-parser on the server and on the
// browser's own parser on the client (`RichHtmlListView`). Plain text widgets
// never use it, so keep it outside their browser dependency graph. SSR stays
// eager; the existing widget Suspense boundary preserves server content while a
// list hydrates. Both paths still sanitize HTML and render footnotes identically.
//
// The Start compiler erases the server branch from the client build, so the
// static import above does not exist there. A plain `isServer` ternary kept it:
// Rolldown assigns chunks before tree-shaking, so the RichHtmlView chunk
// imported the list chunk and (back then) `node-html-parser` (~47 KB gzip)
// loaded on every page right after hydration, list or not.
const getServerListView = createIsomorphicFn()
  .server(() => ServerRichHtmlListView)
  .client(() => null);

const ListView =
  getServerListView() ??
  lazy(() => import("./RichHtmlListView").then((m) => ({ default: m.RichHtmlListView })));

export function RichHtmlView(props: RichHtmlProps) {
  return /<(?:ul|ol)\b/i.test(props.html) ? (
    <ListView {...props} />
  ) : (
    <RichHtmlContent {...props} />
  );
}
