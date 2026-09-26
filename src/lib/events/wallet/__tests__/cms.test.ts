// @vitest-environment node
// Odłączony podpis CMS (`signature` przepustki Apple Wallet) i klucz RSA.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Wallet sprawdza podpis
// `manifest.json` i w razie błędu po prostu nie dodaje przepustki - bez
// komunikatu dla uczestnika i bez śladu po naszej stronie. Testy dowodzą
// podpisu NIEZALEŻNIE od kodera: weryfikują go kluczem publicznym przez
// WebCrypto na bajtach atrybutów wyjętych z gotowej struktury, porównują
// skrót treści, identyfikator podpisującego i zbiór certyfikatów, a jeśli na
// maszynie jest `openssl` - każą mu zweryfikować podpis razem z łańcuchem.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CMS_OID, signDetachedCms, signedAttributes } from "../cms";
import {
  derChildren,
  derOid,
  derSequence,
  derSlice,
  derSortedSetContent,
  readDer,
  type DerNode,
} from "../der";
import {
  importRsaSigningKey,
  sha1Hex,
  sha256,
  signRsaSha256,
  toHex,
  wrapPkcs1PrivateKey,
} from "../rsa";
import { parseCertificatePem, pemBlock } from "../x509";
import {
  TEST_SIGNER_CERT_PEM,
  TEST_SIGNER_KEY_PKCS1_PEM,
  TEST_SIGNER_KEY_PKCS8_PEM,
  TEST_SIGNER_PUBLIC_KEY_PEM,
  TEST_WWDR_CERT_PEM,
} from "@/test/fixtures/walletTestPki";

const CONTENT = new TextEncoder().encode('{"pass.json":"0123","icon.png":"abcd"}');
const SIGNED_AT = new Date("2026-09-26T08:00:00Z");

/** WebCrypto przyjmuje wyłącznie widok na zwykły `ArrayBuffer`. */
function verify(signature: Uint8Array, data: Uint8Array, key: CryptoKey): Promise<boolean> {
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    new Uint8Array(signature),
    new Uint8Array(data),
  );
}

