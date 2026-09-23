// Panel ponownego dopisania gości na ekranie potwierdzenia zapisu.
//
// CO TEN PLIK DOWODZI.
//   1. PIERWSZA ODMOWA JEST WIDOCZNA I MÓWI O GOŚCIACH - słownikiem odmów
//      `event_register_group_guests`.
//   1a. LIMIT W `group_too_large` JEST CZYTANY OD NOWA. Formularz tnie listę do
//      limitu z chwili otwarcia strony, więc ta odmowa znaczy, że limit w bazie
//      jest już niższy. Zdanie podaje liczbę WYŁĄCZNIE z odczytu po odmowie,
//      edytor przyjmuje ten limit, a za długiej listy nie da się wysłać.
//      Nieudany odczyt nie zmyśla liczby, a spóźniona odpowiedź na starszą
//      odmowę nie podpisuje się pod nowszą.
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
    loadMaxSize: () => Promise<number | null>;
  }> = {},
) {
  const onAdded = vi.fn<(added: number) => void>();
  // Domyślnie odczyt limitu nic nie wie (bilet zniknął z formularza) - panel
  // zostaje wtedy przy limicie z formularza.
  const loadMaxSize = vi.fn(over.loadMaxSize ?? (async (): Promise<number | null> => null));
  const view = renderWithQueryClient(
    <GroupGuestsRetryPanel
      registrationId={LEAD_ID}
      leadEmail="anna.kowalska@example.com"
      maxSize={over.maxSize ?? 3}
      loadMaxSize={loadMaxSize}
      initialGuests={over.initialGuests ?? GUESTS}
      initialError={over.initialError ?? new Error("group_too_large")}
      paymentRequired={over.paymentRequired ?? false}
      onAdded={onAdded}
    />,
  );
  return { ...view, onAdded, loadMaxSize };
}

/** Odczyt limitu trzymany w ręku testu - do sprawdzenia stanu „w trakcie". */
function deferredLimit(): {
  load: () => Promise<number | null>;
  answer: (value: number | null) => void;
} {
  let answer: (value: number | null) => void = () => {};
  return {
    load: () =>
      new Promise<number | null>((resolve) => {
        answer = resolve;
      }),
    answer: (value) => answer(value),
  };
}

/** Pełna treść alertu - `toHaveTextContent` z napisem dopasowuje też PODciąg. */
const alertText = () => screen.getByRole("alert").textContent;

function input(index: number, part: "first" | "last" | "email"): HTMLInputElement {
  const el = document.getElementById(`group-guest-${index}-${part}`);
  if (!(el instanceof HTMLInputElement)) throw new Error(`test: brak pola gościa ${index}`);
  return el;
}

/** Przycisk usunięcia gościa `index` - zawężenie zamiast `!`. */
function removeButton(index: number): HTMLElement {
  const button = screen.getAllByRole("button", { name: "eventRegistration.group.remove" })[index];
  if (button === undefined) throw new Error(`test: brak przycisku usunięcia gościa ${index}`);
  return button;
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
  it("pokazuje odmowę słownikiem gości, a nie słownikiem zapisu prowadzącego", () => {
    renderPanel({ initialError: new Error("sold_out") });

    expect(alertText()).toBe("eventRegistration.group.errors.soldOut");
    // Zdanie z formularza zapisu („Nie udało się zapisać") byłoby nieprawdą -
    // zgłoszenie kupującego już stoi.
    expect(screen.queryByText("eventRegistration.errors.unknown")).toBeNull();
  });

  it("odmowa inna niż limit nie czyta limitu od nowa", () => {
    const { loadMaxSize } = renderPanel({ initialError: new Error("sold_out") });

    expect(loadMaxSize).not.toHaveBeenCalled();
  });
});

