// Molekula „Zgody i dane z zapisu" w rozwinięciu wiersza zgłoszenia
// (REG-02 / REG-14).
//
// CO TEN PLIK DOWODZI:
//   1. Szczegół czyta `admin_event_registration_consent_detail` (najemca
//      i rola w bazie - z argumentu tylko identyfikator zgłoszenia).
//   2. Różnice pole po polu: kartoteka obok danych przysłanych przy zapisie;
//      pola zgodne nie są pokazywane jako różnica.
//   3. Plakietka otwartego linku DOI („czeka na potwierdzenie").
//   4. Przeniesienie idzie zapisem organizatora (`admin_event_registration_upsert`)
//      z WYŁĄCZNIE różnicami, źródłem i grupą zgłoszenia - bez nich zapis
//      oznaczyłby zgłoszenie jako `organizer` i przepiął do grupy domyślnej,
//      a pominięte klucze (bilet, odpowiedzi, notatka) zostają nietknięte.
//   5. Księga zgód osoby z kanałem dowodu i wersją tekstu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-registration", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc } }));

const { RegistrationConsentDetail } =
  await import("@/components/admin/events/molecules/RegistrationConsentDetail");

const REG = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";
const K = "adminEventRegistration.consentDetail";

const DETAIL = {
  registration_id: REG,
  person_id: "44444444-4444-4444-8444-444444444444",
  event_id: EVENT,
  registration_source: "self_registration",
  group_id: GROUP,
  submitted_profile: { first_name: "Anna", last_name: "Attacker", phone: "+48 999 999 999" },
  current: { first_name: "Anna", last_name: "Nowak", phone: "+48 600 000 001", email: "a@x.pl" },
  differs: true,
  differences: ["last_name", "phone"],
  consents: { marketing_at: null, partner_sharing_at: null, withdrawn_at: null },
  open_confirmation: {
    purposes: ["marketing"],
    created_at: "2026-10-12T10:00:00Z",
    expires_at: "2026-10-19T10:00:00Z",
  },
  ledger: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      purpose: "marketing",
      status: "pending",
      evidence: "registration_form",
      created_at: "2026-10-12T10:00:00Z",
      text_version: 1,
      text_lang: "pl",
    },
  ],
};

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (name: string) =>
    name === "admin_event_registration_consent_detail"
      ? { data: DETAIL, error: null }
      : { data: REG, error: null },
  );
});

describe("RegistrationConsentDetail - dane z zapisu i księga zgód (REG-02 / REG-14)", () => {
  it("różnice pole po polu, plakietka DOI i księga z kanałem dowodu", async () => {
    renderWithQueryClient(<RegistrationConsentDetail eventId={EVENT} registrationId={REG} />);

    expect(await screen.findByText(`${K}.differsTitle`)).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("admin_event_registration_consent_detail", {
      p_registration_id: REG,
    });
    expect(screen.getByText("Nowak")).toBeInTheDocument();
    expect(screen.getByText("Attacker")).toBeInTheDocument();
    expect(screen.getByText("+48 999 999 999")).toBeInTheDocument();
    // Imię się zgadza - nie jest różnicą.
    expect(screen.queryByText(`${K}.fields.first_name`)).toBeNull();
    expect(screen.getByText(/consentDetail\.pending\(date=/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /consentDetail\.purposes\.marketing · .*statuses\.pending · .*ledgerEvidence/,
      ),
    ).toBeInTheDocument();
  });

  it("przeniesienie: zapis organizatora z WYŁĄCZNIE różnicami, źródłem i grupą", async () => {
    renderWithQueryClient(<RegistrationConsentDetail eventId={EVENT} registrationId={REG} />);

    fireEvent.click(await screen.findByRole("button", { name: `${K}.apply` }));
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("admin_event_registration_upsert", {
        p_payload: {
          registration_id: REG,
          source: "self_registration",
          group_id: GROUP,
          last_name: "Attacker",
          phone: "+48 999 999 999",
        },
      }),
    );
    // Szczegół czytany ponownie po przeniesieniu.
    await waitFor(() =>
      expect(
        h.rpc.mock.calls.filter(([name]) => name === "admin_event_registration_consent_detail"),
      ).toHaveLength(2),
    );
  });

  it("bez różnic: zdanie zamiast tabeli i bez przycisku przeniesienia", async () => {
    h.rpc.mockResolvedValue({
      data: { ...DETAIL, submitted_profile: null, differs: false, differences: [] },
      error: null,
    });
    renderWithQueryClient(<RegistrationConsentDetail eventId={EVENT} registrationId={REG} />);

    expect(await screen.findByText(`${K}.noDifferences`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `${K}.apply` })).toBeNull();
  });

  it("odmowa bazy (np. brak roli) - komunikat zamiast szczegółu", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "forbidden: admin role required" } });
    renderWithQueryClient(<RegistrationConsentDetail eventId={EVENT} registrationId={REG} />);

    expect(await screen.findByText(`${K}.loadError`)).toBeInTheDocument();
  });
});
