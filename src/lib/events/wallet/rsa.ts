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
// KLUCZ IMPORTOWANY RAZ NA IZOLAT. `importKey` to parsowanie ASN.1 i rozkład
// klucza po stronie silnika - przy każdym „Dodaj do portfela" (JWT konta
// usługi, podpis CMS) robiliśmy to od nowa. Pamięć podręczna trzyma OBIETNICĘ
// importu (równoległe żądania nie importują podwójnie), po PEM, z sufitem kilku
// wpisów (w praktyce dwa: klucz Apple i klucz konta usługi Google). Nieudany
// import znika z pamięci, więc poprawiony sekret działa bez restartu izolatu.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero sieci.
import {
  DER_TAG,
  derChildren,
  derContent,
  derNull,
  derOctetString,
  derOid,
  derSequence,
  derSmallInteger,
  readDer,
  readOid,
  readUnsignedInteger,
} from "./der";
import { pemBlock, type RsaPublicKeyParts } from "./x509";

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

async function importUncached(pem: string): Promise<CryptoKey> {
  const block = pemBlock(pem, ["PRIVATE KEY", "RSA PRIVATE KEY"]);
  const pkcs8 = block.label === "RSA PRIVATE KEY" ? wrapPkcs1PrivateKey(block.der) : block.der;
  return crypto.subtle.importKey("pkcs8", toBufferSource(pkcs8), RSA_SHA256, false, ["sign"]);
}

/** Sufit pamięci podręcznej kluczy (najstarszy wpis wypada pierwszy). */
const KEY_CACHE_LIMIT = 4;
const keyCache = new Map<string, Promise<CryptoKey>>();

/**
 * Klucz prywatny RSA z PEM (PKCS#8 albo PKCS#1) gotowy do podpisu RS256.
 * Importowany raz na izolat i PEM (patrz nagłówek).
 */
export function importRsaSigningKey(pem: string): Promise<CryptoKey> {
  const cached = keyCache.get(pem);
  if (cached !== undefined) return cached;
  const pending = importUncached(pem);
  keyCache.set(pem, pending);
  if (keyCache.size > KEY_CACHE_LIMIT) {
    const oldest = keyCache.keys().next().value;
    if (oldest !== undefined) keyCache.delete(oldest);
  }
  pending.catch(() => {
    if (keyCache.get(pem) === pending) keyCache.delete(pem);
  });
  return pending;
}

/**
 * Moduł i wykładnik publiczny z klucza prywatnego RSA w PEM (PKCS#8 albo
 * PKCS#1) - bez WebCrypto, synchronicznie, żeby kontrola konfiguracji mogła
 * porównać klucz z certyfikatem w zwykłym odczycie konfiguracji. Rzuca na
 * kluczu, który nie jest kluczem RSA; komunikat nie niesie bajtów klucza.
 */
export function readRsaPrivateKeyParts(pem: string): RsaPublicKeyParts {
  const block = pemBlock(pem, ["PRIVATE KEY", "RSA PRIVATE KEY"]);
  let pkcs1 = block.der;
  if (block.label === "PRIVATE KEY") {
    // PrivateKeyInfo ::= SEQUENCE { version, AlgorithmIdentifier, OCTET STRING }
    const root = readDer(block.der);
    const [version, algorithm, key] = derChildren(block.der, root);
    if (
      root.tag !== DER_TAG.sequence ||
      version?.tag !== DER_TAG.integer ||
      algorithm?.tag !== DER_TAG.sequence ||
      key?.tag !== DER_TAG.octetString
    ) {
      throw new Error("rsa: malformed PKCS#8 private key");
    }
    const [oid] = derChildren(block.der, algorithm);
    if (oid === undefined || readOid(block.der, oid) !== RSA_ENCRYPTION_OID) {
      throw new Error("rsa: private key is not an RSA key");
    }
    pkcs1 = derContent(block.der, key);
  }
  // RSAPrivateKey ::= SEQUENCE { version, modulus, publicExponent, ... }
  const root = readDer(pkcs1);
  if (root.tag !== DER_TAG.sequence) throw new Error("rsa: malformed RSA private key");
  const [version, modulus, exponent] = derChildren(pkcs1, root);
  if (version?.tag !== DER_TAG.integer || modulus === undefined || exponent === undefined) {
    throw new Error("rsa: malformed RSA private key");
  }
  return {
    modulus: readUnsignedInteger(pkcs1, modulus),
    exponent: readUnsignedInteger(pkcs1, exponent),
  };
}

/** Czy dwa klucze publiczne RSA są tym samym kluczem (moduł i wykładnik). */
export function sameRsaPublicKey(a: RsaPublicKeyParts, b: RsaPublicKeyParts): boolean {
  const equal = (x: Uint8Array, y: Uint8Array) =>
    x.length === y.length && x.every((byte, i) => byte === y[i]);
  return equal(a.modulus, b.modulus) && equal(a.exponent, b.exponent);
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
