import { getRequest } from "@tanstack/react-start/server";

/**
 * Buduje bezwzględny adres powrotu dla Stripe Embedded Checkout (i innych
 * przekierowań płatniczych) ze ścieżki względnej lub pełnego URL podanego
 * przez klienta. Origin bierzemy z nagłówków żądania (dev/preview/produkcja
 * bez ręcznej konfiguracji domeny), a w ostatniej kolejności z
 * `PUBLIC_SITE_URL`.
 *
 * Jeśli klient przekaże absolutny URL, odrzucamy jego host - dzięki temu
 * atakujący nie może przekierować użytkownika na zewnętrzną domenę po
 * prawdziwej płatności.
 */
export function resolveReturnUrl(pathOrUrl: string): string {
  const request = getRequest();
  const headers = request?.headers;
  const originHeader = headers?.get("origin");
  const forwardedProto = headers?.get("x-forwarded-proto");
  const forwardedHost = headers?.get("x-forwarded-host") ?? headers?.get("host");
  const origin =
    originHeader ??
    (forwardedHost ? `${forwardedProto ?? "https"}://${forwardedHost}` : null) ??
    process.env.PUBLIC_SITE_URL ??
    "https://neweuropeanstrategies.com";

  let path = pathOrUrl;
  try {
    const parsed = new URL(pathOrUrl, "http://localhost");
    path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    // Pozostawiamy oryginalną wartość; new URL() weryfikuje ją przy
    // łączeniu z originem i wyrzuci wyjątek dla naprawdę złych danych.
  }

  return new URL(path, origin).toString();
}
