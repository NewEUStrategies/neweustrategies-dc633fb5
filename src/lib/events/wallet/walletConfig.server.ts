// Konfiguracja portfeli z sekretów środowiska (tylko serwer).
//
// SEKRETY PLATFORMY, NIE NAJEMCY. Pass Type ID należy do jednego konta
// deweloperskiego Apple, a wystawca Google Wallet do jednego konta usługi -
// marka najemcy jedzie w treści przepustki (nazwa organizacji, kolory),
// a nie w certyfikacie. Nazwy zmiennych bez prefiksu `VITE_`: do paczki
// przeglądarki nie trafia ani bajt (`.env.example`, sekcja portfeli).
//
// BRAK KONFIGURACJI TO STAN, NIE AWARIA. Każda funkcja zwraca `null`, gdy
// czegoś brakuje albo coś ma zły kształt, a trasa odpowiada wtedy 503
// i przycisk na stronie biletu się nie pokazuje. Pełnej poprawności kluczy
// nie sprawdzamy tutaj (to kosztowny import) - zły klucz wychodzi przy
// pierwszym podpisie jako błąd serwera, a nie jako cichy fałszywy „brak".
//
// PEM Z JEDNEJ LINII. Panele sekretów często nie przyjmują nowych linii, więc
// `\n` zapisane literalnie (dwa znaki) zamieniamy na prawdziwy koniec linii -
// dokładnie tak, jak `ga4.server.ts` robi to z kluczem konta usługi.
import { firstEnv } from "@/lib/analytics/envSecrets";

export interface AppleWalletConfig {
  readonly passTypeId: string;
  readonly teamId: string;
  readonly signerCertPem: string;
  readonly signerKeyPem: string;
  readonly wwdrCertPem: string;
}

export interface GoogleServiceAccount {
  readonly clientEmail: string;
  readonly privateKeyPem: string;
  readonly tokenUri: string;
}

export interface GoogleWalletConfig {
  readonly issuerId: string;
  readonly serviceAccount: GoogleServiceAccount;
}

const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";

/** Literalne `\n` -> koniec linii; `null`, gdy napis nie wygląda na blok PEM. */
export function normalizePem(value: string | undefined): string | null {
  if (value === undefined) return null;
  const pem = value.replace(/\\n/g, "\n").trim();
  return /-----BEGIN [A-Z0-9 ]+-----[\s\S]+-----END [A-Z0-9 ]+-----/.test(pem) ? pem : null;
}

export function appleWalletConfig(): AppleWalletConfig | null {
  const passTypeId = firstEnv("APPLE_WALLET_PASS_TYPE_ID");
  const teamId = firstEnv("APPLE_WALLET_TEAM_ID");
  const signerCertPem = normalizePem(firstEnv("APPLE_WALLET_SIGNER_CERT_PEM"));
  const signerKeyPem = normalizePem(firstEnv("APPLE_WALLET_SIGNER_KEY_PEM"));
  const wwdrCertPem = normalizePem(firstEnv("APPLE_WALLET_WWDR_CERT_PEM"));
  if (
    passTypeId === undefined ||
    !/^pass\.[A-Za-z0-9.-]+$/.test(passTypeId) ||
    teamId === undefined ||
    !/^[A-Z0-9]{10}$/.test(teamId) ||
    signerCertPem === null ||
    signerKeyPem === null ||
    wwdrCertPem === null
  ) {
    return null;
  }
  return { passTypeId, teamId, signerCertPem, signerKeyPem, wwdrCertPem };
}

function readServiceAccount(raw: string | undefined): GoogleServiceAccount | null {
  if (raw === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const source =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const clientEmail = typeof source.client_email === "string" ? source.client_email.trim() : "";
  const privateKeyPem = normalizePem(
    typeof source.private_key === "string" ? source.private_key : undefined,
  );
  const tokenUri =
    typeof source.token_uri === "string" && /^https:\/\/\S+$/.test(source.token_uri)
      ? source.token_uri
      : GOOGLE_TOKEN_URI;
  if (!clientEmail.includes("@") || privateKeyPem === null) return null;
  return { clientEmail, privateKeyPem, tokenUri };
}

export function googleWalletConfig(): GoogleWalletConfig | null {
  const issuerId = firstEnv("GOOGLE_WALLET_ISSUER_ID");
  const serviceAccount = readServiceAccount(firstEnv("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON"));
  if (issuerId === undefined || !/^\d{6,25}$/.test(issuerId) || serviceAccount === null) {
    return null;
  }
  return { issuerId, serviceAccount };
}

/** Które portfele są skonfigurowane - bez ujawniania czegokolwiek poza tym. */
export function walletAvailability(): { apple: boolean; google: boolean } {
  return { apple: appleWalletConfig() !== null, google: googleWalletConfig() !== null };
}
