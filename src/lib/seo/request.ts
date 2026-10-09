// Isomorphic access to the current request URL, used to build absolute canonical
// / og:url / hreflang links. On the server it derives scheme + host from the
// proxy-aware forwarded headers (so it is correct behind the edge proxy and
// on custom domains); on the client it reads window.location. createIsomorphicFn
// keeps the server-only getRequest import out of the client bundle.
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { isSearchCrawlerUserAgent } from "@/lib/http/searchCrawler";

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

/**
 * Czy bieżące żądanie SSR pochodzi od crawlera indeksującego wyszukiwarki
 * (`lib/http/searchCrawler.ts`). Na kliencie i poza zasięgiem żądania - `false`.
 */
export const isSearchCrawlerRequest = createIsomorphicFn()
  .server((): boolean => {
    try {
      return isSearchCrawlerUserAgent(getRequest().headers.get("user-agent"));
    } catch {
      return false;
    }
  })
  .client((): boolean => false);
