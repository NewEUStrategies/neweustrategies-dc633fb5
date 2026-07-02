// WordPress-compat feed alias: WP served the site feed at /feed (and /feed/),
// and existing reader subscriptions keep polling it after the migration.
// Permanent redirect onto the canonical /rss.xml (language-prefix preserved by
// the request URL: /en/feed -> /en/rss.xml).
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { localizedPath, stripLangPrefix, DEFAULT_LANG } from "@/lib/i18n/localePath";

export const Route = createFileRoute("/feed")({
  server: {
    handlers: {
      GET: async () => {
        let lang = DEFAULT_LANG;
        try {
          lang = stripLangPrefix(new URL(getRequest().url).pathname).lang ?? DEFAULT_LANG;
        } catch {
          /* keep default */
        }
        return new Response(null, {
          status: 301,
          headers: {
            Location: localizedPath("/rss.xml", lang),
            "Cache-Control": "public, max-age=86400",
          },
        });
      },
    },
  },
});
