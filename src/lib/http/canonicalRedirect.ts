// Global canonical-host redirect. Every non-canonical host that still serves
// this deployment (hosting-layer aliases, legacy domains from
// `LEGACY_HOST_SUFFIXES`) answers with a full 301 to the canonical production
// origin, so share links, RSS enclosures and cached search-engine URLs converge
// on one origin instead of splitting link equity across aliases.
//
// The host classification itself lives in `lib/http/host.ts`
// (`isNonCanonicalPublicHost`) and is shared with the sitemap surfaces and
// robots.txt - one list, so a host can never be redirected here while still
// being advertised as indexable there.
//
// The check runs server-side only (via createIsomorphicFn) and is a no-op on
// the client and on local dev / in-editor preview hosts.
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";

import { CANONICAL_SITE_ORIGIN, isNonCanonicalPublicHost, normalizeHost } from "./host";

export const enforceCanonicalHost = createIsomorphicFn()
  .server((): void => {
    try {
      const req = getRequest();
      const host = normalizeHost(req.headers.get("host"));
      if (!host || !isNonCanonicalPublicHost(host)) return;
      const url = new URL(req.url);
      const target = `${CANONICAL_SITE_ORIGIN}${url.pathname}${url.search}`;
      throw redirect({ href: target, statusCode: 301, throw: true });
    } catch (err) {
      // Re-throw tanstack redirect; swallow header read failures.
      if (err && typeof err === "object" && "isRedirect" in err) throw err;
    }
  })
  .client((): void => undefined);
