// Portfel na stronie biletu - czyste reguły po stronie przeglądarki.
//
// Adresy tras, wykrycie platformy (który przycisk pokazać) i mapowanie kodów
// błędów tras na klucze słownika `eventWallet`. Bez Reacta, bez i18next,
// bez sieci - wszystko tu da się sprawdzić wektorami.
//
// PLATFORMA DECYDUJE O PRZYCISKACH: iPhone/iPad dostaje Apple Wallet (Google
// Wallet nie działa na iOS), Android - Google Wallet (Apple Wallet nie działa
// na Androidzie), komputer - oba (Safari na macOS dodaje przepustkę do
// Portfela zsynchronizowanego z iPhone'em, link Google zapisuje ją na koncie).
// iPadOS od wersji 13 przedstawia się jako „Macintosh” - odróżnia go ekran
// dotykowy.

export const WALLET_ENDPOINTS = {
  apple: "/api/public/events/wallet/apple",
  google: "/api/public/events/wallet/google",
  availability: "/api/public/events/wallet/availability",
} as const;

export type WalletDevice = "ios" | "android" | "other";

export function detectWalletDevice(userAgent: string, maxTouchPoints: number): WalletDevice {
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  return "other";
}

export interface WalletAvailability {
  readonly apple: boolean;
  readonly google: boolean;
}

/** Które przyciski pokazać: skonfigurowane na platformie i sensowne na tym urządzeniu. */
export function walletButtonsFor(
  device: WalletDevice,
  availability: WalletAvailability,
): { apple: boolean; google: boolean } {
  return {
    apple: availability.apple && device !== "android",
    google: availability.google && device !== "ios",
  };
}

/** Kody błędów tras portfela (`walletRoutes.server.ts`) plus błąd sieci. */
export type WalletClientErrorCode =
  | "not_configured"
  | "invalid_token"
  | "rate_limited"
  | "not_found"
  | "upstream"
  | "wallet_failed"
  | "network";

export const WALLET_ERROR_KEYS: Record<WalletClientErrorCode, string> = {
  not_configured: "eventWallet.errors.unavailable",
  invalid_token: "eventWallet.errors.notFound",
  not_found: "eventWallet.errors.notFound",
  rate_limited: "eventWallet.errors.rateLimited",
  upstream: "eventWallet.errors.generic",
  wallet_failed: "eventWallet.errors.generic",
  network: "eventWallet.errors.generic",
};

export class WalletRequestError extends Error {
  constructor(readonly code: WalletClientErrorCode) {
    super(`wallet: ${code}`);
    this.name = "WalletRequestError";
  }
}

/** Dowolny błąd -> klucz komunikatu (nieznany -> ogólny). */
export function walletErrorKey(error: unknown): string {
  return error instanceof WalletRequestError
    ? WALLET_ERROR_KEYS[error.code]
    : WALLET_ERROR_KEYS.network;
}

function isErrorCode(value: unknown): value is WalletClientErrorCode {
  return typeof value === "string" && Object.hasOwn(WALLET_ERROR_KEYS, value);
}

/** Kod błędu z ciała odpowiedzi `{ error }`; ciało nieczytelne albo obcy kod -> `upstream`. */
export function walletErrorCodeFromBody(body: unknown): WalletClientErrorCode {
  const code =
    typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
  return isErrorCode(code) ? code : "upstream";
}
