// Strona biletu z kodem QR otwierana z maila `event_ticket_issued`.
//
// DLACZEGO TEN TEST ISTNIEJE. Kod wejścia jedzie we fragmencie adresu i jest
// czytany dopiero w przeglądarce. Pomyłka w odczycie fragmentu to pusty bilet
// pokazany gościowi przy bramce - bez błędu w konsoli i bez czerwieni w typach.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { DZIEN, relativeIso } from "@/test/time";

const h = vi.hoisted(() => ({
  header: null as Record<string, unknown> | null,
  qrInputs: [] as string[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/lib/community/publicQueries", () => ({
  fetchEventPageHeader: () => Promise.resolve(h.header),
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
  });
});
