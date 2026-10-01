import { getColoCache } from "./documentCacheL2.server";
import { runAfterResponse } from "./waitUntil.server";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const CONDITIONAL_HEADERS = ["range", "if-range", "if-none-match", "if-modified-since"];

/** Cache full public images across Worker isolates in the same colo. Browser
 * Cache-Control alone does not populate the Worker's Cache API. Keep exact
 * Accept values: format negotiation belongs to storage, not this proxy.
 */
export async function withMediaCache(
  request: Request,
  upstream: URL,
  load: () => Promise<Response>,
): Promise<Response> {
  const cache = getColoCache();
  if (
    !cache ||
    request.method !== "GET" ||
    CONDITIONAL_HEADERS.some((header) => request.headers.has(header))
  ) {
    return load();
  }

  // Include the public host, storage project, tenant path and normalized
  // transformation. Unknown query parameters never create extra variants.
  const url = new URL("/__nes/media/v1", request.url);
  url.searchParams.set("source", upstream.href);
  url.searchParams.set("accept", request.headers.get("accept") ?? "");
  const key = new Request(url);
  try {
    const hit = await cache.match(key);
    if (hit) return hit;
  } catch {
    // Cache availability must never become a prerequisite for serving media.
  }

  const response = await load();
  const length = Number(response.headers.get("content-length"));
  if (
    response.status === 200 &&
    response.headers.get("content-type")?.startsWith("image/") &&
    Number.isSafeInteger(length) &&
    length > 0 &&
    length <= MAX_IMAGE_BYTES
  ) {
    // Both consumers stream concurrently; do not await the cache write before
    // returning bytes to the reader. Unknown/large bodies and video bypass it.
    const copy = response.clone();
    runAfterResponse(Promise.resolve().then(() => cache.put(key, copy)));
  }
  return response;
}
