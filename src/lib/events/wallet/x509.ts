// PEM i minimalny odczyt certyfikatu X.509 dla podpisu CMS przepustki.
//
// PODPIS POTRZEBUJE Z CERTYFIKATU DWÓCH RZECZY: `issuer` (Name wystawcy)
// i `serialNumber`. Razem tworzą `IssuerAndSerialNumber` - identyfikator
// podpisującego w `SignerInfo` (RFC 5652 §5.3). Oba pola kopiujemy BAJT
// W BAJT z certyfikatu (pełne TLV), bo weryfikator porównuje je z certyfikatem
// na poziomie kodowania: ponowne złożenie Name z rozbioru mogłoby zmienić typ
// napisu (UTF8String -> PrintableString) i podpis przestałby pasować.
//
// Nic tu nie waliduje łańcucha zaufania ani dat - to robi Apple po swojej
// stronie. Moduł odrzuca tylko strukturę, która certyfikatem nie jest.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero sieci. Liść nad `der.ts`.
import { DER_TAG, derChildren, derSlice, readDer } from "./der";

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
