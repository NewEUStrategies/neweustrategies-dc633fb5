// Panel uczestnika „Moje zgłoszenia": stan zapisu, oś pieniędzy, powód
// anulowania, kanały powiadomień - i DROGA POWROTNA DO KASY.
//
// CO TEN PLIK DOWODZI:
//
// 1. NIEOPŁACONE ZGŁOSZENIE MA CO ZROBIĆ Z TĄ INFORMACJĄ. Karta pokazywała
//    plakietkę „Nieopłacone" i nie dawała z tym NIC zrobić: jedyną drogą do
//    zapłaty był ekran potwierdzenia zapisu, zamknięty razem z zakładką.
//    Uczestnik płacił więc, zapisując się DRUGI RAZ - czyli produkując
//    zduplikowane wiersze, o które rozbijało się dopasowanie wpłaty
//    w `payments_apply_event_ticket_outcome`.
// 2. KASA DOSTAJE KOMPLET IDENTYFIKATORÓW z wiersza karty
//    (`registration_id`, `event_id`, `ticket_type_id`), a nie zgaduje ich.
// 3. STAN, W KTÓRYM PŁACENIE NIE MA SENSU, NIE POKAZUJE KASY: opłacone,
//    odwołane, odrzucone, bezpłatne.
// 4. GROSZE SĄ GROSZAMI. `amount_cents` dzieli się przez 100 i dostaje walutę
//    ze SWOJEGO wiersza - pomyłka o dwa rzędy wielkości wygląda na ekranie
//    jak zwykła kwota.
// 5. POWÓD JEST TREŚCIĄ, NIE ETYKIETĄ. Zwrot pełny, częściowy i anulowanie to
//    trzy różne zdania, a nie jedno słowo „anulowane".
// 6. KANAŁY SĄ PER ZGŁOSZENIE i zapisują się do RPC z identyfikatorem TEGO
//    wiersza - przełącznik piszący do cudzego zgłoszenia wyciszyłby komuś
//    innemu potwierdzenie wejścia.
//
// ATRAPA OBEJMUJE WYŁĄCZNIE SIEĆ i granice kasy. Haki `useQuery`/`useMutation`
// jadą prawdziwe, bo to one decydują o stanach „wczytywanie", „błąd" i „pusto".
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import type { ParticipantRegistration } from "@/lib/events/participantTicketsApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";

const fetchRegistrations = vi.fn<() => Promise<ParticipantRegistration[]>>();
const setChannels = vi.fn();
const checkout = vi.fn();

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => checkout,
}));

vi.mock("@/lib/billing/checkout.functions", () => ({
  createCheckoutOrder: { name: "createCheckoutOrder" },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: { user: { id: "u-1" } } }) }));

vi.mock("@/lib/stripe", () => ({ getStripeEnvironment: () => "sandbox" }));

