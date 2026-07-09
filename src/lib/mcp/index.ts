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

export default defineMcp({
  name: "neweustrategies-mcp",
  title: "NEW EU Strategies",
  version: "0.1.0",
  instructions:
    "Tools for browsing published content on the NEW EU Strategies site. Use `list_recent_posts` to see what is fresh, `search_posts` to find articles by keyword, and `get_post` to fetch the full body of one article by slug. All tools accept a `lang` of 'pl' or 'en'.",
  tools: [searchPosts, getPost, listRecentPosts],
  auth: SUPABASE_ISSUER
    ? auth.oauth.issuer({
        issuer: SUPABASE_ISSUER,
        acceptedAudiences: "authenticated",
        resourceName: "NEW EU Strategies MCP",
      })
    : undefined,
});
