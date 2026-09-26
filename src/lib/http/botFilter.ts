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
// CZYSTA FUNKCJA: żadnego I/O, więc testy podają nagłówki wprost.

const BOT_USER_AGENT =
  /bot|crawl|spider|slurp|headless|lighthouse|prerender|preview|facebookexternalhit|embedly|pingdom|uptime|monitor|curl|wget|python-requests|python-urllib|go-http|node-fetch|axios|httpclient|java\/|okhttp|scrapy|phantomjs|selenium|puppeteer|playwright/i;

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Czy żądanie wygląda na nieludzkie. `requestHost` = host, pod który przyszło
 * żądanie (z adresu żądania) - `Origin` z innym hostem to cudza strona.
 */
export function isLikelyBotRequest(headers: Headers, requestHost: string | null): boolean {
  const userAgent = headers.get("user-agent")?.trim() ?? "";
  if (userAgent === "" || BOT_USER_AGENT.test(userAgent)) return true;

  const purpose =
    `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`.toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("prerender")) return true;

  const origin = headers.get("origin");
  if (origin === null || origin === "" || requestHost === null) return false;
  return hostOf(origin) !== requestHost.toLowerCase();
}
