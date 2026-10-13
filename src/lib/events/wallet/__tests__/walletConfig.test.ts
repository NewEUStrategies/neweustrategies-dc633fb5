// @vitest-environment node
// Konfiguracja portfeli z sekretów środowiska.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Konfiguracja „prawie pełna”
// (literówka w identyfikatorze zespołu, PEM wklejony w jednej linii bez
// normalizacji `\n`) włączałaby przycisk portfela, który za każdym kliknięciem
// kończy się błędem serwera. Brak albo zły kształt ma dawać `null` - przycisk
// znika, a trasa odpowiada 503.
//
// KONTROLA KONFIGURACJI (OPS-14). Kształt to za mało: klucz z innej pary niż
// certyfikat Pass Type ID, wygasły certyfikat albo zły WWDR dają paczkę, którą
// iOS po cichu odrzuca przy każdym „Dodaj". Taka konfiguracja ma dawać `null`
// (503 `not_configured`) i JEDNĄ czytelną linię logu bez sekretów. Certyfikaty
// i klucze przypadków brzegowych są generowane w teście (`walletCerts.ts`),
// daty liczone względem `FIXED_NOW` i podawane jawnie - bez zależności od zegara.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  appleWalletConfig,
  type AppleWalletConfig,
  CERT_EXPIRY_WARNING_DAYS,
  googleWalletConfig,
  inspectAppleWalletConfig,
  inspectGoogleWalletConfig,
  normalizePem,
  resetWalletConfigMemoForTests,
  walletAvailability,
} from "../walletConfig.server";
import {
  buildTestCertificatePem,
  generateTestEcSpki,
  generateTestRsaKey,
  passTypeSubject,
  TEST_WWDR_NAME,
  toPem,
  type TestRsaKey,
} from "@/test/events/walletCerts";
import {
  TEST_SIGNER_CERT_PEM,
  TEST_SIGNER_KEY_PKCS1_PEM,
  TEST_SIGNER_KEY_PKCS8_PEM,
  TEST_WWDR_CERT_PEM,
} from "@/test/fixtures/walletTestPki";
import { DZIEN, FIXED_NOW_MS, relativeDate } from "@/test/time";

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
  vi.restoreAllMocks();
  resetWalletConfigMemoForTests();
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

// ── Kontrola konfiguracji (OPS-14) ─────────────────────────────────────────

const PASS_TYPE_ID = "pass.org.example.test";
const TEAM_ID = "TESTTEAM01";
const NOW = FIXED_NOW_MS;

let wwdrKey: TestRsaKey;
let signerKey: TestRsaKey;
let otherKey: TestRsaKey;
let wwdrPem: string;
let signerPem: string;

interface SignerOptions {
  notBefore?: Date;
  notAfter?: Date;
  passTypeId?: string;
  teamId?: string;
  issuer?: readonly (readonly [string, string])[];
  spki?: Uint8Array;
}

function signerCert(options: SignerOptions = {}): Promise<string> {
  return buildTestCertificatePem({
    subject: passTypeSubject(options.passTypeId ?? PASS_TYPE_ID, options.teamId ?? TEAM_ID),
    issuer: options.issuer ?? TEST_WWDR_NAME,
    notBefore: options.notBefore ?? relativeDate(-365 * DZIEN),
    notAfter: options.notAfter ?? relativeDate(365 * DZIEN),
    spki: options.spki ?? signerKey.spki,
    issuerKey: wwdrKey.signingKey,
    serial: 0x5a17,
  });
}

function wwdrCert(notBefore: Date, notAfter: Date): Promise<string> {
  return buildTestCertificatePem({
    subject: TEST_WWDR_NAME,
    issuer: TEST_WWDR_NAME,
    notBefore,
    notAfter,
    spki: wwdrKey.spki,
    issuerKey: wwdrKey.signingKey,
  });
}

function config(overrides: Partial<AppleWalletConfig> = {}): AppleWalletConfig {
  return {
    passTypeId: PASS_TYPE_ID,
    teamId: TEAM_ID,
    signerCertPem: signerPem,
    signerKeyPem: signerKey.privateKeyPem,
    wwdrCertPem: wwdrPem,
    ...overrides,
  };
}

beforeAll(async () => {
  [wwdrKey, signerKey, otherKey] = await Promise.all([
    generateTestRsaKey(),
    generateTestRsaKey(),
    generateTestRsaKey(),
  ]);
  wwdrPem = await wwdrCert(relativeDate(-1000 * DZIEN), relativeDate(1000 * DZIEN));
  signerPem = await signerCert();
});

