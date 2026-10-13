// PEM i minimalny odczyt certyfikatu X.509 dla podpisu CMS przepustki.
//
// PODPIS POTRZEBUJE Z CERTYFIKATU DWÓCH RZECZY: `issuer` (Name wystawcy)
// i `serialNumber`. Razem tworzą `IssuerAndSerialNumber` - identyfikator
// podpisującego w `SignerInfo` (RFC 5652 §5.3). Oba pola kopiujemy BAJT
// W BAJT z certyfikatu (pełne TLV), bo weryfikator porównuje je z certyfikatem
// na poziomie kodowania: ponowne złożenie Name z rozbioru mogłoby zmienić typ
// napisu (UTF8String -> PrintableString) i podpis przestałby pasować.
//
// Nic tu nie waliduje łańcucha zaufania - to robi Apple po swojej stronie.
// `readCertificateDetails` oddaje natomiast to, czego potrzebuje KONTROLA
// KONFIGURACJI (`walletConfig.server.ts`): daty ważności, podmiot (UID = Pass
// Type ID, OU = Team ID) i klucz publiczny RSA, żeby porównać go z kluczem
// prywatnym. Bez tej kontroli wygasły certyfikat albo klucz z innej pary
// dawały przepustkę, którą iOS po cichu odrzuca przy każdym „Dodaj".
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero sieci. Liść nad `der.ts`.
import {
  DER_TAG,
  type DerNode,
  derChildren,
  derContent,
  derSlice,
  readDer,
  readDirectoryString,
  readOid,
  readTime,
  readUnsignedInteger,
} from "./der";

const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;

/** Blok PEM: etykieta (np. `CERTIFICATE`) i zdekodowane bajty DER. */
export interface PemBlock {
  readonly label: string;
  readonly der: Uint8Array;
}

