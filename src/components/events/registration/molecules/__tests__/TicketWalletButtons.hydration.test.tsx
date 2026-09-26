// Przyciski portfela - pierwszy render jest deterministyczny (SSR i hydratacja).
//
// PO CO, SKORO TRASA BILETU JEST `ssr: false`. Molekuła wybiera przyciski po
// `navigator`, którego na serwerze nie ma. Gdyby wybór zapadał w renderze,
// każde przyszłe osadzenie w stronie renderowanej na serwerze (np. panel
// „Moje” wydarzenia) dawałoby niezgodność hydratacji i podmianę drzewa.
// Test dowodzi, że serwer i pierwszy render klienta dają TEN SAM szkielet,
// a przyciski pojawiają się dopiero po montażu.
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/i18nReal";

import { eventWalletPl } from "@/lib/i18n-event-wallet";

vi.mock("@/lib/events/ticketWalletApi", () => ({
  fetchWalletAvailability: () => Promise.resolve({ apple: true, google: true }),
  checkAppleWalletPass: vi.fn(),
  requestGoogleWalletSaveUrl: vi.fn(),
}));

const { TicketWalletButtons } =
  await import("@/components/events/registration/molecules/TicketWalletButtons");

function view(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <TicketWalletButtons qrToken="WalletFreeToken_0123456789abcdef" />
    </QueryClientProvider>
  );
}

describe("TicketWalletButtons - SSR i hydratacja", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("serwer i pierwszy render klienta dają szkielet; przyciski dopiero po montażu", async () => {
    const serverClient = new QueryClient();
    const html = renderToString(view(serverClient));
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain(eventWalletPl.eventWallet.apple.name);

    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    const errors: unknown[] = [];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(host, view(client), { onRecoverableError: (e) => errors.push(e) });
    });

    expect(await screen.findByText(eventWalletPl.eventWallet.apple.name)).toBeInTheDocument();
    expect(screen.getByText(eventWalletPl.eventWallet.google.name)).toBeInTheDocument();
    expect(errors).toEqual([]);
    act(() => root.unmount());
  });
});
