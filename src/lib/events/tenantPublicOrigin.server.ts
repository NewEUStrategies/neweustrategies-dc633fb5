// Publiczny adres najemcy dla linków w wiadomościach (e-mail, bell, ICS, PDF).
//
// DLACZEGO NIE `SITE_URL`. Zadania w tle (przypomnienia, oferty z listy
// rezerwowej, ankiety) działają kluczem serwisowym BEZ nagłówka hosta - nie
// wiedzą, pod jaką domeną uczestnik kupił bilet. Link „otwórz wydarzenie"
// zbudowany ze stałej wysłałby uczestnika najemcy B na stronę najemcy A,
// gdzie jego wydarzenia nie ma. Zadanie zna `tenant_id` z wiersza - ten moduł
// zamienia go na domenę z katalogu najemców (`getTenantDirectory()`).
//
// NIGDY NIE RZUCA. Wiadomość bez idealnego linku jest lepsza niż brak
// wiadomości: najemca bez domeny -> domena najemcy domyślnego -> stała
// `DEFAULT_PUBLIC_ORIGIN`. Katalog degraduje się sam (nieświeży zamiast
// pustego), a każdy wyjątek kończy się tą samą stałą.
import { localizedPath, type AppLang } from "@/lib/i18n/localePath";

export const DEFAULT_PUBLIC_ORIGIN = "https://neweuropeanstrategies.com";

function originOf(domain: string | null | undefined): string | null {
  const host = (domain ?? "").trim().toLowerCase();
  return host === "" ? null : `https://${host}`;
}

/** `https://<domena najemcy>` albo domena najemcy domyślnego albo stała. */
export async function tenantPublicOrigin(tenantId: string): Promise<string> {
  try {
    const { getTenantDirectory } = await import("@/lib/server/tenant.server");
    const directory = await getTenantDirectory();
    // Klucz mapy to znormalizowana (małe litery) domena - zawsze niepusta.
    for (const [domain, entry] of directory.byDomain) {
      if (entry.id === tenantId) return `https://${domain}`;
    }
    return originOf(directory.defaultTenant?.domain) ?? DEFAULT_PUBLIC_ORIGIN;
  } catch (err) {
    console.warn("[tenantPublicOrigin] directory unavailable", err);
    return DEFAULT_PUBLIC_ORIGIN;
  }
}

/**
 * Pełny link: origin najemcy + ścieżka w języku odbiorcy (`/en/...` dla EN).
 * Zapytanie i fragment (`#t=<token>`, `?tab=`) zostają nietknięte - prefiks
 * języka dostaje wyłącznie sama ścieżka.
 */
export async function tenantPublicUrl(
  tenantId: string,
  path: string,
  lang: AppLang,
): Promise<string> {
  const origin = await tenantPublicOrigin(tenantId);
  const cut = path.search(/[?#]/);
  const pathname = cut === -1 ? path : path.slice(0, cut);
  const rest = cut === -1 ? "" : path.slice(cut);
  return `${origin}${localizedPath(pathname, lang)}${rest}`;
}
