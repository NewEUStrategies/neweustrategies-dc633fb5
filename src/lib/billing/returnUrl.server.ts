// Budowa bezwzględnego adresu powrotu dla operatora płatności (`return_url`
// portalu klienta i sesji checkoutu - patrz `utils/payments.functions`).
//
// ADRES SKŁADA SIĘ Z DWÓCH POŁÓWEK I OBIE POCHODZĄ Z ZEWNĄTRZ:
//   * ŚCIEŻKA - z ładunku żądania, sanityzowana przez `safeReturnPath`
//     (`lib/billing/returnPath`),
//   * ORIGIN - z nagłówków żądania (`origin`, `x-forwarded-proto`,
//     `x-forwarded-host`, `host`), czyli z wartości, które klient może podać
//     dowolnie (server fn nie musi być wołana z przeglądarki, a `x-forwarded-*`
//     bywa doklejany przez warstwę pośrednią).
//
// Do 31.08.2026 druga połowa NIE MIAŁA ŻADNEJ BRAMKI - stąd bramka niżej.
// Zamykane defekty (opisane w `__tests__/returnUrl.server.test.ts`):
//   1. podrobiony `origin` przenosił `return_url` na obcą domenę,
//   2. to samo przez podrobiony `x-forwarded-host`,
//   3. host o nieprawidłowym kształcie (np. ze spacją) wywracał `new URL`
//      wyjątkiem - a ten wyjątek gasił `createStripePortalSession`, czyli
//      jednym nagłówkiem dało się zablokować anulowanie subskrypcji, zmianę
//      karty i pobranie faktur (odmowa usługi).
//
// WARIANT BRAMKI: PODMIANA NA ORIGIN KANONICZNY, NIE ODRZUCENIE ŻĄDANIA.
// Odrzucenie (wyjątek / błąd do użytkownika) zamieniłoby defekt open redirect
// w defekt dostępności - dokładnie ten, który zarejestrowano jako trzeci wyżej:
// jeden nagłówek od klienta gasiłby portal klienta wszystkim za tym samym
// proxy. Adres powrotu nie jest decyzją autoryzacyjną, tylko ekranem po
// płatności, więc cicha podmiana na origin kanoniczny jest zawsze poprawnym
// wynikiem: operacja u operatora dochodzi do skutku, a użytkownik wraca na
// naszą domenę. Funkcja MUSI zawsze oddać poprawny adres i nigdy nie rzuca.
//
// DLACZEGO LISTA HOSTÓW, A NIE ZAPYTANIE DO `tenants`. Repozytorium jest
// wielonajemcowe i hosty najemców żyją w `tenants.domain` / `tenants.aliases`,
// ale JEDYNY czytnik tego katalogu (`lib/server/tenant.server`) jest
// asynchroniczny, a `absoluteReturnUrl` jest synchroniczna i stoi w gorącej
// ścieżce otwierania portalu. Zamiana jej na asynchroniczną dołożyłaby
// oczekiwanie na katalog (a przy zimnym izolacie - round-trip do bazy) do
// operacji, która ma tylko skleić napis, i dała nowe źródło wyjątków tam,
// gdzie kontrakt brzmi „nigdy nie rzucaj". Dlatego wdrożenie z własnymi
// domenami najemców deklaruje je w `BILLING_RETURN_HOSTS` (odbicie
// `tenants.domain`), a katalog w bazie pozostaje źródłem prawdy dla
// płaszczyzny host -> tenant.
import { getRequest } from "@tanstack/react-start/server";
import { DEFAULT_RETURN_PATH, safeReturnPath } from "@/lib/billing/returnPath";
import {
  CANONICAL_SITE_HOSTS,
  CANONICAL_SITE_ORIGIN,
  normalizeHost,
  wwwToggledHost,
} from "@/lib/http/host";

/** Wbudowana domena serwisu - używana, gdy wdrożenie nie skonfigurowało adresu. */
const FALLBACK_ORIGIN = CANONICAL_SITE_ORIGIN;

/**
 * Hosty lokalne/deweloperskie. Świadomie NIE używamy tu `isPreviewHost`
 * z `lib/http/host`: tamta lista zawiera WSPÓŁDZIELONE domeny hostingu
 * (`*.pages.dev`, `*.workers.dev`), na których adres potrafi zarejestrować
 * ktokolwiek - jako klasa hosta dla crawlera to bezpieczne, jako cel
 * przekierowania po płatności byłaby to ta sama dziura, tylko węższa.
 */
const LOCAL_DEV_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

const NO_HOSTS: ReadonlySet<string> = new Set<string>();