describe("inspectAppleWalletConfig", () => {
  it("poprawna para, ważne certyfikaty, łańcuch i UID/OU zgodne -> bez problemów", () => {
    expect(inspectAppleWalletConfig(config(), NOW)).toEqual({ problems: [], warnings: [] });
  });

  it("utrwalone testowe PKI (PKCS#8 i PKCS#1 tej samej pary) też przechodzi", () => {
    const fixture = {
      passTypeId: PASS_TYPE_ID,
      teamId: TEAM_ID,
      signerCertPem: TEST_SIGNER_CERT_PEM,
      wwdrCertPem: TEST_WWDR_CERT_PEM,
    };
    for (const signerKeyPem of [TEST_SIGNER_KEY_PKCS8_PEM, TEST_SIGNER_KEY_PKCS1_PEM]) {
      expect(inspectAppleWalletConfig({ ...fixture, signerKeyPem }, NOW).problems).toEqual([]);
    }
  });

  it("klucz z innej pary -> problem z nazwą i numerem certyfikatu, bez bajtów klucza", () => {
    const report = inspectAppleWalletConfig(config({ signerKeyPem: otherKey.privateKeyPem }), NOW);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatch(
      /^private key does not match the Pass Type ID certificate "Pass Type ID: pass\.org\.example\.test" \(serial 5a17\): certificate modulus 2048-bit \.\.\.[0-9a-f]{8}, key modulus 2048-bit \.\.\.[0-9a-f]{8}$/,
    );
    const keyBody = otherKey.privateKeyPem.split("\n")[1];
    expect(report.problems[0]).not.toContain(keyBody);
  });

  it("certyfikat Pass Type ID wygasły albo jeszcze nieważny -> problem z datą", async () => {
    const expired = await signerCert({
      notBefore: relativeDate(-400 * DZIEN),
      notAfter: relativeDate(-DZIEN),
    });
    expect(inspectAppleWalletConfig(config({ signerCertPem: expired }), NOW).problems).toEqual([
      `Pass Type ID certificate "Pass Type ID: pass.org.example.test" (serial 5a17) expired on ${relativeDate(-DZIEN).toISOString()}`,
    ]);
    const future = await signerCert({ notBefore: relativeDate(DZIEN) });
    expect(inspectAppleWalletConfig(config({ signerCertPem: future }), NOW).problems).toEqual([
      `Pass Type ID certificate "Pass Type ID: pass.org.example.test" (serial 5a17) is not valid before ${relativeDate(DZIEN).toISOString()}`,
    ]);
  });

  it("certyfikat ważny krócej niż 30 dni -> skonfigurowany, ale z ostrzeżeniem", async () => {
    const soon = await signerCert({ notAfter: relativeDate(10 * DZIEN + 1000) });
    const report = inspectAppleWalletConfig(config({ signerCertPem: soon }), NOW);
    expect(report.problems).toEqual([]);
    expect(report.warnings).toEqual([
      `Pass Type ID certificate "Pass Type ID: pass.org.example.test" (serial 5a17) expires in 10 days (${relativeDate(10 * DZIEN + 1000).toISOString()}) - renew it`,
    ]);
    const later = await signerCert({ notAfter: relativeDate(CERT_EXPIRY_WARNING_DAYS * DZIEN) });
    expect(inspectAppleWalletConfig(config({ signerCertPem: later }), NOW).warnings).toEqual([]);
  });

  it("WWDR wygasły -> problem; WWDR wygasający -> ostrzeżenie", async () => {
    const expired = await wwdrCert(relativeDate(-1000 * DZIEN), relativeDate(-2 * DZIEN));
    expect(inspectAppleWalletConfig(config({ wwdrCertPem: expired }), NOW).problems).toEqual([
      expect.stringMatching(
        /^WWDR certificate "NES Wallet TEST WWDR - NOT APPLE" \(serial [0-9a-f]+\) expired on /,
      ),
    ]);
    const soon = await wwdrCert(relativeDate(-1000 * DZIEN), relativeDate(5 * DZIEN));
    const report = inspectAppleWalletConfig(config({ wwdrCertPem: soon }), NOW);
    expect(report.problems).toEqual([]);
    expect(report.warnings).toEqual([
      expect.stringMatching(/^WWDR certificate .* expires in 5 days/),
    ]);
  });

  it("certyfikat wystawiony przez inny WWDR (np. G1 zamiast G4) -> problem łańcucha", async () => {
    const otherIssuer = await signerCert({ issuer: [["2.5.4.3", "Some Other CA"]] });
    expect(inspectAppleWalletConfig(config({ signerCertPem: otherIssuer }), NOW).problems).toEqual([
      expect.stringMatching(
        /was issued by "Some Other CA", not by the configured WWDR certificate "NES Wallet TEST WWDR - NOT APPLE"/,
      ),
    ]);
  });

  it("UID i OU certyfikatu muszą zgadzać się z Pass Type ID i Team ID z konfiguracji", () => {
    const report = inspectAppleWalletConfig(
      config({ passTypeId: "pass.org.example.other", teamId: "OTHERTEAM1" }),
      NOW,
    );
    expect(report.problems).toEqual([
      expect.stringContaining(
        'is for "pass.org.example.test", but APPLE_WALLET_PASS_TYPE_ID is "pass.org.example.other"',
      ),
      expect.stringContaining(
        'belongs to team "TESTTEAM01", but APPLE_WALLET_TEAM_ID is "OTHERTEAM1"',
      ),
    ]);
  });

  it("certyfikat z kluczem EC, nieczytelny klucz i nieczytelny certyfikat -> problemy", async () => {
    const ec = await signerCert({ spki: await generateTestEcSpki() });
    expect(inspectAppleWalletConfig(config({ signerCertPem: ec }), NOW).problems).toEqual([
      expect.stringMatching(/carries a non-RSA key \(1\.2\.840\.10045\.2\.1\)$/),
    ]);
    const junkKey = toPem("PRIVATE KEY", Uint8Array.of(0x30, 0x03, 0x02, 0x01, 0x00));
    expect(inspectAppleWalletConfig(config({ signerKeyPem: junkKey }), NOW).problems).toEqual([
      expect.stringMatching(/^signer private key \(APPLE_WALLET_SIGNER_KEY_PEM\) unreadable: /),
    ]);
    const junkCert = toPem("CERTIFICATE", Uint8Array.of(0x30, 0x00));
    expect(inspectAppleWalletConfig(config({ signerCertPem: junkCert }), NOW).problems).toEqual([
      "Pass Type ID certificate (APPLE_WALLET_SIGNER_CERT_PEM) unreadable: x509: missing tbsCertificate",
    ]);
  });
});

