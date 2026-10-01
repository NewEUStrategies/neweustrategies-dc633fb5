import { lazy } from "react";
import { isServer } from "@tanstack/router-core/isServer";
import { RichHtmlContent, type RichHtmlProps } from "./RichHtmlContent";
import { RichHtmlListView as ServerRichHtmlListView } from "./RichHtmlListView";

// List normalization needs a universal HTML parser. Plain text widgets never
// use it, so keep it outside their browser dependency graph. SSR stays eager;
// the existing widget Suspense boundary preserves server content while a list
// hydrates. Both paths still sanitize HTML and render footnotes identically.
const ListView = isServer
  ? ServerRichHtmlListView
  : lazy(() => import("./RichHtmlListView").then((m) => ({ default: m.RichHtmlListView })));

export function RichHtmlView(props: RichHtmlProps) {
  return /<(?:ul|ol)\b/i.test(props.html) ? (
    <ListView {...props} />
  ) : (
    <RichHtmlContent {...props} />
  );
}
