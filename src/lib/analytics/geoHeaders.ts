// KRAJ ODWIEDZAJĄCEGO Z NAGŁÓWKA BRZEGOWEGO.
//
// SKĄD SIĘ BIERZE KRAJ. Nie z bazy GeoIP w tym procesie i nie z adresu IP
// zapisanego u nas - z nagłówka, który dokłada warstwa brzegowa (CDN/hosting)
// PRZED dotarciem żądania do aplikacji. Sama rozdzielczość jest krajowa i taka
// zostaje: mapa pulpitu potrzebuje kraju, a nie miasta, a im mniej danych
// o osobie przechodzi przez ingest, tym mniej mamy do stracenia.
//
// DLACZEGO NIE LICZYMY KRAJU Z IP SAMI. Musielibyśmy wtedy trzymać adres IP
// (dane osobowe) choćby chwilę w pamięci ingestu i utrzymywać bazę GeoIP.
// Nagłówek brzegowy daje wynik gotowy, więc adres IP nigdy nie wchodzi do tej
// ścieżki - `analytics_events` nie ma i nie dostaje kolumny z IP.
//
// ZGODA. Kraj jedzie tą samą ścieżką co reszta beaconu (`lib/analytics/track.ts`)
// i tą samą zgodą analityczną: bez zgody klient nie wysyła NICZEGO, więc nie ma
// zdarzenia, do którego kraj miałby się dokleić. Ta funkcja nie jest więc drugą
// bramką zgody - jest wzbogaceniem zdarzenia, które zgodę już przeszło.
//
// NIEZNANY KRAJ ZOSTAJE NIEZNANY. Każdy dostawca ma własną formę „nie wiem"
// ("XX", "T1" dla sieci Tor u Cloudflare, pusty napis) i żadnej z nich nie wolno
// zapisać jako kodu kraju - mapa pokazałaby wtedy państwo, którego nie ma.
// Zwracamy `null`, a kolumna jest nullowalna właśnie po to.

/**
 * Nagłówki niosące kod kraju ISO 3166-1 alpha-2, w kolejności zaufania.
 * Pierwszy obecny i sensowny wygrywa - lista jest po to, żeby ta sama aplikacja
 * działała za Cloudflare, Vercelem, Netlify i Fly bez przełącznika konfiguracji.
 */
const COUNTRY_HEADERS = [
  "cf-ipcountry", // Cloudflare
  "x-vercel-ip-country", // Vercel
  "x-country-code", // Fastly / konfiguracje własne
  "x-geo-country", // część CDN-ów i odwrotnych proxy
  "x-appengine-country", // Google App Engine
] as const;

/**
 * Zapisy, które w nagłówku znaczą „nie wiem", a nie kraj. `T1` to u Cloudflare
 * sieć Tor, `XX` i `ZZ` to konwencjonalne „nieznane"; `EU`/`AP` to kontynenty,
 * które Cloudflare zwraca, gdy nie potrafi zejść do kraju - kontynent nie jest
 * kodem kraju i mapa nie ma gdzie go pokazać.
 */
const NOT_A_COUNTRY = new Set(["XX", "ZZ", "T1", "EU", "AP", "A1", "A2", "O1"]);

function normalise(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== 2) return null;
  if (!/^[A-Z]{2}$/.test(code)) return null;
  if (NOT_A_COUNTRY.has(code)) return null;
  return code;
}

/**
 * Kod kraju ISO 3166-1 alpha-2 z nagłówków żądania albo `null`.
 *
 * Netlify jest obsługiwane osobno, bo jako jedyne z tej listy podaje geografię
 * nie napisem, tylko obiektem JSON w `x-nf-geo` - wyciągamy z niego wyłącznie
 * kod kraju i nic więcej, mimo że nagłówek niesie też miasto i współrzędne.
 */
export function countryFromHeaders(headers: Headers): string | null {
  for (const name of COUNTRY_HEADERS) {
    const code = normalise(headers.get(name));
    if (code) return code;
  }

  const netlify = headers.get("x-nf-geo");
  if (netlify) {
    try {
      const parsed = JSON.parse(netlify) as { country?: { code?: unknown } };
      const raw = parsed?.country?.code;
      if (typeof raw === "string") return normalise(raw);
    } catch {
      // Nagłówek nie do sparsowania traktujemy jak jego brak - ingest jest
      // best-effort i nie ma prawa wywrócić się na cudzym formacie.
    }
  }

  return null;
}