function isLocalDevHost(host: string): boolean {
  return LOCAL_DEV_HOSTS.has(host) || host.endsWith(".localhost");
}

/** Rozbiór kandydata na origin: wyłącznie http/https i host o poprawnym kształcie. */
function parseHttpOrigin(
  candidate: string | null | undefined,
): { origin: string; host: string } | null {
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    // Host ze spacją albo inny bezsens - to jest defekt nr 3: TU wyjątek
    // kończy się `null`-em i zejściem na origin kanoniczny, a nie awarią
    // portalu klienta.
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = normalizeHost(url.hostname);
  return host ? { origin: url.origin, host } : null;
}

/** Origin kanoniczny serwisu: konfiguracja wdrożenia albo wbudowana domena. */
function canonicalOrigin(): string {
  return parseHttpOrigin(process.env.PUBLIC_SITE_URL)?.origin ?? FALLBACK_ORIGIN;
}

/**
 * Domeny najemców zadeklarowane przez wdrożenie (lista rozdzielana przecinkami,
 * odbicie `tenants.domain` / `tenants.aliases`). Dla każdego wpisu dopuszczamy
 * też odpowiednik www/apex - to jedna rejestracja, nie dwa serwisy.
 */
function declaredTenantHosts(): ReadonlySet<string> {
  const raw = process.env.BILLING_RETURN_HOSTS;
  if (!raw) return NO_HOSTS;
  const hosts = new Set<string>();
  for (const entry of raw.split(",")) {
    const host = normalizeHost(entry);
    if (!host) continue;
    hosts.add(host);
    hosts.add(wwwToggledHost(host));
  }
  return hosts;
}

/** Czy host wolno wpisać do adresu, który dostanie operator płatności. */
function returnHostIsAllowed(host: string): boolean {
  if (isLocalDevHost(host)) return true;
  if (CANONICAL_SITE_HOSTS.has(host)) return true;
  const canonicalHost = parseHttpOrigin(canonicalOrigin())?.host;
  if (canonicalHost && (host === canonicalHost || host === wwwToggledHost(canonicalHost))) {
    return true;
  }
  return declaredTenantHosts().has(host);
}

/**
 * Kandydaci na origin z nagłówków bieżącego żądania, w kolejności zaufania.
 * Nagłówek `origin` jest pierwszy, bo w dev/preview to jedyne źródło SCHEMATU
 * (http na localhoście); host z proxy jest drugi. Nigdy nie rzuca - poza
 * kontekstem żądania (cron, kolejka) lista jest po prostu pusta.
 */
function originCandidates(): string[] {
  let headers: Headers | undefined;
  try {
    headers = getRequest()?.headers;
  } catch {
    return [];
  }
  const originHeader = headers?.get("origin");
  const forwardedProto = headers?.get("x-forwarded-proto");
  const forwardedHost = headers?.get("x-forwarded-host") ?? headers?.get("host");
  const candidates: string[] = [];
  if (originHeader) candidates.push(originHeader);
  if (forwardedHost) candidates.push(`${forwardedProto ?? "https"}://${forwardedHost}`);
  return candidates;
}

/**
 * Origin bieżącego żądania (proxy-aware) lub skonfigurowany adres serwisu.
 *
 * UWAGA: wartość jest NIEZAUFANA - pochodzi wprost z nagłówków. Do budowy
 * adresów wysyłanych na zewnątrz służy `absoluteReturnUrl`, które przepuszcza
 * origin przez listę dozwolonych hostów.
 */
export function requestOrigin(): string {
  return originCandidates()[0] ?? canonicalOrigin();
}

/** Pierwszy origin żądania, który przechodzi bramkę; inaczej origin kanoniczny. */
function trustedReturnOrigin(): string {
  for (const candidate of originCandidates()) {
    const parsed = parseHttpOrigin(candidate);
    if (parsed && returnHostIsAllowed(parsed.host)) return parsed.origin;
  }
  return canonicalOrigin();
}

/**
 * Bezwzględny adres powrotu z bezpiecznej ścieżki względnej, na originie
 * należącym do serwisu. Nigdy nie rzuca: obie połowy adresu mają wartość
 * domyślną, a ostatni `catch` jest bramką na wypadek zmiany któregoś z nich.
 */
export function absoluteReturnUrl(path: string | null | undefined, fallbackPath?: string): string {
  try {
    return new URL(safeReturnPath(path, fallbackPath), trustedReturnOrigin()).toString();
  } catch {
    return `${FALLBACK_ORIGIN}${DEFAULT_RETURN_PATH}`;
  }
}
