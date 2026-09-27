// FILTR RUCHU NIELUDZKIEGO dla publicznych endpointów pomiaru (beaconów).
//
// PO CO. Beacon wysyła JavaScript po hydracji, więc zwykły crawler bez JS go
// nie odpali - ale przeglądarki bezgłowe (podgląd linków, testy wydajności,
// renderery prerender), prefetch spekulacyjny i skrypty z `curl` odpalą.
// Każde takie trafienie to fałszywe wyświetlenie w raporcie, za które sponsor
// płaci. Filtr jest CELOWO prosty i jawny: nazwy agentów, nagłówki prefetchu
// i niezgodny `Origin`. To nie jest ochrona przed zdeterminowanym atakiem
// (od tego jest limit po IP i deduplikacja per sesja x dzień w bazie), tylko
// odsianie ruchu, który sam się przedstawia jako nieludzki.
//
// ORIGIN. `sendBeacon` z POST-em wysyła `Origin` strony. Beacon z innej
// domeny to cudza strona nabijająca nam liczniki - odrzucamy. Brak nagłówka
// NIE jest powodem odrzucenia (starsze przeglądarki, prywatność).
//
// Z CZYM PORÓWNUJEMY ORIGIN. Z ZAUFANYM hostem strony (`currentTenantHost()`,
// czyli host zwalidowany względem `tenants.domain`), a NIE z hostem z adresu
// żądania: za pośrednikiem (CDN, platforma hostingowa) `req.url` niesie host
// wewnętrzny, a publiczny przychodzi w `X-Forwarded-Host` - porównanie z
// adresem żądania odrzucało wtedy KAŻDY prawdziwy beacon jako „cudzy". Oba
// hosty porównujemy znormalizowane (`normalizeHost`: małe litery, bez portu -
// zaufany host portu nie niesie, a serwer deweloperski stoi na
// `localhost:<port>`) i z aliasem www/apex, tak jak katalog najemców
// (`wwwToggledHost`): strona otwarta pod `www.` to ta sama strona.
//
// CZYSTA FUNKCJA: żadnego I/O, więc testy podają nagłówki wprost.
import { normalizeHost, wwwToggledHost } from "./host";

// JEDNA LISTA dla wszystkich beaconów (raport sponsora, lejek sprzedaży).
// Bez "telegram": wbudowana przeglądarka Telegrama na Androidzie dopisuje
// `Telegram-Android/...` do zwykłego agenta człowieka, a jego podgląd linków
// (`TelegramBot`) łapie już "bot".
const BOT_USER_AGENT =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender|preview|facebookexternalhit|embedly|quora link|whatsapp|pingdom|uptime|monitor|curl|wget|python-requests|python-urllib|go-http|node-fetch|axios|httpclient|java\/|okhttp|scrapy|phantomjs|selenium|puppeteer|playwright/i;

/** Czy user-agent wygląda na automat (brak nagłówka też jest automatem). */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const value = userAgent?.trim() ?? "";
  return value === "" || BOT_USER_AGENT.test(value);
}

function originHost(value: string): string | null {
  try {
    return normalizeHost(new URL(value).host);
  } catch {
    return null;
  }
}

/**
 * Czy żądanie wygląda na nieludzkie. `trustedHost` = zaufany host strony
 * (`currentTenantHost()`), nie host z adresu żądania - `Origin` z innym
 * hostem (poza aliasem www/apex) to cudza strona.
 */
export function isLikelyBotRequest(headers: Headers, trustedHost: string): boolean {
  if (isBotUserAgent(headers.get("user-agent"))) return true;

  const purpose =
    `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`.toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("prerender")) return true;

  const origin = headers.get("origin");
  if (origin === null || origin === "") return false;
  const fromOrigin = originHost(origin);
  const site = normalizeHost(trustedHost);
  if (fromOrigin === null || site === null) return true;
  return fromOrigin !== site && fromOrigin !== wwwToggledHost(site);
}
