import { defineMcp } from "@lovable.dev/mcp-js";
import searchPosts from "./tools/search-posts";
import getPost from "./tools/get-post";
import listRecentPosts from "./tools/list-recent-posts";

export default defineMcp({
  name: "neweustrategies-mcp",
  title: "NEW EU Strategies",
  version: "0.1.0",
  instructions:
    "Tools for browsing published content on the NEW EU Strategies site. Use `list_recent_posts` to see what is fresh, `search_posts` to find articles by keyword, and `get_post` to fetch the full body of one article by slug. All tools accept a `lang` of 'pl' or 'en'.",
  tools: [searchPosts, getPost, listRecentPosts],
});
