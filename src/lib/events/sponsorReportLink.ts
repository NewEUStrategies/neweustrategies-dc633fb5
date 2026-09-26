// Adres raportu dla sponsora: `/events/<slug>/sponsor-report#t=<token>`.
//
// TOKEN JEDZIE WE FRAGMENCIE (`#`), NIE W ZAPYTANIU. Fragmentu przeglądarka
// nie wysyła na serwer, więc poświadczenie nie trafia do logów dostępu,
// nagłówka `Referer` ani do cache brzegowego - ten sam wzorzec, co bilet
// z kodem QR (`manageToken.ts`, `ticketLinkPath`). Strona czyta go w
// przeglądarce i od razu zdejmuje z paska adresu (`history.replaceState`).
//
// Kształt tokenu to kształt `_event_new_qr_token()` (24 bajty, base64url,
// 32 znaki) - dokładnie ten sam wzorzec sprawdza baza.

export const SPONSOR_REPORT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function isSponsorReportToken(value: unknown): value is string {
  return typeof value === "string" && SPONSOR_REPORT_TOKEN_PATTERN.test(value);
}

/** Ścieżka strony raportu dla sponsora (bez tokenu). */
export function sponsorReportPath(eventSlug: string): string {
  return `/events/${encodeURIComponent(eventSlug)}/sponsor-report`;
}

/** Pełny link do przekazania sponsorowi: origin + ścieżka + `#t=<token>`. */
export function sponsorReportLinkUrl(origin: string, eventSlug: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${sponsorReportPath(eventSlug)}#t=${encodeURIComponent(token)}`;
}

/** `location.hash` -> token albo `null`, gdy go brak lub ma zły kształt. */
export function readSponsorReportFragment(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const token = params.get("t");
  return isSponsorReportToken(token) ? token : null;
}
