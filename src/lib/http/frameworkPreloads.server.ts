import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";

/** Collect manifest hints per request and merge after h3 has applied loader
 * headers. Enabling responseLinkHeader alone loses them to h3's `set(Link)`.
 * Keep the body identity: the deferred document-cache record is keyed by it.
 */
export async function fetchWithFrameworkPreloads(
  fetch: RequestHandler<Register>,
  request: Request,
): Promise<Response> {
  const links = new Set<string>();
  const response = await fetch(request, {
    onEarlyHints: ({ hints, links: emitted }) => {
      hints.forEach((hint, index) => {
        if (hint.rel === "modulepreload") links.add(emitted[index]);
      });
    },
  });
  // Do not load a successful route's client code on redirects, errors or APIs.
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
    return response;
  }
  const existing = response.headers.get("link");
  const additional = [...links].filter((link) => !existing?.includes(link));
  if (!additional.length) return response;
  const headers = new Headers(response.headers);
  headers.set("link", [existing, ...additional].filter(Boolean).join(", "));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
