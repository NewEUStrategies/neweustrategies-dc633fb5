// Panel ponownego dopisania gości na ekranie potwierdzenia zapisu.
//
// CO TEN PLIK DOWODZI.
//   1. PIERWSZA ODMOWA JEST WIDOCZNA I MÓWI O GOŚCIACH - słownikiem odmów
//      `event_register_group_guests`, z limitem biletu przy `group_too_large`.
//   2. LISTA WRACA WYPEŁNIONA. Goście wpisani w formularzu stoją w polach i da
//      się ich poprawić - kupujący nie przepisuje niczego od nowa.
//   3. PONOWIENIE IDZIE DO TEGO SAMEGO ZGŁOSZENIA i wysyła listę po poprawkach,
//      tym samym RPC i w tym samym kształcie, co formularz.
//   4. W TRAKCIE WYSYŁKI NIC NIE DA SIĘ KLIKNĄĆ DRUGI RAZ: przycisk i lista są
//      zablokowane, więc dwa kliknięcia nie wysyłają dwóch żądań.
//   5. SUKCES CHOWA LISTĘ I BŁĄD, mówi, ile osób dopisano, i woła `onAdded`
//      (formularz wysyła wtedy bilety z kodem QR).
//   6. KOLEJNA ODMOWA ZOSTAWIA LISTĘ i podmienia zdanie na nowe - np. adres
//      gościa, który ma już zapis.
//   7. BŁĘDNY GOŚĆ ZATRZYMUJE PONOWIENIE U SIEBIE, bez wywołania RPC.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta Supabase i i18n (kluczami - parytetu
// PL/EN pilnuje `groupGuestsFailure.test.ts`). `registerGroupGuests`,
// `guestIssues`, `groupGuestsFailure` i `GroupGuestsEditor` jadą PRAWDZIWE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { GroupGuest } from "@/lib/events/ticketTaxGroup";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

const h = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args?: Record<string, unknown>) => Promise<RpcResult>>(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => h.rpc(name, args) },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const { GroupGuestsRetryPanel } =
  await import("@/components/events/registration/organisms/GroupGuestsRetryPanel");

const LEAD_ID = "22222222-2222-2222-2222-222222222222";
const GROUP_RPC = "event_register_group_guests";
const EWA: GroupGuest = { firstName: "Ewa", lastName: "Lis", email: "ewa.lis@example.com" };
const JAN: GroupGuest = { firstName: "Jan", lastName: "Nowak", email: "jan.nowak@example.org" };
const GUESTS: GroupGuest[] = [EWA, JAN];

function renderPanel(
  over: Partial<{
    initialGuests: GroupGuest[];
    initialError: unknown;
    paymentRequired: boolean;
    maxSize: number;
  }> = {},
) {
  const onAdded = vi.fn<(added: number) => void>();
  const view = renderWithQueryClient(
    <GroupGuestsRetryPanel
      registrationId={LEAD_ID}
      leadEmail="anna.kowalska@example.com"
      maxSize={over.maxSize ?? 3}
      initialGuests={over.initialGuests ?? GUESTS}
      initialError={over.initialError ?? new Error("group_too_large")}
      paymentRequired={over.paymentRequired ?? false}
      onAdded={onAdded}
    />,
  );
  return { ...view, onAdded };
}

function input(index: number, part: "first" | "last" | "email"): HTMLInputElement {
  const el = document.getElementById(`group-guest-${index}-${part}`);
  if (!(el instanceof HTMLInputElement)) throw new Error(`test: brak pola gościa ${index}`);
  return el;
}

const retryButton = () =>
  screen.getByRole("button", { name: /eventRegistration.group.retry.(submit|submitting)/ });

/** Odpowiedź RPC trzymana w ręku testu - do sprawdzenia stanu „w trakcie". */
function deferredRpc(): (result: RpcResult) => void {
  let release: (result: RpcResult) => void = () => {};
  h.rpc.mockImplementationOnce(
    () =>
      new Promise<RpcResult>((resolve) => {
        release = resolve;
      }),
  );
  return (result) => release(result);
}

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: { added: 2, registration_ids: [] }, error: null });
});

afterEach(cleanup);

