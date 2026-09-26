// Portfel na stronie biletu - wywołania tras `/api/public/events/wallet/*`.
//
// KOD BILETU TYLKO W CIELE POST. Strona biletu ma go we fragmencie adresu;
// stąd jedzie wyłącznie w ciele żądania (formularz albo JSON), nigdy
// w adresie, więc nie trafia do logów dostępu ani do nagłówka `Referer`.
// Odpowiedzi nie cache'ujemy (`no-store`) - niosą dane konkretnego biletu.
//
// Apple: `checkAppleWalletPass` przechodzi przez WSZYSTKIE zapory trasy bez
// budowy paczki (`intent=check` -> 204), żeby przycisk mógł pokazać błąd na
// stronie. Samą paczkę pobiera potem zwykły formularz - tylko tak iOS Safari
// otwiera arkusz „Dodaj przepustkę”.
import {
  WALLET_ENDPOINTS,
  WalletRequestError,
  walletErrorCodeFromBody,
  type WalletAvailability,
} from "./ticketWallet";

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
  } catch {
    throw new WalletRequestError("network");
  }
}

async function failure(response: Response): Promise<WalletRequestError> {
  const body: unknown = await response.json().catch(() => null);
  return new WalletRequestError(walletErrorCodeFromBody(body));
}

/** `{ apple, google }` - które portfele są skonfigurowane. */
export async function fetchWalletAvailability(): Promise<WalletAvailability> {
  const response = await send(WALLET_ENDPOINTS.availability, { method: "GET" });
  if (!response.ok) throw await failure(response);
  const body: unknown = await response.json().catch(() => null);
  const record = typeof body === "object" && body !== null ? body : {};
  return {
    apple: "apple" in record && record.apple === true,
    google: "google" in record && record.google === true,
  };
}

/** Sprawdzenie przed pobraniem `.pkpass`: rzuca `WalletRequestError`, gdy paczki nie będzie. */
export async function checkAppleWalletPass(token: string, lang: string): Promise<void> {
  const response = await send(WALLET_ENDPOINTS.apple, {
    method: "POST",
    body: new URLSearchParams({ token, lang, intent: "check" }),
  });
  if (response.status !== 204) throw await failure(response);
}

/** Link „zapisz w Google Wallet” dla biletu. */
export async function requestGoogleWalletSaveUrl(token: string, lang: string): Promise<string> {
  const response = await send(WALLET_ENDPOINTS.google, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, lang }),
  });
  if (!response.ok) throw await failure(response);
  const body: unknown = await response.json().catch(() => null);
  const saveUrl =
    typeof body === "object" && body !== null && "saveUrl" in body ? body.saveUrl : undefined;
  // Wyłącznie adres zapisu Google - odpowiedź nie może przenieść uczestnika gdzie indziej.
  if (typeof saveUrl !== "string" || !saveUrl.startsWith("https://pay.google.com/gp/v/save/")) {
    throw new WalletRequestError("upstream");
  }
  return saveUrl;
}
