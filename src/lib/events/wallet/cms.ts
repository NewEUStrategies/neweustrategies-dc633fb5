// Odłączony podpis CMS (PKCS#7 SignedData) - plik `signature` przepustki
// Apple Wallet.
//
// CO PODPISUJEMY. Apple wymaga podpisu `manifest.json` (skróty SHA-1 każdego
// pliku paczki) certyfikatem Pass Type ID, z pośrednim certyfikatem Apple WWDR
// w zbiorze `certificates`. Podpis jest ODŁĄCZONY: `encapContentInfo` nie niesie
// treści, weryfikator bierze `manifest.json` z paczki.
//
// KSZTAŁT (RFC 5652), jak w sprawdzonych generatorach przepustek:
//   ContentInfo { signedData, [0] SignedData {
//     version 1, digestAlgorithms { sha256 }, encapContentInfo { data },
//     [0] certificates { podpisujący, WWDR }, signerInfos { SignerInfo {
//       version 1, IssuerAndSerialNumber, sha256,
//       [0] signedAttrs { contentType, signingTime, messageDigest },
//       rsaEncryption, podpis } } } }
//
// ATRYBUTY PODPISANE SĄ ZBIOREM DER. Podpis liczy się z kodowania `SET OF`
// (znacznik 0x31), a w strukturze ten sam ciąg bajtów stoi pod `[0] IMPLICIT`.
// Porządek elementów jest kanoniczny (rosnąco wg kodowania) - weryfikator
// sprawdza podpis na bajtach, które dostał, więc ta sama kolejność musi być
// i tu, i tam; `derSortedSetContent` daje ją raz dla obu miejsc.
//
// Parametry algorytmów to jawny NULL - tak koduje je `node-forge`, którego
// podpisy Wallet przyjmuje od lat, a RFC 5754 każe NULL akceptować.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero sieci.
import {
  concatBytes,
  derContext,
  derNull,
  derOctetString,
  derOid,
  derSequence,
  derSet,
  derSmallInteger,
  derSortedSetContent,
  derTime,
  derTlv,
  DER_TAG,
} from "./der";
import { importRsaSigningKey, sha256, signRsaSha256 } from "./rsa";
import { parseCertificatePem } from "./x509";

export const CMS_OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  sha256: "2.16.840.1.101.3.4.2.1",
  rsaEncryption: "1.2.840.113549.1.1.1",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
} as const;

export interface DetachedCmsInput {
  /** Podpisywana treść (bajty `manifest.json`). */
  readonly content: Uint8Array;
  /** Certyfikat podpisującego (Pass Type ID) w PEM. */
  readonly signerCertPem: string;
  /** Klucz prywatny podpisującego (PKCS#8 albo PKCS#1) w PEM. */
  readonly signerKeyPem: string;
  /** Certyfikaty pośrednie (Apple WWDR) w PEM, w kolejności łańcucha. */
  readonly chainPems: readonly string[];
  /** Chwila podpisu (atrybut `signingTime`). */
  readonly signingTime: Date;
}

function algorithm(oid: string): Uint8Array {
  return derSequence(derOid(oid), derNull());
}

function attribute(oid: string, value: Uint8Array): Uint8Array {
  return derSequence(derOid(oid), derSet([value]));
}

/** Atrybuty podpisane (kolejność wejściowa - porządek DER nadaje zbiór). */
export function signedAttributes(contentDigest: Uint8Array, signingTime: Date): Uint8Array[] {
  return [
    attribute(CMS_OID.contentType, derOid(CMS_OID.data)),
    attribute(CMS_OID.signingTime, derTime(signingTime)),
    attribute(CMS_OID.messageDigest, derOctetString(contentDigest)),
  ];
}

/** Podpis odłączony w DER (zawartość pliku `signature` przepustki). */
export async function signDetachedCms(input: DetachedCmsInput): Promise<Uint8Array> {
  const signer = parseCertificatePem(input.signerCertPem);
  const chain = input.chainPems.map(parseCertificatePem);
  const key = await importRsaSigningKey(input.signerKeyPem);

  const attrsContent = derSortedSetContent(
    signedAttributes(await sha256(input.content), input.signingTime),
  );
  // Podpis z kodowania SET OF (0x31), nie z `[0] IMPLICIT` (0xA0).
  const signature = await signRsaSha256(key, derTlv(DER_TAG.set, attrsContent));

  const signerInfo = derSequence(
    derSmallInteger(1),
    derSequence(signer.issuer, signer.serialNumber),
    algorithm(CMS_OID.sha256),
    derContext(0, attrsContent),
    algorithm(CMS_OID.rsaEncryption),
    derOctetString(signature),
  );

  const signedData = derSequence(
    derSmallInteger(1),
    derSet([algorithm(CMS_OID.sha256)]),
    derSequence(derOid(CMS_OID.data)),
    derContext(0, concatBytes(signer.der, ...chain.map((cert) => cert.der))),
    derSet([signerInfo]),
  );

  return derSequence(derOid(CMS_OID.signedData), derContext(0, signedData));
}
