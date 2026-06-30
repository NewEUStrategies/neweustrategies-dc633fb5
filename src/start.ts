import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { isLocalizablePath, localizedPath, normalizeLang } from "@/lib/i18n/localePath";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE } from "@/lib/i18n/langCookie";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Legacy `?lang=` deep links predate URL-path i18n. Redirect them to the
// canonical, path-prefixed URL so link equity consolidates on one URL per
// language and the destination is edge-cacheable. Localizable paths map the
// language into the path ("/post?lang=en" -> "/en/post", a permanent 301); on
// non-localizable app pages the language can only live in the preference cookie,
// so we set it and 302 to the cleaned URL.
const legacyLangQueryMiddleware = createMiddleware().server(async ({ request, next }) => {
  const url = new URL(request.url);
  const lang = normalizeLang(url.searchParams.get("lang"));
  if (!lang) return next();

  url.searchParams.delete("lang");
  const query = url.searchParams.toString();
  const suffix = `${query ? `?${query}` : ""}${url.hash}`;

  if (isLocalizablePath(url.pathname)) {
    return new Response(null, {
      status: 301,
      headers: { Location: `${localizedPath(url.pathname, lang)}${suffix}` },
    });
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.pathname}${suffix}`,
      "Set-Cookie": `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax`,
    },
  });
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, legacyLangQueryMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));
