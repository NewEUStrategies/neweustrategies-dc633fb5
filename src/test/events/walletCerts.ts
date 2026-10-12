// JEDNORAZOWE certyfikaty i klucze do testów kontroli konfiguracji portfeli.
//
// Generowane W TEŚCIE (WebCrypto) i nigdzie nie zapisywane - to nie są klucze
// ani certyfikaty Apple/Google. Pozwalają zbudować dokładnie ten przypadek,
// którego dotyczy test: certyfikat wygasły, jeszcze nieważny, z innym UID,
// wystawiony przez inny WWDR, z kluczem innej pary albo kluczem EC. Daty
// podaje test (względem zamrożonego „teraz"), więc nic tu nie zależy od zegara.
//
// Certyfikat jest PRAWDZIWIE podpisany kluczem wystawcy (sha256WithRSA), choć
// kontrola konfiguracji podpisu nie sprawdza - fixture ma wyglądać jak
// `openssl x509`, a nie jak atrapa, która przechodzi przez przypadek.
import {
  concatBytes,
  derContext,
  derNull,
  derOid,
  derSequence,
  derSet,
  derSmallInteger,
  derTime,
  derTlv,
  DER_TAG,
} from "@/lib/events/wallet/der";
import { X509_OID } from "@/lib/events/wallet/x509";

const SHA256_WITH_RSA = "1.2.840.113549.1.1.11";

/** DER -> PEM z łamaniem co 64 znaki (jak `openssl`). */
export function toPem(label: string, der: Uint8Array): string {
  let binary = "";
  for (const byte of der) binary += String.fromCharCode(byte);
  const body = btoa(binary)
    .replace(/(.{64})/g, "$1\n")
    .trimEnd();
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
}

export interface TestRsaKey {
  /** Klucz prywatny w PEM (PKCS#8). */
  readonly privateKeyPem: string;
  /** `SubjectPublicKeyInfo` w DER - do wstawienia w certyfikat. */
  readonly spki: Uint8Array;
  /** Klucz do podpisywania certyfikatów wystawianych przez ten klucz. */
  readonly signingKey: CryptoKey;
}

export async function generateTestRsaKey(): Promise<TestRsaKey> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: Uint8Array.of(1, 0, 1),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return { privateKeyPem: toPem("PRIVATE KEY", pkcs8), spki, signingKey: pair.privateKey };
}

/** Klucz publiczny EC P-256 (SPKI) - certyfikat z kluczem innym niż RSA. */
export async function generateTestEcSpki(): Promise<Uint8Array> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  return new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
}

/** Atrybut nazwy: OID i wartość (UTF8String). */
export type NameAttribute = readonly [oid: string, value: string];

function derName(attributes: readonly NameAttribute[]): Uint8Array {
  const encoder = new TextEncoder();
  return derSequence(
    ...attributes.map(([oid, value]) =>
      derSet([derSequence(derOid(oid), derTlv(DER_TAG.utf8String, encoder.encode(value)))]),
    ),
  );
}

export interface TestCertificateOptions {
  readonly subject: readonly NameAttribute[];
  readonly issuer: readonly NameAttribute[];
  readonly notBefore: Date;
  readonly notAfter: Date;
  /** Klucz publiczny podmiotu (SPKI). */
  readonly spki: Uint8Array;
  /** Klucz prywatny wystawcy. */
  readonly issuerKey: CryptoKey;
  readonly serial?: number;
}

/** Certyfikat X.509 v3 w PEM. */
export async function buildTestCertificatePem(options: TestCertificateOptions): Promise<string> {
  const algorithm = derSequence(derOid(SHA256_WITH_RSA), derNull());
  const tbs = derSequence(
    derContext(0, derSmallInteger(2)),
    derSmallInteger(options.serial ?? 4242),
    algorithm,
    derName(options.issuer),
    derSequence(derTime(options.notBefore), derTime(options.notAfter)),
    derName(options.subject),
    options.spki,
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", options.issuerKey, new Uint8Array(tbs)),
  );
  return toPem(
    "CERTIFICATE",
    derSequence(
      tbs,
      algorithm,
      derTlv(DER_TAG.bitString, concatBytes(Uint8Array.of(0), signature)),
    ),
  );
}

/** Nazwa podmiotu certyfikatu Pass Type ID w kształcie, który wydaje Apple. */
export function passTypeSubject(passTypeId: string, teamId: string): NameAttribute[] {
  return [
    [X509_OID.userId, passTypeId],
    [X509_OID.commonName, `Pass Type ID: ${passTypeId}`],
    [X509_OID.organizationalUnit, teamId],
  ];
}

/** Nazwa testowego WWDR (NIE Apple). */
export const TEST_WWDR_NAME: NameAttribute[] = [
  [X509_OID.commonName, "NES Wallet TEST WWDR - NOT APPLE"],
  [X509_OID.organizationalUnit, "G4"],
];
