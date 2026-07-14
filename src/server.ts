import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

/** Test seam for the preview-recovery invariant; no server entry details escape. */
export function isServerEntryCached(): boolean {
  return serverEntryPromise !== undefined;
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} - try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isOpaqueH3Error(body)) return response;

  // The preview server can replace its SSR module graph while an older
  // streamed render is still resolving React.lazy widget imports. Vite then
  // closes that module runner and h3 turns the rejection into this opaque 500.
  // Keeping the resolved entry in our module-level cache made every following
  // request reuse the dead graph, so the preview stayed poisoned after the
  // rebuild had finished. Drop it here just like we do for a rejected import;
  // the next request resolves the current, healthy server entry.
  serverEntryPromise = undefined;
  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function isOpaqueH3Error(body: string): boolean {
  try {
    const payload: unknown = JSON.parse(body);
    if (payload == null || typeof payload !== "object") return false;
    const candidate = payload as { unhandled?: unknown; message?: unknown };
    return candidate.unhandled === true && candidate.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      // A rejected lazy import must not poison every subsequent request in the
      // same worker. Clear it once; the next request gets a fresh module load.
      serverEntryPromise = undefined;
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
  },
};