describe("GroupGuestsRetryPanel - limit po odmowie group_too_large", () => {
  it("zdanie podaje limit PRZECZYTANY po odmowie, a nie ten z formularza", async () => {
    // ZMIANA ASERCJI: wcześniej ten przypadek oczekiwał `max=3` z formularza
    // przy prowadzącym i DWÓCH gościach - czyli liczby, którą lista już
    // spełniała. Baza nie odmówiłaby takiej listy limitem 3; odmawia, bo ma
    // limit niższy, i to on ma stać w zdaniu.
    const { loadMaxSize } = renderPanel({ maxSize: 5, loadMaxSize: async () => 2 });

    await waitFor(() =>
      expect(alertText()).toBe("eventRegistration.group.errors.groupTooLargeMax(max=2)"),
    );
    expect(loadMaxSize).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/max=5/)).toBeNull();
  });

  it("edytor przyjmuje aktualny limit i nie wyśle listy, która go przekracza", async () => {
    renderPanel({ maxSize: 5, loadMaxSize: async () => 2 });

    expect(await screen.findByText("eventRegistration.group.lead(max=2)")).toBeInTheDocument();
    expect(retryButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: /eventRegistration.group.add/ })).toBeDisabled();
    fireEvent.click(retryButton());
    expect(h.rpc).not.toHaveBeenCalled();

    fireEvent.click(removeButton(1));

    expect(retryButton()).not.toBeDisabled();
    fireEvent.click(retryButton());
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    expect(h.rpc.mock.calls[0]?.[1]?.p_guests).toEqual([
      { first_name: "Ewa", last_name: "Lis", email: "ewa.lis@example.com" },
    ]);
  });

  it("w trakcie odczytu zdanie nie podaje liczby - ani starej, ani zgadniętej", () => {
    const limit = deferredLimit();
    renderPanel({ maxSize: 5, loadMaxSize: limit.load });

    expect(alertText()).toBe("eventRegistration.group.errors.groupTooLarge");
    expect(screen.getByText("eventRegistration.group.lead(max=5)")).toBeInTheDocument();
  });

  it("nieudany odczyt: zdanie bez liczby, edytor przy limicie z formularza", async () => {
    const { loadMaxSize } = renderPanel({
      maxSize: 5,
      loadMaxSize: () => Promise.reject(new Error("Failed to fetch")),
    });

    await waitFor(() => expect(loadMaxSize).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(alertText()).toBe("eventRegistration.group.errors.groupTooLarge"));
    expect(screen.getByText("eventRegistration.group.lead(max=5)")).toBeInTheDocument();
    expect(retryButton()).not.toBeDisabled();
  });

  it("bilet zniknął z formularza (`null`): zdanie bez liczby", async () => {
    const { loadMaxSize } = renderPanel({ maxSize: 5, loadMaxSize: async () => null });

    await waitFor(() => expect(loadMaxSize).toHaveBeenCalledTimes(1));
    expect(alertText()).toBe("eventRegistration.group.errors.groupTooLarge");
    expect(screen.getByText("eventRegistration.group.lead(max=5)")).toBeInTheDocument();
  });

  it("kolejna odmowa limitem czyta limit ZNOWU i dopiero wtedy podaje nową liczbę", async () => {
    const second = deferredLimit();
    const reads = [async (): Promise<number | null> => 4, second.load];
    const { loadMaxSize } = renderPanel({
      maxSize: 5,
      loadMaxSize: () => (reads.shift() ?? second.load)(),
    });
    await waitFor(() =>
      expect(alertText()).toBe("eventRegistration.group.errors.groupTooLargeMax(max=4)"),
    );
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "group_too_large" } });

    fireEvent.click(retryButton());

    await waitFor(() => expect(loadMaxSize).toHaveBeenCalledTimes(2));
    // Poprzednia liczba (4) nie jest już prawdą, skoro baza odmówiła znowu -
    // zdanie czeka na nowy odczyt, a edytor trzyma ostatni znany limit.
    expect(alertText()).toBe("eventRegistration.group.errors.groupTooLarge");
    expect(screen.getByText("eventRegistration.group.lead(max=4)")).toBeInTheDocument();

    second.answer(2);

    await waitFor(() =>
      expect(alertText()).toBe("eventRegistration.group.errors.groupTooLargeMax(max=2)"),
    );
    expect(screen.getByText("eventRegistration.group.lead(max=2)")).toBeInTheDocument();
  });

  it("spóźniona odpowiedź na STARSZĄ odmowę nie nadpisuje nowszej", async () => {
    const first = deferredLimit();
    const reads = [first.load, async (): Promise<number | null> => 3];
    renderPanel({
      maxSize: 5,
      initialGuests: [EWA],
      loadMaxSize: () => (reads.shift() ?? first.load)(),
    });
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "group_too_large" } });

    // Kupujący ponawia, zanim wrócił pierwszy odczyt limitu.
    fireEvent.click(retryButton());
    await waitFor(() =>
      expect(alertText()).toBe("eventRegistration.group.errors.groupTooLargeMax(max=3)"),
    );

    first.answer(4);

    // Odpowiedź na pierwszą odmowę ląduje pod starym kluczem odczytu.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(alertText()).toBe("eventRegistration.group.errors.groupTooLargeMax(max=3)");
    expect(screen.getByText("eventRegistration.group.lead(max=3)")).toBeInTheDocument();
  });

  it("odmowa inna niż limit po ponowieniu nie wymusza nowego odczytu", async () => {
    const { loadMaxSize } = renderPanel({ maxSize: 5, loadMaxSize: async () => 4 });
    await waitFor(() =>
      expect(alertText()).toBe("eventRegistration.group.errors.groupTooLargeMax(max=4)"),
    );
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "sold_out" } });

    fireEvent.click(retryButton());

    await waitFor(() => expect(alertText()).toBe("eventRegistration.group.errors.soldOut"));
    expect(loadMaxSize).toHaveBeenCalledTimes(1);
    // Edytor trzyma aktualny limit z ostatniego odczytu.
    expect(screen.getByText("eventRegistration.group.lead(max=4)")).toBeInTheDocument();
  });
});

describe("GroupGuestsRetryPanel - lista po odmowie", () => {
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
