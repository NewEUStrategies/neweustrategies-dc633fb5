// Strona biletu z kodem QR otwierana z maila `event_ticket_issued`.
//
// DLACZEGO TEN TEST ISTNIEJE. Kod wejścia jedzie we fragmencie adresu i jest
// czytany dopiero w przeglądarce. Pomyłka w odczycie fragmentu to pusty bilet
// pokazany gościowi przy bramce - bez błędu w konsoli i bez czerwieni w typach.
//
// BILET SKŁADA TRZY RZECZY Z TEGO SAMEGO KODU: QR, przyciski portfela (f7b)
// i kartę miejsca na sali (f4). Obie dokładki dostają DOKŁADNIE ten kod,
// który koduje QR - inny kod w portfelu albo w odczycie miejsca to bilet,
// który na bramce nie pasuje do tego, co uczestnik ma w telefonie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { DZIEN, relativeIso } from "@/test/time";

const h = vi.hoisted(() => ({
  header: null as Record<string, unknown> | null,
  qrInputs: [] as string[],
  seatCards: [] as { slug: string; qrToken: string }[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/lib/community/publicQueries", () => ({
  fetchEventPageHeader: () => Promise.resolve(h.header),
}));

// Przyciski portfela mają własne testy; tu liczy się tylko to, że dostają kod.
vi.mock("@/components/events/registration/molecules/TicketWalletButtons", () => ({
  TicketWalletButtons: ({ qrToken }: { qrToken: string }) => (
    <div data-testid="wallet-buttons" data-token={qrToken} />
  ),
}));

// Karta miejsca ma własny test (`TicketSeatCards.test.tsx`); tu liczy się,
// że dostaje slug i TEN SAM kod biletu.
vi.mock("@/components/events/registration/TicketSeatCards", () => ({
  TicketSeatCards: ({ slug, ticket }: { slug: string; ticket: { qrToken: string } }) => {
    h.seatCards.push({ slug, qrToken: ticket.qrToken });
    return <div data-testid="seat-cards" data-token={ticket.qrToken} />;
  },
}));

vi.mock("qrcode", () => ({
  default: {
    toDataURL: (text: string) => {
      h.qrInputs.push(text);
      return Promise.resolve("data:image/png;base64,QR");
    },
  },
}));

const { EventTicketCodePanel } =
  await import("@/components/events/registration/EventTicketCodePanel");

const QR = "GuestQrToken-0123456789abcdefABC";
const MANAGE = "GuestManageToken_0123456789abcde";

function renderPanel(hash: string) {
  window.history.replaceState(null, "", `/events/kongres/ticket${hash}`);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EventTicketCodePanel slug="kongres" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.header = {
    title_pl: "Kongres",
    title_en: "Congress",
    starts_at: relativeIso(30 * DZIEN),
    timezone: "Europe/Warsaw",
  };
  h.qrInputs = [];
  h.seatCards = [];
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("EventTicketCodePanel", () => {
  it("rysuje QR z SAMEGO kodu z fragmentu i pokazuje kod do wpisania ręcznie", async () => {
    renderPanel(`#t=${QR}`);

    expect(await screen.findByAltText("eventRegistration.ticketPage.qrAlt")).toHaveAttribute(
      "src",
      "data:image/png;base64,QR",
    );
    expect(h.qrInputs).toEqual([QR]);
    expect(screen.getByText(QR)).toBeInTheDocument();
    expect(await screen.findByText("Kongres")).toBeInTheDocument();
    // Prowadzący nie ma klucza w bilecie - link samoobsługi się nie pojawia.
    expect(screen.queryByText("eventRegistration.ticketPage.manage")).toBeNull();
    // Portfel dostaje TEN SAM kod, który koduje QR.
    expect(screen.getByTestId("wallet-buttons")).toHaveAttribute("data-token", QR);
  });

  it("karta miejsca dostaje slug i TEN SAM kod, a stoi POD kartą kodu z portfelem", async () => {
    renderPanel(`#t=${QR}`);

    const miejsce = await screen.findByTestId("seat-cards");
    const portfel = screen.getByTestId("wallet-buttons");
    expect(h.seatCards.at(-1)).toEqual({ slug: "kongres", qrToken: QR });
    // Portfel siedzi w karcie kodu, karta miejsca - pod nią, poza nią.
    expect(portfel.compareDocumentPosition(miejsce) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(portfel.parentElement?.contains(miejsce)).toBe(false);
  });

  it("gość z kluczem samoobsługi dostaje link do zarządzania zgłoszeniem", async () => {
    renderPanel(`#t=${QR}&m=${MANAGE}`);

    const link = await screen.findByText("eventRegistration.ticketPage.manage");
    expect(link.closest("a")).toHaveAttribute("href", `/events/kongres/manage?token=${MANAGE}`);
  });

  it("adres bez kodu mówi, skąd go wziąć, i nie rysuje pustego QR", async () => {
    renderPanel("#t=za-krotki");

    expect(
      await screen.findByText("eventRegistration.ticketPage.missingTitle"),
    ).toBeInTheDocument();
    expect(h.qrInputs).toEqual([]);
    expect(screen.queryByAltText("eventRegistration.ticketPage.qrAlt")).toBeNull();
    // Bez kodu nie ma czego dodać do portfela ani o co zapytać o miejsce.
    expect(screen.queryByTestId("wallet-buttons")).toBeNull();
    expect(screen.queryByTestId("seat-cards")).toBeNull();
    expect(h.seatCards).toEqual([]);
  });
});
