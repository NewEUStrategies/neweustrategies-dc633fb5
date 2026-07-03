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

export function RouterLinkStub({
  to,
  children,
  // Router-only props must not leak onto the DOM element.
  params: _params,
  search: _search,
  hash: _hash,
  replace: _replace,
  preload: _preload,
  activeProps: _activeProps,
  inactiveProps: _inactiveProps,
  ...rest
}: RouterLinkStubProps) {
  return (
    <a href={typeof to === "string" ? to : "#"} {...rest}>
      {children}
    </a>
  );
}
