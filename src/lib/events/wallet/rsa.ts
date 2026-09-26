// Klucz RSA i skróty przez WebCrypto - wspólne dla podpisu przepustki Apple
// (CMS, RSASSA-PKCS1-v1_5 z SHA-256) i dla JWT konta usługi Google (RS256).
//
// DLACZEGO WEBCRYPTO, A NIE `node:crypto`. `crypto.subtle` jest natywne
// w Cloudflare Workers i w Node, a ten moduł ma być importowalny także
// z testów w środowisku `node` bez podmiany modułów wbudowanych. Jedna ścieżka
// podpisu dla obu portfeli = jeden zestaw testów weryfikujących podpis.
//
// KLUCZ: PKCS#8 (`BEGIN PRIVATE KEY`, tak eksportuje go `openssl pkcs12
// -nodes` i tak wygląda `private_key` konta usługi Google) albo PKCS#1
// (`BEGIN RSA PRIVATE KEY`, starszy eksport `openssl rsa -traditional`).
// PKCS#1 opakowujemy w PKCS#8 tu, bo WebCrypto importuje wyłącznie PKCS#8.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero sieci.
import { derNull, derOctetString, derOid, derSequence, derSmallInteger } from "./der";
import { pemBlock } from "./x509";

const RSA_ENCRYPTION_OID = "1.2.840.113549.1.1.1";
const RSA_SHA256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** Kopia do świeżego `ArrayBuffer` - WebCrypto nie przyjmuje widoku na `SharedArrayBuffer`. */
function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

/** PKCS#1 RSAPrivateKey -> PKCS#8 PrivateKeyInfo (RFC 5208). */
export function wrapPkcs1PrivateKey(pkcs1: Uint8Array): Uint8Array {
  return derSequence(
    derSmallInteger(0),
    derSequence(derOid(RSA_ENCRYPTION_OID), derNull()),
    derOctetString(pkcs1),
  );
}

/** Klucz prywatny RSA z PEM (PKCS#8 albo PKCS#1) gotowy do podpisu RS256. */
export async function importRsaSigningKey(pem: string): Promise<CryptoKey> {
  const block = pemBlock(pem, ["PRIVATE KEY", "RSA PRIVATE KEY"]);
  const pkcs8 = block.label === "RSA PRIVATE KEY" ? wrapPkcs1PrivateKey(block.der) : block.der;
  return crypto.subtle.importKey("pkcs8", toBufferSource(pkcs8), RSA_SHA256, false, ["sign"]);
}

/** Podpis RSASSA-PKCS1-v1_5 z SHA-256 (RS256). */
export async function signRsaSha256(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign(RSA_SHA256.name, key, toBufferSource(data));
  return new Uint8Array(signature);
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", toBufferSource(data)));
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** SHA-1 w zapisie szesnastkowym - wymóg formatu `manifest.json` przepustki Apple. */
export async function sha1Hex(data: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-1", toBufferSource(data))));
}
