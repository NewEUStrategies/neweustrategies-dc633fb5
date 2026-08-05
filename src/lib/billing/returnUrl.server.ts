// Budowa bezwzględnego adresu powrotu dla operatora płatności. Origin bierzemy
// z nagłówków bieżącego żądania (dev/preview/produkcja bez ręcznej konfiguracji
// domeny), a dopiero potem z PUBLIC_SITE_URL. Ścieżka jest wcześniej
// sanityzowana przez safeReturnPath - patrz lib/billing/returnPath.
import { getRequest } from "@tanstack/react-start/server";
import { safeReturnPath } from "@/lib/billing/returnPath";

const FALLBACK_ORIGIN = "https://neweuropeanstrategies.com";

/** Origin bieżącego żądania (proxy-aware) lub skonfigurowany adres serwisu. */
export function requestOrigin(): string {
  const headers = getRequest()?.headers;
  const originHeader = headers?.get("origin");
  const forwardedProto = headers?.get("x-forwarded-proto");
  const forwardedHost = headers?.get("x-forwarded-host") ?? headers?.get("host");
  return (
    originHeader ??
    (forwardedHost ? `${forwardedProto ?? "https"}://${forwardedHost}` : null) ??
    process.env.PUBLIC_SITE_URL ??
    FALLBACK_ORIGIN
  );
}

/** Bezwzględny adres powrotu z bezpiecznej ścieżki względnej. */
export function absoluteReturnUrl(path: string | null | undefined, fallbackPath?: string): string {
  return new URL(safeReturnPath(path, fallbackPath), requestOrigin()).toString();
}
