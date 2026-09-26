// Wspólne dane testów przepustek Wallet (model biletu, odpowiedź bazy,
// konfiguracje Apple/Google z TESTOWYM kluczem z `fixtures/walletTestPki`).
//
// Daty są stałe (bez zegara): wydarzenie 2026-10-16 09:00-17:00 czasu
// warszawskiego (CEST, UTC+2), więc testy sprawdzają strefę, a nie „teraz”.
import type { Json } from "@/integrations/supabase/types";
import type {
  AppleWalletConfig,
  GoogleWalletConfig,
} from "@/lib/events/wallet/walletConfig.server";
import { walletTicketFromPayload, type WalletTicket } from "@/lib/events/wallet/walletTicket";
import {
  TEST_SIGNER_CERT_PEM,
  TEST_SIGNER_KEY_PKCS8_PEM,
  TEST_WWDR_CERT_PEM,
} from "@/test/fixtures/walletTestPki";

export const WALLET_QR = "WalletFreeToken_0123456789abcdef";
export const WALLET_REGISTRATION_ID = "52b00000-0000-0000-0000-0000000000a1";
export const WALLET_EVENT_ID = "52e00000-0000-0000-0000-0000000000a1";
export const WALLET_TENANT_ID = "52000000-0000-0000-0000-0000000000a0";

/** Odpowiedź `event_ticket_wallet_payload` w kształcie z migracji 20260926160000. */
export function walletPayloadRow(overrides: Record<string, Json> = {}): Record<string, Json> {
  return {
    registration_id: WALLET_REGISTRATION_ID,
    tenant_id: WALLET_TENANT_ID,
    tenant_name: "Organizator A",
    status: "approved",
    first_name: "Hanna",
    last_name: "Posiadaczka",
    lang: "pl",
    event_id: WALLET_EVENT_ID,
    event_slug: "wallet-kongres",
    event_title_pl: "Kongres portfela",
    event_title_en: "Wallet congress",
    event_starts_at: "2026-10-16T07:00:00+00:00",
    event_ends_at: "2026-10-16T15:00:00+00:00",
    event_timezone: "Europe/Warsaw",
    event_location: "Warszawa, Sala Kongresowa",
    event_cover_url: "https://cdn.example.org/cover.jpg",
    event_branding: { navigation: "#112233", main_action: "#FF6600" },
    ticket_name_pl: "Standardowy",
    ticket_name_en: "Standard",
    group_name_pl: "Prasa",
    group_name_en: "Press",
    group_color: "#00AA55",
    ...overrides,
  };
}

/** Model biletu z odpowiedzi bazy (rzuca, gdy fixture jest niekompletny). */
export function walletTicketFixture(
  overrides: Record<string, Json> = {},
  lang: string | null = null,
): WalletTicket {
  const ticket = walletTicketFromPayload(walletPayloadRow(overrides), WALLET_QR, lang);
  if (ticket === null) throw new Error("test: niekompletny fixture biletu");
  return ticket;
}

export const APPLE_CONFIG_FIXTURE: AppleWalletConfig = {
  passTypeId: "pass.org.example.test",
  teamId: "TESTTEAM01",
  signerCertPem: TEST_SIGNER_CERT_PEM,
  signerKeyPem: TEST_SIGNER_KEY_PKCS8_PEM,
  wwdrCertPem: TEST_WWDR_CERT_PEM,
};

export const GOOGLE_CONFIG_FIXTURE: GoogleWalletConfig = {
  issuerId: "3388000000000000000",
  serviceAccount: {
    clientEmail: "wallet-test@example-project.iam.gserviceaccount.com",
    privateKeyPem: TEST_SIGNER_KEY_PKCS8_PEM,
    tokenUri: "https://oauth2.googleapis.com/token",
  },
};