describe("appleWalletConfig - kontrola w odczycie konfiguracji", () => {
  function stubGenerated(overrides: Record<string, string> = {}) {
    stubApple({
      APPLE_WALLET_SIGNER_CERT_PEM: oneLine(signerPem),
      APPLE_WALLET_SIGNER_KEY_PEM: oneLine(signerKey.privateKeyPem),
      APPLE_WALLET_WWDR_CERT_PEM: oneLine(wwdrPem),
      ...overrides,
    });
  }

  it("niedopasowana para klucz/certyfikat -> null (503 not_configured) i JEDNA czytelna linia logu", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stubApple({ APPLE_WALLET_SIGNER_KEY_PEM: otherKey.privateKeyPem });
    expect(appleWalletConfig()).toBeNull();
    expect(walletAvailability().apple).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0][0]);
    expect(line).toMatch(
      /^\[wallet\] apple wallet not configured: private key does not match the Pass Type ID certificate "Pass Type ID: pass\.org\.example\.test" \(serial 8f1e2d3c4b5a69788796a5b4c3d2e1f0\)/,
    );
    expect(line).not.toContain(otherKey.privateKeyPem.split("\n")[1]);
  });

  it("wygasły certyfikat w chwili odczytu -> null; ten sam werdykt loguje się raz na izolat", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stubGenerated({
      APPLE_WALLET_SIGNER_CERT_PEM: oneLine(
        await signerCert({ notBefore: relativeDate(-400 * DZIEN), notAfter: relativeDate(-DZIEN) }),
      ),
    });
    expect(appleWalletConfig(NOW)).toBeNull();
    expect(appleWalletConfig(NOW)).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("expired on");
    // Dzień przed wygaśnięciem ten sam certyfikat jest ważny (ocena dat przy każdym odczycie).
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(appleWalletConfig(NOW - 2 * DZIEN)).not.toBeNull();
  });

  it("certyfikat wygasający -> konfiguracja zwrócona, ostrzeżenie w logu", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubGenerated({
      APPLE_WALLET_SIGNER_CERT_PEM: oneLine(
        await signerCert({ notAfter: relativeDate(3 * DZIEN) }),
      ),
    });
    expect(appleWalletConfig(NOW)?.passTypeId).toBe(PASS_TYPE_ID);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[wallet\] apple wallet: Pass Type ID certificate .* expires in 3 days/,
      ),
    );
  });
});

describe("googleWalletConfig - kontrola klucza konta usługi", () => {
  it("klucz w poprawnej ramce PEM, ale nie RSA/nieczytelny -> null i log bez treści klucza", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const junk = toPem("PRIVATE KEY", Uint8Array.of(0x30, 0x03, 0x02, 0x01, 0x00));
    stubGoogle({ ...ACCOUNT, private_key: junk });
    expect(googleWalletConfig()).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[wallet\] google wallet not configured: service account private key unreadable: /,
      ),
    );
    expect(
      inspectGoogleWalletConfig({
        issuerId: "3388000000000000000",
        serviceAccount: {
          clientEmail: ACCOUNT.client_email,
          privateKeyPem: TEST_SIGNER_KEY_PKCS8_PEM,
          tokenUri: "https://oauth2.googleapis.com/token",
        },
      }),
    ).toEqual({ problems: [], warnings: [] });
  });
});