async function publicKey(): Promise<CryptoKey> {
  const spki = pemBlock(TEST_SIGNER_PUBLIC_KEY_PEM, ["PUBLIC KEY"]).der;
  return crypto.subtle.importKey(
    "spki",
    new Uint8Array(spki),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

function kids(bytes: Uint8Array, node: DerNode): DerNode[] {
  return derChildren(bytes, node);
}

/** Rozbiór podpisu do pól, które sprawdza weryfikator. */
function dissect(sig: Uint8Array) {
  const root = readDer(sig);
  const [contentType, explicit] = kids(sig, root);
  const [signedData] = kids(sig, explicit);
  const [version, digestAlgs, encap, certs, signerInfos] = kids(sig, signedData);
  const [signerInfo] = kids(sig, signerInfos);
  const [siVersion, sid, digestAlg, attrs, sigAlg, signature] = kids(sig, signerInfo);
  return {
    contentType: derSlice(sig, contentType),
    version: derSlice(sig, version),
    digestAlgs: derSlice(sig, digestAlgs),
    encap: derSlice(sig, encap),
    certs: kids(sig, certs).map((cert) => derSlice(sig, cert)),
    certsTag: certs.tag,
    siVersion: derSlice(sig, siVersion),
    sid: derSlice(sig, sid),
    digestAlg: derSlice(sig, digestAlg),
    attrsTag: attrs.tag,
    attrs: kids(sig, attrs).map((attr) => {
      const [oid, values] = kids(sig, attr);
      return { oid: derSlice(sig, oid), value: derSlice(sig, kids(sig, values)[0]) };
    }),
    attrsSetBytes: Uint8Array.of(0x31, ...sig.slice(attrs.start + 1, attrs.end)),
    sigAlg: derSlice(sig, sigAlg),
    signature: sig.slice(signature.contentStart, signature.end),
  };
}

describe("rsa", () => {
  it("PKCS#1 opakowany w PKCS#8 daje ten sam klucz co eksport PKCS#8 openssl", () => {
    const pkcs1 = pemBlock(TEST_SIGNER_KEY_PKCS1_PEM, ["RSA PRIVATE KEY"]).der;
    const pkcs8 = pemBlock(TEST_SIGNER_KEY_PKCS8_PEM, ["PRIVATE KEY"]).der;
    expect(toHex(wrapPkcs1PrivateKey(pkcs1))).toBe(toHex(pkcs8));
  });

  it("podpis RS256 obu formatów klucza weryfikuje się kluczem publicznym", async () => {
    const data = new TextEncoder().encode("dane");
    for (const pem of [TEST_SIGNER_KEY_PKCS8_PEM, TEST_SIGNER_KEY_PKCS1_PEM]) {
      const signature = await signRsaSha256(await importRsaSigningKey(pem), data);
      expect(signature).toHaveLength(256);
      await expect(verify(signature, data, await publicKey())).resolves.toBe(true);
    }
  });

  it("odrzuca PEM bez klucza prywatnego", async () => {
    await expect(importRsaSigningKey(TEST_SIGNER_CERT_PEM)).rejects.toThrow("no PRIVATE KEY");
  });

  it("skróty SHA-256 i SHA-1 (wektory dla „abc”)", async () => {
    const abc = new TextEncoder().encode("abc");
    expect(toHex(await sha256(abc))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha1Hex(abc)).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });
});

describe("signDetachedCms", () => {
  it("składa SignedData z podpisem weryfikowalnym kluczem publicznym", async () => {
    const sig = await signDetachedCms({
      content: CONTENT,
      signerCertPem: TEST_SIGNER_CERT_PEM,
      signerKeyPem: TEST_SIGNER_KEY_PKCS8_PEM,
      chainPems: [TEST_WWDR_CERT_PEM],
      signingTime: SIGNED_AT,
    });
    const d = dissect(sig);

    expect(d.contentType).toEqual(derOid(CMS_OID.signedData));
    expect(toHex(d.version)).toBe("020101");
    expect(toHex(d.digestAlgs)).toBe("310f300d06096086480165030402010500");
    // Odłączony: encapContentInfo ma wyłącznie typ treści, bez eContent.
    expect(toHex(d.encap)).toBe("300b06092a864886f70d010701");
    expect(toHex(d.siVersion)).toBe("020101");
    expect(toHex(d.digestAlg)).toBe("300d06096086480165030402010500");
    expect(toHex(d.sigAlg)).toBe("300d06092a864886f70d0101010500");

    // Certyfikaty: [0] IMPLICIT, podpisujący i WWDR w kolejności łańcucha.
    const signer = parseCertificatePem(TEST_SIGNER_CERT_PEM);
    expect(d.certsTag).toBe(0xa0);
    expect(d.certs).toEqual([signer.der, parseCertificatePem(TEST_WWDR_CERT_PEM).der]);

    // Identyfikator podpisującego = wystawca + numer seryjny z certyfikatu.
    expect(d.sid).toEqual(derSequence(signer.issuer, signer.serialNumber));

    // Atrybuty podpisane: [0] IMPLICIT, porządek DER, skrót = sha256(treści).
    expect(d.attrsTag).toBe(0xa0);
    expect(d.attrs.map((attr) => attr.oid)).toEqual([
      derOid(CMS_OID.contentType),
      derOid(CMS_OID.signingTime),
      derOid(CMS_OID.messageDigest),
    ]);
    expect(d.attrs[0].value).toEqual(derOid(CMS_OID.data));
    expect(new TextDecoder().decode(d.attrs[1].value.slice(2))).toBe("260926080000Z");
    expect(toHex(d.attrs[2].value.slice(2))).toBe(toHex(await sha256(CONTENT)));

    // Podpis liczony z kodowania SET OF atrybutów (0x31), nie z [0].
    await expect(verify(d.signature, d.attrsSetBytes, await publicKey())).resolves.toBe(true);
    const tampered = Uint8Array.from(d.attrsSetBytes);
    tampered[tampered.length - 1] ^= 0xff;
    await expect(verify(d.signature, tampered, await publicKey())).resolves.toBe(false);
  });

  it("porządek atrybutów nie zależy od kolejności ich budowy (zbiór DER)", async () => {
    const built = signedAttributes(await sha256(CONTENT), new Date("2099-06-15T12:00:00Z"));
    // Zbiór DER daje ten sam ciąg bajtów niezależnie od kolejności wejścia.
    expect(toHex(derSortedSetContent([...built].reverse()))).toBe(
      toHex(derSortedSetContent(built)),
    );
    const sig = await signDetachedCms({
      content: CONTENT,
      signerCertPem: TEST_SIGNER_CERT_PEM,
      signerKeyPem: TEST_SIGNER_KEY_PKCS1_PEM,
      chainPems: [],
      signingTime: new Date("2099-06-15T12:00:00Z"),
    });
    const d = dissect(sig);
    // GeneralizedTime (0x18) jest dłuższy od UTCTime, a porządek zostaje ten sam.
    expect(d.attrs[1].value[0]).toBe(0x18);
    expect(d.attrs.map((attr) => toHex(attr.oid))).toEqual([
      toHex(derOid(CMS_OID.contentType)),
      toHex(derOid(CMS_OID.signingTime)),
      toHex(derOid(CMS_OID.messageDigest)),
    ]);
    expect(d.certs).toHaveLength(1);
  });

  const hasOpenssl = (() => {
    try {
      execFileSync("openssl", ["version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasOpenssl)("openssl weryfikuje podpis razem z łańcuchem do TEST CA", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wallet-cms-"));
    try {
      const sig = await signDetachedCms({
        content: CONTENT,
        signerCertPem: TEST_SIGNER_CERT_PEM,
        signerKeyPem: TEST_SIGNER_KEY_PKCS8_PEM,
        chainPems: [TEST_WWDR_CERT_PEM],
        signingTime: SIGNED_AT,
      });
      writeFileSync(join(dir, "signature"), sig);
      writeFileSync(join(dir, "manifest.json"), CONTENT);
      writeFileSync(join(dir, "ca.pem"), TEST_WWDR_CERT_PEM);
      const out = execFileSync(
        "openssl",
        [
          "cms",
          "-verify",
          "-binary",
          "-inform",
          "DER",
          "-in",
          join(dir, "signature"),
          "-content",
          join(dir, "manifest.json"),
          "-CAfile",
          join(dir, "ca.pem"),
          "-purpose",
          "any",
          "-out",
          join(dir, "verified"),
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(out).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
