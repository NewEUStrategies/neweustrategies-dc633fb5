// Isomorphic, server-only response-header effects. createIsomorphicFn keeps the
// server-only `@tanstack/react-start/server` import out of the client bundle and
// makes these no-ops during client-side navigation (where there is no HTTP
// response to mutate).
import { createIsomorphicFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";

/**
 * Set the Cache-Control header on the current SSR response. No-op on the client
 * and outside a request scope (e.g. prerender), so it is always safe to call
 * from a route loader.
 */
export const setCacheControlHeader = createIsomorphicFn()
  .server((value: string) => {
    try {
      setResponseHeader("cache-control", value);
    } catch {
      /* not inside a request scope - ignore */
    }
  })
  .client(() => {});
