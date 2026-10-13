// GNIAZDO `ManageConsentsSlot` - wycofanie zgód na stronie samoobsługi po
// kluczu (REG-14).
//
// CO TEN PLIK DOWODZI:
//  1. Trzy przyciski (marketing, partnerzy, obie) - każdy dopiero po
//     potwierdzeniu w oknie dialogowym woła `withdrawEventConsents` z KLUCZEM
//     z adresu i wybranym zakresem; nic poza tym (żadnego identyfikatora
//     osoby ani adresu).
//  2. Anulowanie okna niczego nie wysyła.
//  3. Wynik jest NEUTRALNY: jedno zdanie „zapisaliśmy decyzję", bez względu
//     na to, czy zgoda była aktywna (baza też odpowiada zawsze tak samo).
//  4. Limit prób i awaria mają własne zdania.
//  5. Bez klucza gniazdo milczy.
//  6. Brak naruszeń axe.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  withdraw: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.withdraw,
}));
vi.mock("@/lib/events/eventConsent.functions", () => ({
  withdrawEventConsents: { name: "withdrawEventConsents" },
}));

const { ManageConsentsSlot } =
  await import("@/components/events/participant/slots/ManageConsentsSlot");

/** 24 bajty w base64url - kształt klucza `manage_token`. */
const MANAGE_TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";

const K = "eventRegistration.manage.consents";

beforeEach(() => {
  h.withdraw.mockReset();
  h.withdraw.mockResolvedValue({ ok: true });
});

async function withdrawVia(button: string) {
  fireEvent.click(screen.getByRole("button", { name: `${K}.${button}` }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(screen.getByRole("button", { name: `${K}.confirm` }));
  return dialog;
}

describe("ManageConsentsSlot - wycofanie zgód kluczem samoobsługi (REG-14)", () => {
  it.each([
    ["withdrawMarketing", "marketing", "confirmMarketing"],
    ["withdrawPartner", "partner_sharing", "confirmPartner"],
    ["withdrawAll", "all", "confirmAll"],
  ] as const)("%s: okno z opisem skutku, potem wycofanie z kluczem i zakresem %s", async (button, purposes, sentence) => {
    renderWithQueryClient(<ManageConsentsSlot token={MANAGE_TOKEN} />);

    fireEvent.click(screen.getByRole("button", { name: `${K}.${button}` }));
    expect(await screen.findByText(`${K}.${sentence}`)).toBeInTheDocument();
    expect(h.withdraw).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: `${K}.confirm` }));
    expect(await screen.findByText(`${K}.done`)).toBeInTheDocument();
    expect(h.withdraw).toHaveBeenCalledTimes(1);
    expect(h.withdraw).toHaveBeenCalledWith({ data: { purposes, manageToken: MANAGE_TOKEN } });
  });

  it("anulowanie okna niczego nie wysyła", async () => {
    renderWithQueryClient(<ManageConsentsSlot token={MANAGE_TOKEN} />);
    fireEvent.click(screen.getByRole("button", { name: `${K}.withdrawAll` }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: `${K}.cancel` }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(h.withdraw).not.toHaveBeenCalled();
  });

  it("wynik neutralny: to samo zdanie, niezależnie od tego, co było aktywne", async () => {
    renderWithQueryClient(<ManageConsentsSlot token={MANAGE_TOKEN} />);
    await withdrawVia("withdrawMarketing");
    const first = (await screen.findByRole("status")).textContent;
    await withdrawVia("withdrawPartner");
    await waitFor(() => expect(h.withdraw).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole("status")).textContent).toBe(first);
    expect(first).toBe(`${K}.done`);
  });

  it("limit prób i awaria mają własne zdania", async () => {
    h.withdraw.mockResolvedValueOnce({ ok: false, reason: "rate_limited" });
    renderWithQueryClient(<ManageConsentsSlot token={MANAGE_TOKEN} />);
    await withdrawVia("withdrawAll");
    expect(await screen.findByText(`${K}.rateLimited`)).toBeInTheDocument();

    h.withdraw.mockRejectedValueOnce(new Error("siec"));
    await withdrawVia("withdrawAll");
    expect(await screen.findByText(`${K}.failed`)).toBeInTheDocument();
  });

  it("bez klucza gniazdo milczy", () => {
    const { container } = renderWithQueryClient(<ManageConsentsSlot token={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("brak naruszeń axe", async () => {
    const { container } = renderWithQueryClient(<ManageConsentsSlot token={MANAGE_TOKEN} />);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
