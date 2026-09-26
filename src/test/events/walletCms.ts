// Weryfikacja podpisu CMS przepustki w testach - NIEZALEŻNIE od kodera:
// wyjmuje z gotowej struktury atrybuty podpisane i podpis, a sprawdza je
// kluczem publicznym TESTOWEGO podpisującego przez WebCrypto.
import { derChildren, derSlice, readDer } from "@/lib/events/wallet/der";
import { pemBlock } from "@/lib/events/wallet/x509";
import { TEST_SIGNER_PUBLIC_KEY_PEM } from "@/test/fixtures/walletTestPki";

/** Skrót treści z atrybutu `messageDigest` i wynik weryfikacji podpisu. */
export async function verifyTestCmsSignature(
  signature: Uint8Array,
): Promise<{ valid: boolean; messageDigest: Uint8Array; certificates: number }> {
  const root = readDer(signature);
  const [, explicit] = derChildren(signature, root);
  const [signedData] = derChildren(signature, explicit);
  const fields = derChildren(signature, signedData);
  const certificates = derChildren(signature, fields[3]).length;
  const [signerInfo] = derChildren(signature, fields[4]);
  const info = derChildren(signature, signerInfo);
  const attrs = info[3];
  const setBytes = Uint8Array.of(0x31, ...signature.slice(attrs.start + 1, attrs.end));
  const digestAttr = derChildren(signature, attrs)[2];
  const [, values] = derChildren(signature, digestAttr);
  const digest = derSlice(signature, derChildren(signature, values)[0]).slice(2);
  const sig = signature.slice(info[5].contentStart, info[5].end);
  const key = await crypto.subtle.importKey(
    "spki",
    new Uint8Array(pemBlock(TEST_SIGNER_PUBLIC_KEY_PEM, ["PUBLIC KEY"]).der),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, setBytes);
  return { valid, messageDigest: digest, certificates };
}
