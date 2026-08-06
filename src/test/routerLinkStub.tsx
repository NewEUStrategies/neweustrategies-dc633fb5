// Plain-anchor stand-in for TanStack Router's <Link> in component tests.
//
// <Link> reads router context and throws without a <RouterProvider>; unit
// tests of presentational components don't need routing, so suites mock it:
//   vi.mock("@tanstack/react-router", async (importOriginal) => ({
//     ...(await importOriginal<typeof import("@tanstack/react-router")>()),
//     Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
//   }));
// Shared here so every suite renders the same, accessible <a> markup
// (axe-clean: real href, children preserved, rest props forwarded).
import type { AnchorHTMLAttributes, ReactNode } from "react";

export interface RouterLinkStubProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: unknown;
  params?: unknown;
  search?: unknown;
  hash?: unknown;
  replace?: unknown;
  preload?: unknown;
  activeProps?: unknown;
  inactiveProps?: unknown;
  children?: ReactNode;
}

/**
 * Fills `$param` placeholders in a route template from `params`, so assertions
 * can read the REAL destination (`/author/anna-nowak`) instead of the template
 * (`/author/$slug`). Suites used to re-implement this locally.
 */
function resolveHref(to: unknown, params: unknown): string {
  if (typeof to !== "string") return "#";
  if (params === null || typeof params !== "object") return to;
  let href = to;
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" || typeof value === "number") {
      href = href.replace(`$${key}`, String(value));
    }
  }
  return href;
}

export function RouterLinkStub({
  to,
  children,
  params,
  // Router-only props must not leak onto the DOM element.
  search: _search,
  hash: _hash,
  replace: _replace,
  preload: _preload,
  activeProps: _activeProps,
  inactiveProps: _inactiveProps,
  ...rest
}: RouterLinkStubProps) {
  return (
    <a href={resolveHref(to, params)} {...rest}>
      {children}
    </a>
  );
}