describe("GroupGuestsRetryPanel - stan po odmowie", () => {
  it("pokazuje odmowę słownikiem gości, z limitem biletu", () => {
    renderPanel({ maxSize: 3 });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "eventRegistration.group.errors.groupTooLargeMax(max=3)",
    );
    // Zdanie z formularza zapisu („Nie udało się zapisać") byłoby nieprawdą -
    // zgłoszenie kupującego już stoi.
    expect(screen.queryByText("eventRegistration.errors.unknown")).toBeNull();
  });

  it("lista wraca wypełniona gośćmi z formularza i da się ją poprawić", () => {
    renderPanel();

    expect(input(0, "first")).toHaveValue("Ewa");
    expect(input(0, "email")).toHaveValue("ewa.lis@example.com");
    expect(input(1, "last")).toHaveValue("Nowak");
    expect(input(1, "email")).not.toBeDisabled();
    expect(screen.getByText("eventRegistration.group.lead(max=3)")).toBeInTheDocument();
    expect(screen.getByText("eventRegistration.group.retry.hint")).toBeInTheDocument();
    expect(retryButton()).toHaveTextContent("eventRegistration.group.retry.submit");
    expect(retryButton()).not.toBeDisabled();
  });

  it("przy zgłoszeniu do zapłaty prosi o gości PRZED kasą", () => {
    renderPanel({ paymentRequired: true });

    expect(screen.getByText("eventRegistration.group.retry.beforePayment")).toBeInTheDocument();
  });

  it("przy zgłoszeniu bez płatności nie mówi o kasie", () => {
    renderPanel({ paymentRequired: false });

    expect(screen.queryByText("eventRegistration.group.retry.beforePayment")).toBeNull();
  });
});

describe("GroupGuestsRetryPanel - ponowienie", () => {
  it("wysyła poprawioną listę do TEGO SAMEGO zgłoszenia i blokuje się w trakcie", async () => {
    const release = deferredRpc();
    const { onAdded } = renderPanel();
    fireEvent.change(input(1, "email"), { target: { value: " JAN.NOWY@example.org " } });

    fireEvent.click(retryButton());

    await waitFor(() => expect(retryButton()).toBeDisabled());
    expect(retryButton()).toHaveTextContent("eventRegistration.group.retry.submitting");
    expect(input(0, "first")).toBeDisabled();
    // Drugie kliknięcie w trakcie żądania nie wysyła drugiej listy.
    fireEvent.click(retryButton());
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith(GROUP_RPC, {
      p_lead_registration_id: LEAD_ID,
      p_guests: [
        { first_name: "Ewa", last_name: "Lis", email: "ewa.lis@example.com" },
        { first_name: "Jan", last_name: "Nowak", email: "jan.nowy@example.org" },
      ],
    });

    release({ data: { added: 2, registration_ids: [] }, error: null });

    expect(
      await screen.findByText("eventRegistration.group.retry.added(count=2)"),
    ).toBeInTheDocument();
    expect(onAdded).toHaveBeenCalledWith(2);
  });

  it("sukces chowa listę i odmowę - zostaje samo zdanie o dopisanych osobach", async () => {
    renderPanel();

    fireEvent.click(retryButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "eventRegistration.group.retry.added(count=2)",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.getElementById("group-guest-0-first")).toBeNull();
    expect(screen.queryByRole("button", { name: /eventRegistration.group.retry/ })).toBeNull();
  });

  it("kolejna odmowa zostawia listę i mówi, KTÓRY gość ma już zapis", async () => {
    h.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "already_registered: jan.nowak@example.org" },
    });
    const { onAdded } = renderPanel();

    fireEvent.click(retryButton());

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "eventRegistration.group.errors.alreadyRegistered(email=jan.nowak@example.org)",
      ),
    );
    expect(input(1, "email")).toHaveValue("jan.nowak@example.org");
    expect(retryButton()).not.toBeDisabled();
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("błędny gość zatrzymuje ponowienie u siebie, a poprawka zdejmuje błąd", async () => {
    renderPanel();
    fireEvent.change(input(0, "email"), { target: { value: "anna.kowalska@example.com" } });

    fireEvent.click(retryButton());

    // Prowadzący nie może być własnym gościem - ten sam warunek, co w formularzu.
    expect(await screen.findByText("eventRegistration.group.issues.duplicate")).toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();

    fireEvent.change(input(0, "email"), { target: { value: "ewa.lis@example.com" } });
    expect(screen.queryByText("eventRegistration.group.issues.duplicate")).toBeNull();
  });

  it("pusta lista nie ma czego wysłać - przycisk jest nieaktywny", () => {
    renderPanel({ initialGuests: [EWA] });

    fireEvent.click(screen.getByRole("button", { name: "eventRegistration.group.remove" }));

    expect(retryButton()).toBeDisabled();
    fireEvent.click(retryButton());
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("limit biletu obowiązuje także przy ponowieniu", () => {
    renderPanel({ maxSize: 3 });

    expect(screen.getByRole("button", { name: /eventRegistration.group.add/ })).toBeDisabled();
  });
});

describe("GroupGuestsRetryPanel - dostępność", () => {
  it("panel z odmową i listą nie ma naruszeń dostępności", async () => {
    const { container } = renderPanel();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