function base64ToBytes(body: string): Uint8Array {
  const compact = body.replace(/\s+/g, "");
  if (compact === "" || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new Error("pem: invalid base64 body");
  }
  const binary = atob(compact);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Wszystkie bloki PEM z napisu, w kolejności wystąpienia. */
export function readPemBlocks(pem: string): PemBlock[] {
  const blocks: PemBlock[] = [];
  for (const match of pem.matchAll(PEM_BLOCK)) {
    blocks.push({ label: match[1], der: base64ToBytes(match[2]) });
  }
  return blocks;
}

/** Pierwszy blok o jednej z podanych etykiet; rzuca, gdy żadnego nie ma. */
export function pemBlock(pem: string, labels: readonly string[]): PemBlock {
  const found = readPemBlocks(pem).find((block) => labels.includes(block.label));
  if (found === undefined) throw new Error(`pem: no ${labels.join("/")} block`);
  return found;
}

/** Certyfikat X.509 w zakresie potrzebnym do `IssuerAndSerialNumber`. */
export interface ParsedCertificate {
  /** Pełny DER certyfikatu (do pola `certificates` SignedData). */
  readonly der: Uint8Array;
  /** Pełny TLV `issuer` (Name). */
  readonly issuer: Uint8Array;
  /** Pełny TLV `serialNumber` (INTEGER). */
  readonly serialNumber: Uint8Array;
}

/** Rozbiór DER certyfikatu; rzuca na strukturze, która certyfikatem nie jest. */
export function parseCertificate(der: Uint8Array): ParsedCertificate {
  const root = readDer(der);
  if (root.tag !== DER_TAG.sequence || root.end !== der.length) {
    throw new Error("x509: certificate must be a single DER SEQUENCE");
  }
  const [tbs] = derChildren(der, root);
  if (tbs === undefined || tbs.tag !== DER_TAG.sequence) {
    throw new Error("x509: missing tbsCertificate");
  }
  const fields = derChildren(der, tbs);
  // `[0] EXPLICIT version` jest opcjonalne (brak = v1).
  const rest = fields[0]?.tag === 0xa0 ? fields.slice(1) : fields;
  const [serial, , issuer] = rest;
  if (serial?.tag !== DER_TAG.integer || issuer?.tag !== DER_TAG.sequence) {
    throw new Error("x509: malformed tbsCertificate");
  }
  return { der, issuer: derSlice(der, issuer), serialNumber: derSlice(der, serial) };
}

/** Certyfikat z PEM (`-----BEGIN CERTIFICATE-----`). */
export function parseCertificatePem(pem: string): ParsedCertificate {
  return parseCertificate(pemBlock(pem, ["CERTIFICATE"]).der);
}

// ── Szczegóły certyfikatu pod kontrolę konfiguracji ───────────────────────

/** OID-y atrybutów nazwy i algorytmu klucza, które czyta kontrola konfiguracji. */
export const X509_OID = {
  commonName: "2.5.4.3",
  organizationalUnit: "2.5.4.11",
  userId: "0.9.2342.19200300.100.1.1",
  rsaEncryption: "1.2.840.113549.1.1.1",
} as const;

/** Klucz publiczny RSA: moduł i wykładnik jako bajty big-endian bez wiodących zer. */
export interface RsaPublicKeyParts {
  readonly modulus: Uint8Array;
  readonly exponent: Uint8Array;
}

export interface CertificateDetails {
  /** Numer seryjny szesnastkowo (bez wiodących zer) - do logu, jest jawny. */
  readonly serialHex: string;
  /** Pełny TLV wystawcy i podmiotu (Name). */
  readonly issuer: Uint8Array;
  readonly subject: Uint8Array;
  readonly notBefore: Date;
  readonly notAfter: Date;
  /** OID algorytmu klucza publicznego. */
  readonly publicKeyAlgorithm: string;
  /** Klucz RSA albo `null`, gdy certyfikat niesie klucz innego rodzaju. */
  readonly rsaPublicKey: RsaPublicKeyParts | null;
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** `SubjectPublicKeyInfo` -> OID algorytmu i (dla RSA) moduł z wykładnikiem. */
function readSpki(
  der: Uint8Array,
  spki: DerNode,
): { algorithm: string; rsa: RsaPublicKeyParts | null } {
  const [algorithm, bits] = derChildren(der, spki);
  if (algorithm?.tag !== DER_TAG.sequence || bits?.tag !== DER_TAG.bitString) {
    throw new Error("x509: malformed subjectPublicKeyInfo");
  }
  const [oid] = derChildren(der, algorithm);
  if (oid === undefined) throw new Error("x509: malformed subjectPublicKeyInfo");
  const algorithmOid = readOid(der, oid);
  if (algorithmOid !== X509_OID.rsaEncryption) return { algorithm: algorithmOid, rsa: null };
  const content = derContent(der, bits);
  // Pierwszy bajt BIT STRING = liczba nieużytych bitów; klucz RSA ma ich zero.
  if (content[0] !== 0) throw new Error("x509: malformed RSA public key");
  const key = content.slice(1);
  const root = readDer(key);
  if (root.tag !== DER_TAG.sequence || root.end !== key.length) {
    throw new Error("x509: malformed RSA public key");
  }
  const [modulus, exponent] = derChildren(key, root);
  if (modulus === undefined || exponent === undefined) {
    throw new Error("x509: malformed RSA public key");
  }
  return {
    algorithm: algorithmOid,
    rsa: {
      modulus: readUnsignedInteger(key, modulus),
      exponent: readUnsignedInteger(key, exponent),
    },
  };
}

/**
 * Pełny rozbiór `tbsCertificate` (v3: version, serial, signature, issuer,
 * validity, subject, subjectPublicKeyInfo, ...). Rzuca na strukturze, która
 * nie jest certyfikatem z kompletem tych pól.
 */
export function readCertificateDetails(der: Uint8Array): CertificateDetails {
  const root = readDer(der);
  if (root.tag !== DER_TAG.sequence || root.end !== der.length) {
    throw new Error("x509: certificate must be a single DER SEQUENCE");
  }
  const [tbs] = derChildren(der, root);
  if (tbs === undefined || tbs.tag !== DER_TAG.sequence) {
    throw new Error("x509: missing tbsCertificate");
  }
  const fields = derChildren(der, tbs);
  const rest = fields[0]?.tag === 0xa0 ? fields.slice(1) : fields;
  const [serial, , issuer, validity, subject, spki] = rest;
  if (
    serial?.tag !== DER_TAG.integer ||
    issuer?.tag !== DER_TAG.sequence ||
    validity?.tag !== DER_TAG.sequence ||
    subject?.tag !== DER_TAG.sequence ||
    spki?.tag !== DER_TAG.sequence
  ) {
    throw new Error("x509: malformed tbsCertificate");
  }
  const [notBefore, notAfter] = derChildren(der, validity);
  if (notBefore === undefined || notAfter === undefined) {
    throw new Error("x509: malformed validity");
  }
  const key = readSpki(der, spki);
  const serialBytes = derContent(der, serial);
  let first = 0;
  while (first < serialBytes.length - 1 && serialBytes[first] === 0) first += 1;
  return {
    serialHex: hex(serialBytes.slice(first)),
    issuer: derSlice(der, issuer),
    subject: derSlice(der, subject),
    notBefore: readTime(der, notBefore),
    notAfter: readTime(der, notAfter),
    publicKeyAlgorithm: key.algorithm,
    rsaPublicKey: key.rsa,
  };
}

/**
 * Pierwsza wartość atrybutu `oid` w nazwie X.500 (pełny TLV `Name`) albo
 * `null`. Nieczytelny napis atrybutu też daje `null` - kontrola konfiguracji
 * pomija wtedy porównanie zamiast odrzucać certyfikat.
 */
export function nameAttribute(name: Uint8Array, oid: string): string | null {
  const root = readDer(name);
  if (root.tag !== DER_TAG.sequence) throw new Error("x509: name must be a SEQUENCE");
  for (const rdn of derChildren(name, root)) {
    if (rdn.tag !== DER_TAG.set) throw new Error("x509: malformed name");
    for (const pair of derChildren(name, rdn)) {
      const [type, value] = derChildren(name, pair);
      if (type === undefined || value === undefined) throw new Error("x509: malformed name");
      if (readOid(name, type) !== oid) continue;
      try {
        return readDirectoryString(name, value);
      } catch {
        return null;
      }
    }
  }
  return null;
}
