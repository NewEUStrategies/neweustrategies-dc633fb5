// @vitest-environment node
// Konfiguracja portfeli z sekretów środowiska.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Konfiguracja „prawie pełna”
// (literówka w identyfikatorze zespołu, PEM wklejony w jednej linii bez
// normalizacji `\n`) włączałaby przycisk portfela, który za każdym kliknięciem
// kończy się błędem serwera. Brak albo zły kształt ma dawać `null` - przycisk
// znika, a trasa odpowiada 503.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appleWalletConfig,
  googleWalletConfig,
  normalizePem,
  walletAvailability,
} from "../walletConfig.server";
import {
  TEST_SIGNER_CERT_PEM,
  TEST_SIGNER_KEY_PKCS8_PEM,
  TEST_WWDR_CERT_PEM,
} from "@/test/fixtures/walletTestPki";

const oneLine = (pem: string) => pem.replace(/\n/g, "\\n");

function stubApple(overrides: Record<string, string> = {}) {
  const env = {
    APPLE_WALLET_PASS_TYPE_ID: "pass.org.example.test",
    APPLE_WALLET_TEAM_ID: "TESTTEAM01",
    APPLE_WALLET_SIGNER_CERT_PEM: oneLine(TEST_SIGNER_CERT_PEM),
    APPLE_WALLET_SIGNER_KEY_PEM: TEST_SIGNER_KEY_PKCS8_PEM,
    APPLE_WALLET_WWDR_CERT_PEM: oneLine(TEST_WWDR_CERT_PEM),
    ...overrides,
  };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

function stubGoogle(account: unknown, issuer = "3388000000000000000") {
  vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", issuer);
  vi.stubEnv(
    "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON",
    typeof account === "string" ? account : JSON.stringify(account),
  );
}

const ACCOUNT = {
  client_email: "wallet@example-project.iam.gserviceaccount.com",
  private_key: TEST_SIGNER_KEY_PKCS8_PEM,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("normalizePem", () => {
  it("zamienia literalne \\n na końce linii i odrzuca napis bez bloku PEM", () => {
    expect(normalizePem(oneLine(TEST_WWDR_CERT_PEM))).toBe(TEST_WWDR_CERT_PEM);
    expect(normalizePem(undefined)).toBeNull();
    expect(normalizePem("nie-pem")).toBeNull();
  });
});

describe("appleWalletConfig", () => {
  it("pełna konfiguracja -> obiekt z PEM-ami po normalizacji", () => {
    stubApple();
    expect(appleWalletConfig()).toEqual({
      passTypeId: "pass.org.example.test",
      teamId: "TESTTEAM01",
      signerCertPem: TEST_SIGNER_CERT_PEM,
      signerKeyPem: TEST_SIGNER_KEY_PKCS8_PEM,
      wwdrCertPem: TEST_WWDR_CERT_PEM,
    });
  });

  it.each([
    ["APPLE_WALLET_PASS_TYPE_ID", ""],
    ["APPLE_WALLET_PASS_TYPE_ID", "com.example.ticket"],
    ["APPLE_WALLET_TEAM_ID", ""],
    ["APPLE_WALLET_TEAM_ID", "team-1"],
    ["APPLE_WALLET_SIGNER_CERT_PEM", "x"],
    ["APPLE_WALLET_SIGNER_KEY_PEM", ""],
    ["APPLE_WALLET_WWDR_CERT_PEM", "   "],
  ])("brak albo zły kształt %s=%j -> null", (name, value) => {
    stubApple({ [name]: value });
    expect(appleWalletConfig()).toBeNull();
  });
});

describe("googleWalletConfig", () => {
  it("konto usługi z JSON-a; domyślny adres tokenu, klucz po normalizacji", () => {
    stubGoogle({ ...ACCOUNT, private_key: oneLine(TEST_SIGNER_KEY_PKCS8_PEM) });
    expect(googleWalletConfig()).toEqual({
      issuerId: "3388000000000000000",
      serviceAccount: {
        clientEmail: ACCOUNT.client_email,
        privateKeyPem: TEST_SIGNER_KEY_PKCS8_PEM,
        tokenUri: "https://oauth2.googleapis.com/token",
      },
    });
  });

  it("własny token_uri tylko po https", () => {
    stubGoogle({ ...ACCOUNT, token_uri: "https://oauth2.example.org/token" });
    expect(googleWalletConfig()?.serviceAccount.tokenUri).toBe("https://oauth2.example.org/token");
    stubGoogle({ ...ACCOUNT, token_uri: "http://oauth2.example.org/token" });
    expect(googleWalletConfig()?.serviceAccount.tokenUri).toBe(
      "https://oauth2.googleapis.com/token",
    );
  });

  it.each([
    ["zły JSON", "{nie-json", "3388000000000000000"],
    ["JSON nie-obiekt", "null", "3388000000000000000"],
    ["brak e-maila", { private_key: TEST_SIGNER_KEY_PKCS8_PEM }, "3388000000000000000"],
    ["e-mail bez @", { ...ACCOUNT, client_email: "wallet" }, "3388000000000000000"],
    ["klucz nie-napis", { ...ACCOUNT, private_key: 7 }, "3388000000000000000"],
    ["zły wystawca", ACCOUNT, "issuer-1"],
  ])("%s -> null", (_label, account, issuer) => {
    stubGoogle(account, issuer);
    expect(googleWalletConfig()).toBeNull();
  });

  it("brak zmiennych -> null", () => {
    vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", "");
    vi.stubEnv("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON", "");
    expect(googleWalletConfig()).toBeNull();
  });
});

describe("walletAvailability", () => {
  it("mówi wyłącznie, które portfele są włączone", () => {
    stubApple();
    vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", "");
    expect(walletAvailability()).toEqual({ apple: true, google: false });
    stubApple({ APPLE_WALLET_TEAM_ID: "" });
    stubGoogle(ACCOUNT);
    expect(walletAvailability()).toEqual({ apple: false, google: true });
  });
});
