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
const SUPABASE_ISSUER = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1` : "";

// FAIL CLOSED: if we cannot derive the Supabase issuer we must NOT serve the
// endpoint with `auth: undefined` - the SDK then runs in its "unconfigured"
// (unauthenticated) mode, exposing the tools to anyone. A missing SUPABASE_URL
// at server runtime is a fatal misconfiguration (the Supabase client throws on
// first use for the same reason), so we refuse to construct the MCP server
// rather than expose it open. This module is imported only by the /mcp route
// handlers, which are evaluated at server runtime (where the var is present),
// not during `vite build`; unrelated routes are unaffected.
if (!SUPABASE_ISSUER) {
  throw new Error(
    "[mcp] Refusing to start: SUPABASE_URL is not set, so the OAuth issuer cannot be derived. " +
      "The MCP endpoint must be authenticated; set SUPABASE_URL (server env) to enable it.",
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
