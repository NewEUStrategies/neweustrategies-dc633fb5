// @vitest-environment node
// PEM i odczyt certyfikatu X.509 (wystawca + numer seryjny) pod podpis CMS.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. `IssuerAndSerialNumber` w podpisie
// musi być KOPIĄ bajtów z certyfikatu. Zgubione wiodące zero numeru seryjnego
// albo przesunięcie o pole `version` daje podpis poprawny kryptograficznie,
// którego Wallet nie przypisze do żadnego certyfikatu z paczki.
import { describe, expect, it } from "vitest";

import { derChildren, derNull, derOid, derSequence, derSmallInteger, readDer } from "../der";
import { toHex } from "../rsa";
import { parseCertificate, parseCertificatePem, pemBlock, readPemBlocks } from "../x509";
import {
  TEST_SIGNER_CERT_PEM,
  TEST_SIGNER_KEY_PKCS1_PEM,
  TEST_SIGNER_SERIAL_HEX,
  TEST_WWDR_CERT_PEM,
} from "@/test/fixtures/walletTestPki";

describe("readPemBlocks / pemBlock", () => {
  it("czyta kilka bloków w kolejności i dekoduje base64 z łamaniem linii", () => {
    const blocks = readPemBlocks(`${TEST_SIGNER_CERT_PEM}\n${TEST_WWDR_CERT_PEM}\n`);
    expect(blocks.map((block) => block.label)).toEqual(["CERTIFICATE", "CERTIFICATE"]);
    expect(blocks[0].der[0]).toBe(0x30);
    expect(readPemBlocks("bez PEM")).toEqual([]);
  });

  it("wybiera blok o żądanej etykiecie albo rzuca, gdy go brak", () => {
    expect(pemBlock(TEST_SIGNER_KEY_PKCS1_PEM, ["PRIVATE KEY", "RSA PRIVATE KEY"]).label).toBe(
      "RSA PRIVATE KEY",
    );
    expect(() => pemBlock(TEST_SIGNER_CERT_PEM, ["PRIVATE KEY"])).toThrow("no PRIVATE KEY block");
  });

  it("odrzuca pustą i niepoprawną treść base64", () => {
    expect(() => readPemBlocks("-----BEGIN X-----\n\n-----END X-----")).toThrow("invalid base64");
    expect(() => readPemBlocks("-----BEGIN X-----\n@@@@\n-----END X-----")).toThrow(
      "invalid base64",
    );
  });
});

describe("parseCertificate", () => {
  it("kopiuje numer seryjny RAZEM z wiodącym zerem i wystawcę z certyfikatu v3", () => {
    const cert = parseCertificatePem(TEST_SIGNER_CERT_PEM);
    expect(toHex(cert.serialNumber)).toBe(`0211 00${TEST_SIGNER_SERIAL_HEX}`.replace(/ /g, ""));
    // Wystawcą podpisującego jest TEST CA - Name wystawcy == Name podmiotu CA.
    const ca = parseCertificatePem(TEST_WWDR_CERT_PEM);
    const caTbs = derChildren(ca.der, derChildren(ca.der, readDer(ca.der))[0]);
    const caSubject = caTbs[5];
    expect(toHex(cert.issuer)).toBe(toHex(ca.der.slice(caSubject.start, caSubject.end)));
    expect(new TextDecoder().decode(cert.issuer)).toContain("NES Wallet TEST CA - NOT APPLE");
  });

  it("certyfikat v1 (bez pola version) też daje numer i wystawcę", () => {
    const issuer = derSequence(derOid("2.5.4.3"));
    const tbs = derSequence(
      derSmallInteger(7),
      derSequence(derOid("1.2.840.113549.1.1.11"), derNull()),
      issuer,
    );
    const cert = parseCertificate(derSequence(tbs));
    expect(toHex(cert.serialNumber)).toBe("020107");
    expect(cert.issuer).toEqual(issuer);
  });

  it("odrzuca strukturę, która certyfikatem nie jest", () => {
    expect(() => parseCertificate(derNull())).toThrow("single DER SEQUENCE");
    expect(() => parseCertificate(Uint8Array.of(0x30, 0x00, 0x00))).toThrow("single DER SEQUENCE");
    expect(() => parseCertificate(derSequence())).toThrow("missing tbsCertificate");
    expect(() => parseCertificate(derSequence(derNull()))).toThrow("missing tbsCertificate");
    expect(() => parseCertificate(derSequence(derSequence()))).toThrow("malformed");
    expect(() => parseCertificate(derSequence(derSequence(derSmallInteger(1))))).toThrow(
      "malformed",
    );
    expect(() =>
      parseCertificate(derSequence(derSequence(derSmallInteger(1), derNull(), derNull()))),
    ).toThrow("malformed");
  });
});
