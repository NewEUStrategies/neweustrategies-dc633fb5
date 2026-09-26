// Przyciski „Dodaj do Apple Wallet / Google Wallet” na stronie biletu.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Formularz Apple, który nie niesie
// kodu w ukrytym polu (paczka dla nikogo), który nawiguje, zanim trasa
// powie „nie” (uczestnik ląduje na surowym JSON-ie z błędem), przycisk Google
// na iPhonie, który zawsze kończy się błędem, albo komunikat błędu bez
// `role="alert"` - każde z nich widać dopiero w telefonie uczestnika.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  availability: vi.fn(),
  checkApple: vi.fn(),
  googleSave: vi.fn(),
  assign: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/events/ticketWalletApi", () => ({
  fetchWalletAvailability: h.availability,
  checkAppleWalletPass: h.checkApple,
  requestGoogleWalletSaveUrl: h.googleSave,
}));

const { TicketWalletButtons } =
  await import("@/components/events/registration/molecules/TicketWalletButtons");
const { WalletRequestError } = await import("@/lib/events/ticketWallet");
const { ticketWalletKeys } = await import("@/lib/events/useTicketWallet");

const TOKEN = "WalletFreeToken_0123456789abcdef";
const SAVE = "https://pay.google.com/gp/v/save/jwt";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36";

let submit: ReturnType<typeof vi.spyOn>;

function setDevice(userAgent: string, touch = 0) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  vi.spyOn(navigator, "maxTouchPoints", "get").mockReturnValue(touch);
}

beforeEach(() => {
  h.availability.mockReset().mockResolvedValue({ apple: true, google: true });
  h.checkApple.mockReset().mockResolvedValue(undefined);
  h.googleSave.mockReset().mockResolvedValue(SAVE);
  h.assign.mockReset();
  submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined);
  vi.spyOn(window.location, "assign").mockImplementation((url: string | URL) => h.assign(url));
  setDevice(DESKTOP);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TicketWalletButtons", () => {
  it("komputer: oba przyciski; formularz Apple niesie kod i język w polach ukrytych", async () => {
    const { container } = renderWithQueryClient(<TicketWalletButtons qrToken={TOKEN} />);
    const apple = await screen.findByRole("button", { name: /eventWallet\.apple\.name/ });
    expect(screen.getByRole("button", { name: /eventWallet\.google\.name/ })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "eventWallet.title" })).toBeInTheDocument();

    const form = apple.closest("form")!;
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/public/events/wallet/apple");
    expect(form.getAttribute("action")).not.toContain(TOKEN);
    const fields = Object.fromEntries(new FormData(form));
    expect(fields).toEqual({ token: TOKEN, lang: "pl" });

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("iPhone widzi tylko Apple, Android tylko Google", async () => {
    setDevice(IPHONE, 5);
    renderWithQueryClient(<TicketWalletButtons qrToken={TOKEN} />);
    await screen.findByRole("button", { name: /eventWallet\.apple\.name/ });
    expect(screen.queryByRole("button", { name: /eventWallet\.google\.name/ })).toBeNull();
    cleanup();

    setDevice(ANDROID, 5);
    renderWithQueryClient(<TicketWalletButtons qrToken={TOKEN} />);
    await screen.findByRole("button", { name: /eventWallet\.google\.name/ });
    expect(screen.queryByRole("button", { name: /eventWallet\.apple\.name/ })).toBeNull();
  });

  it("przed odpowiedzią o dostępności - szkielet; bez skonfigurowanych portfeli - nic", async () => {
    let resolve: (value: { apple: boolean; google: boolean }) => void = () => undefined;
    h.availability.mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = renderWithQueryClient(<TicketWalletButtons qrToken={TOKEN} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => resolve({ apple: false, google: false }));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("portfel skonfigurowany, ale nie dla tego urządzenia -> nic", async () => {
    setDevice(IPHONE, 5);
    h.availability.mockResolvedValue({ apple: false, google: true });
    const { container } = renderWithQueryClient(<TicketWalletButtons qrToken={TOKEN} />);
    await waitFor(() => expect(h.availability).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("awaria pytania o dostępność -> notka, że kod QR działa", async () => {
    h.availability.mockRejectedValue(new Error("offline"));
    renderWithQueryClient(<TicketWalletButtons qrToken={TOKEN} />);
    // Zapytanie ponawia raz, zanim uzna błąd.
    expect(await screen.findByText("eventWallet.unavailable", {}, { timeout: 4000 })).toBeVisible();
  });

  it("Apple: najpierw sprawdzenie, potem natywne wysłanie formularza (bez ponownego onSubmit)", async () => {
    let finish: () => void = () => undefined;
    h.checkApple.mockReturnValue(new Promise<void>((r) => (finish = r)));
    renderWithQueryClient(<TicketWalletButtons qrToken={TOKEN} />);
    const apple = await screen.findByRole("button", { name: /eventWallet\.apple\.name/ });
    fireEvent.submit(apple.closest("form")!);

    expect(await screen.findByText("eventWallet.working")).toBeInTheDocument();
    expect(apple).toBeDisabled();
    expect(screen.getByRole("button", { name: /eventWallet\.google\.name/ })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
    expect(h.checkApple).toHaveBeenCalledWith(TOKEN, "pl");

    await act(async () => finish());
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.contexts[0]).toBe(apple.closest("form"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Apple: odmowa trasy -> komunikat z roli alert, formularz nie nawiguje", async () => {
    h.checkApple.mockRejectedValue(new WalletRequestError("not_found"));
    renderWithQueryClient(<TicketWalletButtons qrToken={TOKEN} />);
    const apple = await screen.findByRole("button", { name: /eventWallet\.apple\.name/ });
    fireEvent.submit(apple.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("eventWallet.errors.notFound");
    expect(submit).not.toHaveBeenCalled();
  });

  it("Google: link zapisu -> przejście przeglądarki; błąd -> komunikat, ponowna próba go czyści", async () => {
    h.googleSave.mockRejectedValueOnce(new WalletRequestError("rate_limited"));
    renderWithQueryClient(<TicketWalletButtons qrToken={TOKEN} />);
    const google = await screen.findByRole("button", { name: /eventWallet\.google\.name/ });

    fireEvent.click(google);
    expect(await screen.findByRole("alert")).toHaveTextContent("eventWallet.errors.rateLimited");
    expect(h.assign).not.toHaveBeenCalled();

    fireEvent.click(google);
    await waitFor(() => expect(h.assign).toHaveBeenCalledWith(SAVE));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(h.googleSave).toHaveBeenLastCalledWith(TOKEN, "pl");
  });

  it("klucze zapytań zakorzenione w `event-wallet`", () => {
    expect(ticketWalletKeys.availability()).toEqual(["event-wallet", "availability"]);
  });
});
