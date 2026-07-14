import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchPosts from "./tools/search-posts";
import getPost from "./tools/get-post";
import listRecentPosts from "./tools/list-recent-posts";

// Supabase Auth issues JWTs whose `iss` is `<project>/auth/v1` and whose
// audience is the `authenticated` role. Gate the public /mcp endpoint on a
// valid Supabase-issued bearer token so only signed-in users of this app can
// invoke tools once the site is published. Tools stay read-only and public
// per-request authorization can still be layered on `ctx.getClaims()`.
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
// FAIL CLOSED: if we cannot derive the Supabase issuer we must NOT serve the
// endpoint with `auth: undefined` - the SDK then runs in its "unconfigured"
// (unauthenticated) mode, exposing the tools to anyone. Historically we threw
// at module init, but this module is transitively loaded by the SSR route tree
// on EVERY request. When the server env is momentarily missing (cold worker,
// build-time prerender, misconfigured deploy), the throw brought the WHOLE
// site down with h3's "HTTPError" 500 - a presentation-layer defect gating
// unrelated pages. Fail closed at REQUEST time instead: fall back to a
// syntactically valid but unreachable issuer so every bearer token fails the
// JWKS lookup with 401. The /mcp route stays locked; the rest of the site
// keeps rendering.
const SUPABASE_ISSUER = SUPABASE_URL
  ? `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1`
  : "https://mcp-unconfigured.invalid/auth/v1";
if (!SUPABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    "[mcp] SUPABASE_URL is not set - /mcp endpoint will reject every request (fail-closed).",
  );
}

export default defineMcp({
  name: "neweustrategies-mcp",
  title: "NEW EU Strategies",
  version: "0.1.0",
  instructions:
    "Tools for browsing published content on the NEW EU Strategies site. Use `list_recent_posts` to see what is fresh, `search_posts` to find articles by keyword, and `get_post` to fetch the full body of one article by slug. All tools accept a `lang` of 'pl' or 'en'.",
  tools: [searchPosts, getPost, listRecentPosts],
  auth: auth.oauth.issuer({
    issuer: SUPABASE_ISSUER,
    acceptedAudiences: "authenticated",
    resourceName: "NEW EU Strategies MCP",
  }),
});
