// Rozpoznawalne błędy serwera + mapowanie na przyjazne komunikaty i18n (PL/EN).
// Używane przez UI (toasty), by dwie klasy błędów - CSRF i rate limit - miały
// jednolity, czytelny opis niezależnie od tego, w jakim server-fn / route
// zostały rzucone. Typy błędów są węższe niż `Error`, więc kod klienta może je
// rozróżniać bez parsowania stringów.
import i18n from "@/lib/i18n";
import "@/lib/i18n-server-errors";
import type { AppLang } from "@/lib/i18n/localePath";

export const SERVER_ERROR_CODE = {
  csrf: "E_CSRF",
  rateLimit: "E_RATE_LIMIT",
} as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODE)[keyof typeof SERVER_ERROR_CODE];

/** Rzucany po stronie serwera gdy `rate_limit_hit` odrzucił żądanie. */
export class RateLimitError extends Error {
  readonly code = SERVER_ERROR_CODE.rateLimit;
  readonly scope: string;
  readonly retryAfterSec?: number;
  constructor(scope: string, retryAfterSec?: number) {
    super(`${SERVER_ERROR_CODE.rateLimit}: ${scope}`);
    this.name = "RateLimitError";
    this.scope = scope;
    this.retryAfterSec = retryAfterSec;
  }
}

/** Rzucany po stronie klienta gdy odpowiedź to 403 CSRF (fetch-owned). */
export class CsrfError extends Error {
  readonly code = SERVER_ERROR_CODE.csrf;
  constructor(message = "CSRF token missing or invalid") {
    super(`${SERVER_ERROR_CODE.csrf}: ${message}`);
    this.name = "CsrfError";
  }
}

interface FriendlyMessage {
  title: string;
  description: string;
}

function tt(lang: AppLang, key: string): string {
  return i18n.t(key, { lng: lang }) as string;
}

/**
 * Heurystyka: patrzymy na klasę błędu, kod (`code`), pole `status` (Response),
 * i wreszcie na treść wiadomości. Zwraca `null` gdy błąd nie jest jednym z
 * dwóch dedykowanych przypadków - caller pokazuje wtedy generyczny toast.
 */
export function mapServerError(err: unknown, lang: AppLang = "pl"): FriendlyMessage | null {
  if (!err) return null;

  if (err instanceof RateLimitError) {
    return {
      title: tt(lang, "serverErrors.rateLimit.title"),
      description: err.retryAfterSec
        ? tt(lang, "serverErrors.rateLimit.descriptionWithRetry").replace(
            "{{s}}",
            String(err.retryAfterSec),
          )
        : tt(lang, "serverErrors.rateLimit.description"),
    };
  }
  if (err instanceof CsrfError) {
    return {
      title: tt(lang, "serverErrors.csrf.title"),
      description: tt(lang, "serverErrors.csrf.description"),
    };
  }

  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : typeof (err as { message?: unknown }).message === "string"
          ? (err as { message: string }).message
          : "";
  const status =
    (err as { status?: number; statusCode?: number }).status ??
    (err as { statusCode?: number }).statusCode;

  if (msg.includes(SERVER_ERROR_CODE.csrf) || (status === 403 && /csrf/i.test(msg))) {
    return {
      title: tt(lang, "serverErrors.csrf.title"),
      description: tt(lang, "serverErrors.csrf.description"),
    };
  }
  if (msg.includes(SERVER_ERROR_CODE.rateLimit) || status === 429 || /rate.?limit/i.test(msg)) {
    return {
      title: tt(lang, "serverErrors.rateLimit.title"),
      description: tt(lang, "serverErrors.rateLimit.description"),
    };
  }
  return null;
}
