// Adres skanera: poświadczenie we FRAGMENCIE i (opcjonalnie) osobny origin.
//
// TOKEN JEDZIE WE FRAGMENCIE (`#t=`), NIE W ZAPYTANIU (OPS-07). Link
// parowania `/scanner?t=<token>` wnosił poświadczenie urządzenia do PIERWSZEGO
// żądania HTML - a więc do logów Cloudflare/Workers - i do historii
// przeglądarki, bo podmiana adresu działała dopiero po załadowaniu strony.
// Fragmentu przeglądarka nie wysyła na serwer; trasa czyta go w przeglądarce
// i od razu zdejmuje z paska (`history.replaceState`) - ten sam wzorzec, co
// bilet (`manageToken.ts`, `ticketLinkPath`) i raport sponsora
// (`sponsorReportLink.ts`).
//
// STARY LINK `?t=` NIE PARUJE. Token, który przyszedł w zapytaniu, JUŻ trafił
// do logów serwera i historii - użycie go utrwalałoby wyciek. Trasa zdejmuje go
// z adresu, nie łączy nim urządzenia i prosi o nowy kod QR (`legacy_link`).
//
// OSOBNY ORIGIN SKANERA (OPS-13, opcjonalnie). Token urządzenia leży
// w `localStorage` - pod tym samym originem co CMS i treści użytkowników
// czytałby go każdy skrypt, który przeciśnie się przez treść portalu.
// `VITE_SCANNER_ORIGIN` (np. `https://scan.example.eu`) przenosi skaner pod
// własny origin: panel buduje link parowania pod tym originem, a `/scanner`
// otwarty pod originem głównym przenosi urządzenie tam (token we fragmencie,
// po stronie przeglądarki). Bez zmiennej - zachowanie jak dotąd.
// Wdrożenie (DNS, trasa Workers, ograniczenie hosta do `/scanner`) opisuje
// `docs/OPS_SKANER_OSOBNY_ORIGIN_2026-10-12.md`.
import { SCANNER_TOKEN_PATTERN } from "@/lib/events/scannerToken";

export const SCANNER_PATH = "/scanner";

/** Komunikat dla ekranu skanera niesiony we fragmencie (`#e=`). */
export type ScannerNotice = "legacy_link";

/**
 * Origin z konfiguracji albo `null`, gdy wartość nie jest czystym originem:
 * wymagany `https:` (wyjątek: `http:` dla localhost), bez ścieżki, zapytania,
 * fragmentu i danych logowania - ta sama reguła, co origin mediów
 * (`lib/media/publicUrl.ts`). Literówka w zmiennej nie może wysłać tokenów
 * urządzeń pod obcy albo niepełny host.
 */
export function parseScannerOrigin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/\/+$/, "");
  if (value === "") return null;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
      return null;
    }
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Skonfigurowany origin skanera albo `null` (skaner pod originem portalu). */
export const SCANNER_ORIGIN: string | null = parseScannerOrigin(
  import.meta.env.VITE_SCANNER_ORIGIN,
);

/** Origin, pod którym ma działać skaner, widziany z originu `current`. */
export function scannerOriginFor(current: string, configured = SCANNER_ORIGIN): string {
  return configured ?? current;
}

/**
 * Dokąd przenieść skaner otwarty pod originem `current` - `null`, gdy osobny
 * origin nie jest skonfigurowany albo właśnie pod nim jesteśmy.
 */
export function scannerRelocationTarget(
  current: string,
  configured = SCANNER_ORIGIN,
): string | null {
  return configured === null || configured === current ? null : configured;
}

/** Adres skanera pod originem `origin` z tokenem i/lub komunikatem we fragmencie. */
export function scannerUrl(
  origin: string,
  fragment: { token?: string | null; notice?: ScannerNotice | null } = {},
): string {
  const params = new URLSearchParams();
  if (typeof fragment.token === "string" && fragment.token !== "") params.set("t", fragment.token);
  if (fragment.notice !== undefined && fragment.notice !== null) params.set("e", fragment.notice);
  const hash = params.toString();
  return `${origin.replace(/\/+$/, "")}${SCANNER_PATH}${hash === "" ? "" : `#${hash}`}`;
}

/** Link parowania z panelu: origin skanera + `/scanner#t=<token>`. */
export function scannerPairingUrl(origin: string, token: string): string {
  return scannerUrl(origin, { token });
}

export interface ScannerEntry {
  /** Poświadczenie z fragmentu (`#t=`) - jedyne, którym adres może sparować urządzenie. */
  token: string | null;
  /** Komunikat dla ekranu: stary link `?t=` (z zapytania albo przeniesiony we fragmencie). */
  notice: ScannerNotice | null;
}

/**
 * `location.hash` + `location.search` -> wejście skanera. Token z ZAPYTANIA
 * nigdy nie paruje (patrz nagłówek) - zamienia się w komunikat `legacy_link`.
 */
export function readScannerEntry(hash: string, search: string): ScannerEntry {
  const fragment = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = (fragment.get("t") ?? "").trim();
  const token = SCANNER_TOKEN_PATTERN.test(raw) ? raw : null;
  const legacy = query.has("t") || fragment.get("e") === "legacy_link";
  return { token, notice: legacy ? "legacy_link" : null };
}

/** Czy adres niesie cokolwiek, co trzeba zdjąć z paska i historii. */
export function scannerEntryNeedsCleanup(hash: string, search: string): boolean {
  return (hash !== "" && hash !== "#") || (search !== "" && search !== "?");
}
