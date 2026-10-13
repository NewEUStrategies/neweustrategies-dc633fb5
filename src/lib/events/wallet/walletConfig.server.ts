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
// i przycisk na stronie biletu się nie pokazuje.
//
// KONFIGURACJA, KTÓRA NIE ZADZIAŁA, TEŻ JEST BRAKIEM (OPS-14). Kształt
// zmiennych to za mało: klucz z innej pary niż certyfikat Pass Type ID,
// wygasły certyfikat albo zły certyfikat WWDR dają poprawnie podpisaną paczkę,
// którą iOS po cichu odrzuca przy KAŻDYM „Dodaj" - uczestnik widzi „nie można
// dodać", a serwer nie ma żadnego błędu. Dlatego konfiguracja Apple przechodzi
// kontrolę (`inspectAppleWalletConfig`):
//   * klucz prywatny pasuje do klucza publicznego certyfikatu (moduł
//     i wykładnik RSA porównane bajt w bajt - bez WebCrypto, synchronicznie);
//   * certyfikat Pass Type ID i WWDR są ważne TERAZ (notBefore/notAfter);
//   * certyfikat Pass Type ID wystawił skonfigurowany WWDR (wystawca ==
//     podmiot WWDR - typowy błąd to stary WWDR G1 przy certyfikacie z G4);
//   * UID i OU certyfikatu (gdy są) zgadzają się z APPLE_WALLET_PASS_TYPE_ID
//     i APPLE_WALLET_TEAM_ID - `pass.json` musi nieść te same wartości.
// Każde naruszenie to `null` (503 `not_configured`) i JEDNA czytelna linia
// logu bez sekretów: nazwa i numer seryjny certyfikatu, daty, długość i końcówka
// PUBLICZNEGO modułu - nigdy bajty klucza prywatnego. Certyfikat ważny krócej
// niż 30 dni zostaje skonfigurowany, ale loguje ostrzeżenie. Klucz konta usługi
// Google musi dać się odczytać jako klucz RSA.
//
// Publiczna trasa dostępności (`/api/public/events/wallet/availability`)
// świadomie mówi tylko „jest / nie ma" - ostrzeżenia i powody idą do logu, nie
// do anonimowego odbiorcy.
//
// PAMIĘĆ NA IZOLAT. Rozbiór certyfikatów i kluczy robimy raz na wartość
// zmiennych (pamięć z jednym wpisem na platformę, kluczem jest treść
// konfiguracji); od chwili zależą tylko porównania dat, liczone przy każdym
// odczycie. Ten sam werdykt loguje się raz na izolat.
//
// PEM Z JEDNEJ LINII. Panele sekretów często nie przyjmują nowych linii, więc
// `\n` zapisane literalnie (dwa znaki) zamieniamy na prawdziwy koniec linii -
// dokładnie tak, jak `ga4.server.ts` robi to z kluczem konta usługi.
import { firstEnv } from "@/lib/analytics/envSecrets";

import { readRsaPrivateKeyParts, sameRsaPublicKey, toHex } from "./rsa";
import {
  type CertificateDetails,
  nameAttribute,
  pemBlock,
  readCertificateDetails,
  type RsaPublicKeyParts,
  X509_OID,
} from "./x509";

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

/** Wynik kontroli: `problems` niepuste = portfel nieskonfigurowany. */
export interface WalletConfigReport {
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
}

const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Certyfikat ważny krócej niż tyle dni - ostrzeżenie w logu. */
export const CERT_EXPIRY_WARNING_DAYS = 30;

/** Literalne `\n` -> koniec linii; `null`, gdy napis nie wygląda na blok PEM. */
export function normalizePem(value: string | undefined): string | null {
  if (value === undefined) return null;
  const pem = value.replace(/\\n/g, "\n").trim();
  return /-----BEGIN [A-Z0-9 ]+-----[\s\S]+-----END [A-Z0-9 ]+-----/.test(pem) ? pem : null;
}

// ── Kontrola Apple ─────────────────────────────────────────────────────────

/** Fakty z rozbioru certyfikatu, które oceniamy względem chwili. */
interface DatedCertificate {
  readonly role: "Pass Type ID" | "WWDR";
  readonly label: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
}

