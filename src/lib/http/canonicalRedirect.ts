// Global canonical-host redirect. Legacy Lovable preview hosts (both the
// published `.lovable.app` alias and the sandbox `<uuid>.lovableproject.com`
// preview) resolve to a full 301 to the canonical production origin so
// share links, RSS enclosures and cached search-engine URLs converge on
// neweuropeanstrategies.com.
//
// The check runs server-side only (via createIsomorphicFn) and is a no-op
// on the client and on local dev / editor internal hosts.
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";

import { normalizeHost } from "./host";

const CANONICAL_ORIGIN = "https://neweuropeanstrategies.com";
const CANONICAL_HOSTS = new Set(["neweuropeanstrategies.com", "www.neweuropeanstrategies.com"]);

// Hosts we intentionally do NOT redirect: local dev + Lovable in-editor
// live preview iframe (id-preview--<uuid>.lovable.app / *.lovable.dev),
// so the builder keeps working while the published aliases redirect.
function isEditorOrLocal(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (host.endsWith(".localhost")) return true;
  if (host.endsWith(".lovable.dev")) return true;
  if (host.startsWith("id-preview--")) return true;
  return false;
}

// Hosts that must 301 to the canonical origin: both the published
// `*.lovable.app` alias and the raw `<uuid>.lovableproject.com` preview.
function isLegacyHost(host: string): boolean {
  if (isEditorOrLocal(host)) return false;
  if (CANONICAL_HOSTS.has(host)) return false;
  return (
    host.endsWith(".lovable.app") ||
    host.endsWith(".lovableproject.com") ||
    host.endsWith(".pages.dev") ||
    host.endsWith(".workers.dev")
  );
}

export const enforceCanonicalHost = createIsomorphicFn()
  .server((): void => {
    try {
      const req = getRequest();
      const host = normalizeHost(req.headers.get("host"));
      if (!host || !isLegacyHost(host)) return;
      const url = new URL(req.url);
      const target = `${CANONICAL_ORIGIN}${url.pathname}${url.search}`;
      throw redirect({ href: target, statusCode: 301, throw: true });
    } catch (err) {
      // Re-throw tanstack redirect; swallow header read failures.
      if (err && typeof err === "object" && "isRedirect" in err) throw err;
    }
  })
  .client((): void => undefined);
