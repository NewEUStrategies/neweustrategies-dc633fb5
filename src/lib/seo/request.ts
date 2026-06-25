// Isomorphic access to the current request URL, used to build absolute canonical
// / og:url / hreflang links. On the server it derives scheme + host from the
// proxy-aware forwarded headers (so it is correct behind the Lovable proxy and
// on custom domains); on the client it reads window.location. createIsomorphicFn
// keeps the server-only getRequest import out of the client bundle.
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const getRequestUrl = createIsomorphicFn()
  .server((): string => {
    try {
      const req = getRequest();
      const proto = req.headers.get("x-forwarded-proto") ?? "https";
      const host = req.headers.get("host") ?? "";
      if (!host) return "";
      const u = new URL(req.url);
      return `${proto}://${host}${u.pathname}${u.search}`;
    } catch {
      return "";
    }
  })
  .client((): string => (typeof window !== "undefined" ? window.location.href : ""));

export const getOrigin = createIsomorphicFn()
  .server((): string => {
    try {
      const req = getRequest();
      const proto = req.headers.get("x-forwarded-proto") ?? "https";
      const host = req.headers.get("host") ?? "";
      return host ? `${proto}://${host}` : "";
    } catch {
      return "";
    }
  })
  .client((): string => (typeof window !== "undefined" ? window.location.origin : ""));