interface AppleFacts {
  /** Naruszenia niezależne od chwili (rozbiór, para kluczy, łańcuch, UID/OU). */
  readonly problems: readonly string[];
  readonly certificates: readonly DatedCertificate[];
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `"CN" (serial abc)` - jawne dane certyfikatu do logu. */
function certificateLabel(cert: CertificateDetails): string {
  const cn = nameAttribute(cert.subject, X509_OID.commonName) ?? "bez CN";
  return `"${cn}" (serial ${cert.serialHex})`;
}

/** Długość i końcówka PUBLICZNEGO modułu - dość, żeby rozpoznać parę, nic tajnego. */
function modulusLabel(key: RsaPublicKeyParts): string {
  return `${key.modulus.length * 8}-bit ...${toHex(key.modulus.slice(-4))}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function readCertificatePem(pem: string): CertificateDetails {
  return readCertificateDetails(pemBlock(pem, ["CERTIFICATE"]).der);
}

function inspectAppleFacts(config: AppleWalletConfig): AppleFacts {
  const problems: string[] = [];
  const certificates: DatedCertificate[] = [];

  let signer: CertificateDetails | null = null;
  try {
    signer = readCertificatePem(config.signerCertPem);
    certificates.push({
      role: "Pass Type ID",
      label: certificateLabel(signer),
      notBefore: signer.notBefore,
      notAfter: signer.notAfter,
    });
  } catch (err) {
    problems.push(
      `Pass Type ID certificate (APPLE_WALLET_SIGNER_CERT_PEM) unreadable: ${message(err)}`,
    );
  }

  let wwdr: CertificateDetails | null = null;
  try {
    wwdr = readCertificatePem(config.wwdrCertPem);
    certificates.push({
      role: "WWDR",
      label: certificateLabel(wwdr),
      notBefore: wwdr.notBefore,
      notAfter: wwdr.notAfter,
    });
  } catch (err) {
    problems.push(`WWDR certificate (APPLE_WALLET_WWDR_CERT_PEM) unreadable: ${message(err)}`);
  }

  let key: RsaPublicKeyParts | null = null;
  try {
    key = readRsaPrivateKeyParts(config.signerKeyPem);
  } catch (err) {
    problems.push(`signer private key (APPLE_WALLET_SIGNER_KEY_PEM) unreadable: ${message(err)}`);
  }

  if (signer !== null) {
    const label = certificateLabel(signer);
    if (signer.rsaPublicKey === null) {
      problems.push(
        `Pass Type ID certificate ${label} carries a non-RSA key (${signer.publicKeyAlgorithm})`,
      );
    } else if (key !== null && !sameRsaPublicKey(signer.rsaPublicKey, key)) {
      problems.push(
        `private key does not match the Pass Type ID certificate ${label}: ` +
          `certificate modulus ${modulusLabel(signer.rsaPublicKey)}, key modulus ${modulusLabel(key)}`,
      );
    }

    const uid = nameAttribute(signer.subject, X509_OID.userId);
    if (uid !== null && uid !== config.passTypeId) {
      problems.push(
        `Pass Type ID certificate ${label} is for "${uid}", ` +
          `but APPLE_WALLET_PASS_TYPE_ID is "${config.passTypeId}"`,
      );
    }
    const ou = nameAttribute(signer.subject, X509_OID.organizationalUnit);
    if (ou !== null && ou !== config.teamId) {
      problems.push(
        `Pass Type ID certificate ${label} belongs to team "${ou}", ` +
          `but APPLE_WALLET_TEAM_ID is "${config.teamId}"`,
      );
    }

    if (wwdr !== null && !sameBytes(signer.issuer, wwdr.subject)) {
      const issuerCn = nameAttribute(signer.issuer, X509_OID.commonName) ?? "bez CN";
      problems.push(
        `Pass Type ID certificate ${label} was issued by "${issuerCn}", ` +
          `not by the configured WWDR certificate ${certificateLabel(wwdr)}`,
      );
    }
  }

  return { problems, certificates };
}

function evaluateDates(facts: AppleFacts, nowMs: number): WalletConfigReport {
  const problems = [...facts.problems];
  const warnings: string[] = [];
  for (const cert of facts.certificates) {
    const subject = `${cert.role} certificate ${cert.label}`;
    if (nowMs < cert.notBefore.getTime()) {
      problems.push(`${subject} is not valid before ${cert.notBefore.toISOString()}`);
    } else if (nowMs >= cert.notAfter.getTime()) {
      problems.push(`${subject} expired on ${cert.notAfter.toISOString()}`);
    } else {
      const daysLeft = Math.floor((cert.notAfter.getTime() - nowMs) / DAY_MS);
      if (daysLeft < CERT_EXPIRY_WARNING_DAYS) {
        warnings.push(
          `${subject} expires in ${daysLeft} days (${cert.notAfter.toISOString()}) - renew it`,
        );
      }
    }
  }
  return { problems, warnings };
}

/** Pełna kontrola konfiguracji Apple w chwili `nowMs` (bez pamięci, bez logu). */
export function inspectAppleWalletConfig(
  config: AppleWalletConfig,
  nowMs: number,
): WalletConfigReport {
  return evaluateDates(inspectAppleFacts(config), nowMs);
}

// ── Kontrola Google ────────────────────────────────────────────────────────

/** Kontrola konfiguracji Google: klucz konta usługi musi być kluczem RSA. */
export function inspectGoogleWalletConfig(config: GoogleWalletConfig): WalletConfigReport {
  try {
    readRsaPrivateKeyParts(config.serviceAccount.privateKeyPem);
    return { problems: [], warnings: [] };
  } catch (err) {
    return {
      problems: [`service account private key unreadable: ${message(err)}`],
      warnings: [],
    };
  }
}

// ── Pamięć na izolat i log jeden raz ──────────────────────────────────────

let appleMemo: { key: string; facts: AppleFacts } | null = null;
let googleMemo: { key: string; report: WalletConfigReport } | null = null;
/** Ostatnio zalogowany werdykt na platformę - ten sam nie loguje się drugi raz. */
const lastLogged = new Map<"apple" | "google", string>();

function logOnce(platform: "apple" | "google", report: WalletConfigReport): void {
  const signature = [...report.problems, "|", ...report.warnings].join("\n");
  if (lastLogged.get(platform) === signature) return;
  lastLogged.set(platform, signature);
  if (report.problems.length > 0) {
    console.error(`[wallet] ${platform} wallet not configured: ${report.problems.join("; ")}`);
  }
  for (const warning of report.warnings) console.warn(`[wallet] ${platform} wallet: ${warning}`);
}

/** Tylko testy: świeży rozbiór i log po zmianie środowiska w tym samym procesie. */
export function resetWalletConfigMemoForTests(): void {
  appleMemo = null;
  googleMemo = null;
  lastLogged.clear();
}

function readAppleEnv(): AppleWalletConfig | null {
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

/** Konfiguracja Apple, która przeszła kontrolę w chwili `nowMs`, albo `null`. */
export function appleWalletConfig(nowMs: number = Date.now()): AppleWalletConfig | null {
  const config = readAppleEnv();
  if (config === null) return null;
  const key = [
    config.passTypeId,
    config.teamId,
    config.signerCertPem,
    config.signerKeyPem,
    config.wwdrCertPem,
  ].join("\u0000");
  if (appleMemo === null || appleMemo.key !== key) {
    appleMemo = { key, facts: inspectAppleFacts(config) };
  }
  const report = evaluateDates(appleMemo.facts, nowMs);
  logOnce("apple", report);
  return report.problems.length === 0 ? config : null;
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

/** Konfiguracja Google z kluczem, który daje się odczytać, albo `null`. */
export function googleWalletConfig(): GoogleWalletConfig | null {
  const issuerId = firstEnv("GOOGLE_WALLET_ISSUER_ID");
  const serviceAccount = readServiceAccount(firstEnv("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON"));
  if (issuerId === undefined || !/^\d{6,25}$/.test(issuerId) || serviceAccount === null) {
    return null;
  }
  const config = { issuerId, serviceAccount };
  const key = [issuerId, serviceAccount.clientEmail, serviceAccount.privateKeyPem].join("\u0000");
  if (googleMemo === null || googleMemo.key !== key) {
    googleMemo = { key, report: inspectGoogleWalletConfig(config) };
  }
  logOnce("google", googleMemo.report);
  return googleMemo.report.problems.length === 0 ? config : null;
}

/** Które portfele są skonfigurowane - bez ujawniania czegokolwiek poza tym. */
export function walletAvailability(): { apple: boolean; google: boolean } {
  return { apple: appleWalletConfig() !== null, google: googleWalletConfig() !== null };
}
