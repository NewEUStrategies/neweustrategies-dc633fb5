// Ekran PO zapisie grupowym - KIEDY goście dostaną WŁASNE bilety z kodem QR.
//
// DLACZEGO TEN PLIK ISTNIEJE. Każdy gość dostaje osobny mail z biletem, ale
// moment zależy od stanu zgłoszenia prowadzącego: przyjęte - bilety wychodzą
// od razu; czeka na decyzję organizatora albo na miejsce z rezerwy - po
// przyjęciu (kaskada w bazie, 20260926100000); czeka na zapłatę - po
// zaksięgowaniu wpłaty. Bez tego zdania kupujący nie wiedział, czy goście już
// mają bilety, a organizator dostawał telefony „gość nie dostał maila" o
// grupach, które jeszcze nie były przyjęte.
//
// Osobny plik, a nie kolejny przypadek w `RegistrationConfirmationStatuses`:
// tamten pilnuje zdań o ZGŁOSZENIU prowadzącego, ten - o jego gościach.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

import type { RegistrationResult } from "@/lib/events/publicRegistrationApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => vi.fn(),
}));
vi.mock("@/lib/billing/checkout.functions", () => ({
  createCheckoutOrder: { name: "createCheckoutOrder" },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: { user: { id: "u-1" } } }) }));
vi.mock("@/lib/stripe", () => ({ getStripeEnvironment: () => "sandbox" }));
vi.mock("@/components/checkout/LazyEmbeddedCheckoutDialog", () => ({
  LazyEmbeddedCheckoutDialog: () => null,
}));

const { RegistrationConfirmation } =
  await import("@/components/events/registration/RegistrationConfirmation");

const G = "eventRegistration.group";

function result(over: Partial<RegistrationResult> = {}): RegistrationResult {
  return {
    registrationId: "11111111-1111-1111-1111-111111111111",
    eventId: "22222222-2222-2222-2222-222222222222",
    personId: null,
    status: "approved",
    decisionSource: null,
    waitlistPosition: null,
    ticketTypeId: null,
    qrToken: null,
    manageToken: null,
    paymentRequired: false,
    paymentStatus: "not_required",
    amountCents: null,
    currency: null,
    ...over,
  };
}

function renderConfirmation(
  over: Partial<RegistrationResult>,
  props: { guestsAdded?: number; cancelled?: boolean } = {},
) {
  return renderWithQueryClient(
    <RegistrationConfirmation
      result={result(over)}
      slug="kongres"
      cancelled={props.cancelled ?? false}
      cancelling={false}
      onCancel={vi.fn()}
      guestsAdded={props.guestsAdded}
    />,
  );
}

const lines = [`${G}.ticketsSent`, `${G}.ticketsAfterApproval`, `${G}.ticketsAfterPayment`];

function groupLine(): string | null {
  const hit = lines
    .flatMap((key) => screen.queryAllByText(new RegExp(`^${key.replace(/\./g, "\\.")}`)))
    .map((el) => el.textContent ?? "");
  return hit[0] ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RegistrationConfirmation - bilety gości grupy", () => {
  it("przyjęte zgłoszenie: bilety idą do gości od razu, z liczbą gości", () => {
    renderConfirmation({ status: "approved" }, { guestsAdded: 2 });
    expect(groupLine()).toBe(`${G}.ticketsSent(count=2)`);
  });

  it.each(["pending", "waitlist"] as const)(
    "zgłoszenie „%s”: bilety po przyjęciu zgłoszenia",
    (status) => {
      renderConfirmation({ status }, { guestsAdded: 1 });
      expect(groupLine()).toBe(`${G}.ticketsAfterApproval`);
    },
  );

  it("zgłoszenie czeka na zapłatę: bilety po zaksięgowaniu - nawet gdy status mówi „przyjęte”", () => {
    renderConfirmation(
      { status: "pending", paymentRequired: true, paymentStatus: "unpaid" },
      { guestsAdded: 3 },
    );
    expect(groupLine()).toBe(`${G}.ticketsAfterPayment`);
  });

  it("bez gości (domyślnie) nie ma zdania o biletach gości", () => {
    renderConfirmation({ status: "approved" });
    expect(groupLine()).toBeNull();
  });

  it("zapis odwołany w tej sesji - zdanie o biletach znika razem z zapisem", () => {
    renderConfirmation({ status: "approved" }, { guestsAdded: 2, cancelled: true });
    expect(groupLine()).toBeNull();
  });
});
