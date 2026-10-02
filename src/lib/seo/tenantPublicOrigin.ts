// PUBLICZNY ORIGIN BIEŻĄCEGO TENANTA - adres, pod którym świat widzi serwis
// osoby, która właśnie patrzy na kokpit SEO.
//
// PO CO. Ekrany operatorskie (`/admin/seo/*`) zakładały jeden serwis: karta
// fundamentów technicznych sondowała i linkowała `CANONICAL_SITE_ORIGIN`,
// linki „na żywo" składały adres na `SITE_CANONICAL_ORIGIN`, a podgląd kart
// społecznościowych rysował host marki. Platforma jest jednak wielonajemcowa -
// admin innego tenanta oglądał więc stan mapy strony, robots.txt i llms.txt
// CUDZEGO serwisu, walidatory otwierały cudze adresy, a podgląd karty kłamał
// o hoście, pod którym jego link się udostępni.
//
// JEDNA REGUŁA Z POWIERZCHNIAMI MASZYNOWYMI. Origin nie jest liczony tu od
// nowa: domena zajęta przez tenanta (`tenants.domain`) albo - gdy jej brak -
// host karty przeglądarki przechodzą przez `crawlerPublishOrigin`, czyli przez
// TĘ SAMĄ funkcję, którą sitemap/robots/llms rozstrzygają, na jakim originie
// publikują adresy. Host marki, alias hostingu, podgląd edytora i localhost
// zbiegają się na originie kanonicznym marki; własna domena tenanta zostaje
// jego originem. Kokpit i pliki maszynowe nie mogą się więc rozjechać.
//
// TENANT BEZ PUBLICZNEJ DOMENY. Powierzchnie maszynowe rozstrzygają tenanta po
// hoście żądania (`resolveCrawlerTenantForHost`): host marki i host podglądu
// oznaczają tenanta DOMYŚLNEGO, a host niezajęty w katalogu - fail-closed.
// Tenant, który NIE jest domyślny i nie zajął domeny, nie ma więc żadnego
// adresu publicznego - a spadek na host karty dałby mu origin MARKI (ta sama
// klasa błędu: zielony stan plików marki, walidatory na stronie marki). Dla
// takiego tenanta reguła zwraca `null`, a ekran mówi to wprost.
//
// Moduł jest CZYSTY (bez Reacta, bez Supabase, bez `window`) - hook, który
// dostarcza mu danych, mieszka w `useTenantPublicOrigin.ts`.
import { CANONICAL_SITE_ORIGIN, crawlerPublishOrigin, normalizeHost } from "@/lib/http/host";

export interface TenantPublicOriginFacts {
  /**
   * `tenants.domain` bieżącego tenanta. `null`/`undefined` = brak zajętej
   * domeny ALBO odczyt jeszcze trwa/padł - w każdym z tych przypadków
   * schodzimy na host przeglądarki.
   */
  readonly domain?: string | null;
  /**
   * `tenants.is_default`. `false` = to NIE jest tenant marki, więc origin
   * marki nigdy nie jest jego originem. `null`/`undefined` = nie wiadomo
   * (odczyt w locie/padł, brak tenanta) - wtedy zostaje spadek na host karty.
   */
  readonly isDefault?: boolean | null;
  /** `window.location.host` (z portem lub bez); `null` podczas SSR. */
  readonly host?: string | null;
}

/**
 * Sam host z wpisu `tenants.domain`. Wpis bywa wklejony z protokołem albo
 * ze ścieżką („https://example.org/") - `normalizeHost` zjadłby wtedy
 * „https" jako host, więc protokół i ścieżkę zdejmujemy wcześniej.
 */
export function claimedDomainHost(domain: string | null | undefined): string | null {
  const trimmed = domain?.trim();
  if (!trimmed) return null;
  const withoutScheme = trimmed.includes("://") ? trimmed.split("://")[1] : trimmed;
  return normalizeHost(withoutScheme?.split("/")[0] ?? null);
}

/**
 * Origin (bez końcowego ukośnika), pod którym kokpit ma sondować pliki
 * generowane, budować linki „na żywo" i rysować host w podglądach kart.
 *
 * Kolejność: domena zajęta w bazie > host przeglądarki > origin kanoniczny
 * marki (SSR, brak hosta). Domena z bazy wygrywa z hostem, bo panel bywa
 * otwarty na hoście podglądu - a wtedy host karty mówi tylko tyle, że to
 * podgląd, nie którego serwisu.
 *
 * `null` = tenant (wiadomo, że NIE domyślny) nie ma publicznego originu: nie
 * zajął domeny albo jego wpis zbiega się na originie marki (alias hostingu).
 */
export function tenantPublicOrigin(facts: TenantPublicOriginFacts): string | null {
  const claimed = claimedDomainHost(facts.domain);
  if (facts.isDefault === false) {
    // Host karty niczego tu nie dowodzi: niezajęty host powierzchnie maszynowe
    // obsługują fail-closed, a host marki/podglądu należy do tenanta domyślnego.
    if (!claimed) return null;
    const origin = crawlerPublishOrigin(claimed);
    return origin === CANONICAL_SITE_ORIGIN ? null : origin;
  }
  if (claimed) return crawlerPublishOrigin(claimed);
  return crawlerPublishOrigin(facts.host ?? null);
}

/**
 * Czy panel otwarty na hoście `host` czyta same-origin pliki serwisu o originie
 * `origin`. Tak jest wtedy, gdy host panelu zbiega się na tym samym originie
 * publikacji (`crawlerPublishOrigin`) - np. marka na hoście podglądu albo
 * tenant na własnej domenie. Gdy nie - względne `/sitemap.xml` to plik INNEGO
 * serwisu (hosta panelu), a nie tenanta, więc nie wolno go raportować jako
 * jego stanu ani podawać do pobrania. `host` pusty (SSR) = nie wiadomo = nie.
 */
export function panelHostServesOrigin(
  host: string | null | undefined,
  origin: string | null,
): boolean {
  if (!origin || !normalizeHost(host)) return false;
  return crawlerPublishOrigin(host) === origin;
}
