// Przekierowania linków tras kodowych mapy HTML (/sitemap) - z PRAWDZIWYCH
// reguł najemcy, nie z kopii w kodzie.
//
// PO CO (przegląd 2026-10). Mapa HTML pomija link trasy, którą serwis
// przekierowuje 301 na opublikowaną stronę (`/events` -> `/wydarzenia`), bo
// inaczej linkowałaby ten sam adres dwa razy, raz przez przekierowanie.
// Reguły żyją jednak w `public.redirects` PER NAJEMCA (seed tylko dla `nes`,
// edytowalne w /admin/redirects), a mapa miała ich kopię wpisaną w kod dla
// wszystkich: inny najemca z opublikowaną `/wydarzenia`, ale bez reguły,
// tracił z mapy działający link `/events`, a usunięcie reguły w panelu nie
// zmieniało mapy. Ta funkcja czyta TEN SAM indeks reguł co middleware 301
// (`getRedirectIndexForTenant`) i to samo dopasowanie (`matchRedirectForPath`).
//
// GRANICA NAJEMCY: najemca z hosta żądania (jak w middleware przekierowań),
// nigdy z ładunku. Ładunek niesie wyłącznie ścieżki do sprawdzenia - te same,
// które każdy może sprawdzić, otwierając adres i patrząc na 301.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  paths: z
    .array(
      z
        .string()
        .max(200)
        .regex(/^\/[^\s?#]*$/),
    )
    .max(64),
});

/** Ścieżka źródłowa -> ścieżka docelowa (tylko przekierowania na adres względny). */
export type SiteMapRedirects = Record<string, string>;

export const getSiteMapRedirects = createServerFn({ method: "GET" })
  .validator((data: unknown) => input.parse(data))
  .handler(async ({ data }): Promise<SiteMapRedirects> => {
    const [{ getRequest }, { resolveTenantForHost }, { getRedirectIndexForTenant }, redirects] =
      await Promise.all([
        import("@tanstack/react-start/server"),
        import("@/lib/server/tenant.server"),
        import("@/lib/seo/redirects.server"),
        import("@/lib/seo/redirects"),
      ]);
    const tenant = await resolveTenantForHost(new URL(getRequest().url).hostname);
    if (!tenant) return {};
    const index = await getRedirectIndexForTenant(tenant.id);
    const out: SiteMapRedirects = {};
    for (const path of data.paths) {
      const hit = redirects.matchRedirectForPath(index, path, "");
      // 410 i adresy bezwzględne (inna domena) nie są „tym samym adresem
      // w drzewie" - link trasy zostaje, decyzję podejmuje mapa po swojemu.
      if (!hit || hit.gone || !hit.target.startsWith("/")) continue;
      out[path] = hit.target.split("?")[0];
    }
    return out;
  });