vi.mock("@/components/checkout/LazyEmbeddedCheckoutDialog", () => ({
  LazyEmbeddedCheckoutDialog: ({ clientSecret }: { clientSecret: string | null }) =>
    clientSecret === null ? null : <div data-testid="checkout-modal">{clientSecret}</div>,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

vi.mock("@/lib/events/participantTicketsApi", () => ({
  fetchMyRegistrations: () => fetchRegistrations(),
  setRegistrationChannels: (input: unknown) => setChannels(input),
}));

const { toast } = await import("sonner");
const { ParticipantTicketsPanel } = await import("@/components/profile/ParticipantTicketsPanel");

const REGISTRATION_ID = "11111111-1111-1111-1111-111111111111";
const EVENT_ID = "22222222-2222-2222-2222-222222222222";
const TICKET_ID = "33333333-3333-3333-3333-333333333333";

function registration(over: Partial<ParticipantRegistration> = {}): ParticipantRegistration {
  return {
    registrationId: REGISTRATION_ID,
    eventId: EVENT_ID,
    ticketTypeId: TICKET_ID,
    status: "pending",
    paymentStatus: "unpaid",
    createdAt: "2026-08-01T10:00:00.000Z",
    cancelledAt: null,
    paidAt: null,
    waitlistPosition: null,
    promotedAt: null,
    notifyEmail: true,
    notifySms: false,
    cancelReason: null,
    decisionSource: null,
    eventSlug: "kongres-cee",
    eventTitlePl: "Kongres CEE 2026",
    eventTitleEn: "CEE Congress 2026",
    eventStartsAt: "2026-09-15T08:00:00.000Z",
    eventEndsAt: null,
    eventTimezone: "Europe/Warsaw",
    orderStatus: "pending",
    amountCents: 15000,
    refundedCents: 0,
    currency: "PLN",
    webhooks: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchRegistrations.mockResolvedValue([registration()]);
  setChannels.mockResolvedValue({
    registrationId: REGISTRATION_ID,
    notifyEmail: true,
    notifySms: true,
  });
});

describe("ParticipantTicketsPanel - powrót do kasy", () => {
  it("nieopłacone zgłoszenie dostaje przycisk „dokończ płatność” i kwotę", async () => {
    renderWithQueryClient(<ParticipantTicketsPanel />);

    expect(
      await screen.findByRole("button", { name: "eventRegistration.payment.resume" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("eventRegistration.payment.amountDue(amount=150,00 zł)"),
    ).toBeInTheDocument();
  });

  it("klik niesie KOMPLET identyfikatorów z wiersza karty", async () => {
    checkout.mockResolvedValue({ ok: true, mode: "stripe", clientSecret: "cs_5" });
    renderWithQueryClient(<ParticipantTicketsPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: "eventRegistration.payment.resume" }),
    );

    await waitFor(() => expect(checkout).toHaveBeenCalledTimes(1));
    const payload = checkout.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(payload.data).toMatchObject({
      registration_id: REGISTRATION_ID,
      event_id: EVENT_ID,
      ticket_type_id: TICKET_ID,
      success_path: "/profile/tickets",
    });
  });

  it("bez `event_id` ze starszego backendu przycisk jest MARTWY", async () => {
    fetchRegistrations.mockResolvedValue([registration({ eventId: null, ticketTypeId: null })]);
    renderWithQueryClient(<ParticipantTicketsPanel />);

    const button = await screen.findByRole("button", { name: "eventRegistration.payment.resume" });
    expect(button).toBeDisabled();
  });

  const bezKasy: ReadonlyArray<readonly [string, Partial<ParticipantRegistration>]> = [
    ["opłacone", { paymentStatus: "paid", status: "approved" }],
    ["odwołane", { status: "cancelled", cancelledAt: "2026-08-10T10:00:00.000Z" }],
    ["odrzucone", { status: "rejected" }],
    ["bezpłatne", { paymentStatus: "not_required", amountCents: 0 }],
  ];

  for (const [label, over] of bezKasy) {
    it(`zgłoszenie ${label} NIE pokazuje kasy`, async () => {
      fetchRegistrations.mockResolvedValue([registration(over)]);
      renderWithQueryClient(<ParticipantTicketsPanel />);

      expect(await screen.findByText("Kongres CEE 2026")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "eventRegistration.payment.resume" })).toBeNull();
    });
  }
});

describe("ParticipantTicketsPanel - stan i pieniądze", () => {
  it("kwota dzieli się przez 100 i bierze walutę ze SWOJEGO wiersza", async () => {
    fetchRegistrations.mockResolvedValue([
      registration({ amountCents: 1290, currency: "EUR", paymentStatus: "paid" }),
    ]);
    renderWithQueryClient(<ParticipantTicketsPanel />);

    expect(await screen.findByText(/12,90/)).toBeInTheDocument();
    expect(screen.getByText(/€/)).toBeInTheDocument();
  });

  it("zwrot pełny, częściowy i anulowanie to TRZY różne zdania", async () => {
    fetchRegistrations.mockResolvedValue([
      registration({ registrationId: "r-full", amountCents: 10000, refundedCents: 10000 }),
      registration({ registrationId: "r-part", amountCents: 10000, refundedCents: 3000 }),
      registration({ registrationId: "r-canc", cancelledAt: "2026-08-10T10:00:00.000Z" }),
    ]);
    renderWithQueryClient(<ParticipantTicketsPanel />);

    expect(await screen.findByText("participantTickets.reason.refunded")).toBeInTheDocument();
    expect(screen.getByText("participantTickets.reason.partial")).toBeInTheDocument();
    expect(screen.getAllByText(/participantTickets\.reason\.cancelled/)).toHaveLength(1);
  });

  it("pusta lista nazywa pustkę, a nie pokazuje pustej ramki", async () => {
    fetchRegistrations.mockResolvedValue([]);
    renderWithQueryClient(<ParticipantTicketsPanel />);

    expect(await screen.findByText("participantTickets.empty")).toBeInTheDocument();
  });

  it("awaria odczytu mówi o awarii, a nie udaje pustej listy", async () => {
    fetchRegistrations.mockRejectedValue(new Error("network"));
    renderWithQueryClient(<ParticipantTicketsPanel />);

    expect(await screen.findByText("participantTickets.loadError")).toBeInTheDocument();
    expect(screen.queryByText("participantTickets.empty")).toBeNull();
  });

  it("filtr po wydarzeniu zawęża listę, a nie chowa cudzych zgłoszeń przed bazą", async () => {
    fetchRegistrations.mockResolvedValue([
      registration({ registrationId: "r-1", eventSlug: "kongres-cee" }),
      registration({ registrationId: "r-2", eventSlug: "inne", eventTitlePl: "Inne" }),
    ]);
    renderWithQueryClient(<ParticipantTicketsPanel slugFilter="kongres-cee" hideHeader />);

    expect(await screen.findByText("Kongres CEE 2026")).toBeInTheDocument();
    expect(screen.queryByText("Inne")).toBeNull();
    // `hideHeader` chowa własny `h1`, bo panel bywa osadzony pod cudzym nagłówkiem.
    expect(screen.queryByText("participantTickets.title")).toBeNull();
  });
});

describe("ParticipantTicketsPanel - kanały powiadomień", () => {
  it("przełącznik zapisuje się do RPC z identyfikatorem TEGO zgłoszenia", async () => {
    renderWithQueryClient(<ParticipantTicketsPanel />);

    const switches = await screen.findAllByRole("switch");
    fireEvent.click(switches[1] as HTMLElement);

    await waitFor(() =>
      expect(setChannels).toHaveBeenCalledWith({
        registrationId: REGISTRATION_ID,
        notifySms: true,
      }),
    );
  });

  it("awaria zapisu mówi o awarii, a nie udaje sukcesu", async () => {
    setChannels.mockRejectedValue(new Error("denied"));
    renderWithQueryClient(<ParticipantTicketsPanel />);

    const switches = await screen.findAllByRole("switch");
    fireEvent.click(switches[0] as HTMLElement);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("participantTickets.channels.failed"),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = renderWithQueryClient(<ParticipantTicketsPanel />);
    await screen.findByText("Kongres CEE 2026");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
