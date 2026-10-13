// Organizm „DOWIĄZANIA KONT DO KARTOTEK" (REG-01, D14) - ekran organizatora
// /admin/events/account-bindings.
//
// CO TEN PLIK DOWODZI.
//   1. ZMIANA TYLKO ZA POTWIERDZENIEM. Odwiązanie zabiera uczestnikowi panel,
//      przywrócenie oddaje kontu kartotekę - samo kliknięcie w wierszu niczego
//      nie wysyła; dopiero przycisk w oknie potwierdzenia, z identyfikatorem
//      TEGO wiersza.
//   2. PRZYWRÓCIĆ MOŻNA TYLKO TO, CO SIĘ DA. Wpis już przywrócony, wpis
//      z usuniętym kontem i kartoteka, która ma już konto, nie mają przycisku -
//      baza i tak odmówiłaby (`already_restored`, `account_deleted`,
//      `person_bound`), a przycisk bez skutku uczy organizatora ignorować ekran.
//   3. ODMOWA MÓWI ZDANIEM. Błąd bazy idzie przez mapę odmów panelu, nie
//      surową treścią.
//   4. PUSTE LISTY MAJĄ ZDANIE - po naprawie historii lista niezweryfikowanych
//      jest zwykle pusta i to ma wyglądać jak stan, nie jak awaria.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import type {
  AccountBindingsOverview,
  AccountUnbindEntry,
  SuspectAccountBinding,
  UnverifiedAccountBinding,
} from "@/lib/events/accountBindingsAdminApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  pobierz: vi.fn<() => Promise<AccountBindingsOverview>>(),
  odwiaz: vi.fn<(personId: string) => Promise<string | null>>(),
  przywroc: vi.fn<(unbindId: string) => Promise<void>>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/events/adminRegistrationErrors", () => ({
  adminRegistrationErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message.split(":")[0] : String(error)}`,
}));
vi.mock("@/lib/events/accountBindingsAdminApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/accountBindingsAdminApi")>()),
  fetchAccountBindings: () => h.pobierz(),
  unbindPersonAccount: (personId: string) => h.odwiaz(personId),
  restorePersonAccount: (unbindId: string) => h.przywroc(unbindId),
}));

const { AccountBindingsPanel } =
  await import("@/components/admin/events/organisms/AccountBindingsPanel");

function niezweryfikowane(over: Partial<UnverifiedAccountBinding> = {}): UnverifiedAccountBinding {
  return {
    personId: "p-lena",
    firstName: "Lena",
    lastName: "Ofiara",
    email: "lena@example.com",
    accountEmailHint: "x***@example.com",
    accountEmailConfirmed: true,
    risk: "foreign_record",
    registrationsByAccount: 1,
    ...over,
  };
}

function wpis(over: Partial<AccountUnbindEntry> = {}): AccountUnbindEntry {
  return {
    id: "u-1",
    personId: "p-1",
    firstName: "Karol",
    lastName: "Stary",
    email: "k@example.com",
    accountEmailHint: "k***@example.com",
    risk: "self_created",
    reason: "reg01_remediation",
    registrationsByAccount: 0,
    unboundAt: "2026-10-12T19:00:00Z",
    restoredAt: null,
    accountDeleted: false,
    personBound: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.pobierz.mockResolvedValue({ unverified: [], suspect: [], unbinds: [] });
  h.odwiaz.mockResolvedValue("u-new");
  h.przywroc.mockResolvedValue(undefined);
});

describe("AccountBindingsPanel - listy", () => {
  it("puste listy mają zdanie stanu, nie pustkę", async () => {
    renderWithQueryClient(<AccountBindingsPanel />);

    expect(await screen.findByText("adminEventRegistration.bindings.unverifiedEmpty")).toBeTruthy();
    expect(screen.getByText("adminEventRegistration.bindings.unbindsEmpty")).toBeTruthy();
  });

  it("wiersz niezweryfikowany pokazuje ryzyko i ZAMASKOWANY adres konta", async () => {
    h.pobierz.mockResolvedValue({ unverified: [niezweryfikowane()], suspect: [], unbinds: [] });
    renderWithQueryClient(<AccountBindingsPanel />);

    expect(await screen.findByText("Lena Ofiara")).toBeTruthy();
    expect(screen.getByText(/x\*\*\*@example\.com/)).toBeTruthy();
    expect(screen.getByText("adminEventRegistration.bindings.risk.foreign_record")).toBeTruthy();
  });

  it("błąd odczytu to zdanie z mapy odmów", async () => {
    h.pobierz.mockRejectedValue(new Error("forbidden: admin role required"));
    renderWithQueryClient(<AccountBindingsPanel />);

    expect(await screen.findByText("odmowa:forbidden")).toBeTruthy();
  });
});

function podejrzane(over: Partial<SuspectAccountBinding> = {}): SuspectAccountBinding {
  return {
    personId: "p-vera",
    firstName: "Vera",
    lastName: "Victim",
    email: "attacker@example.com",
    accountEmailHint: "a***@example.com",
    mailsElsewhere: 2,
    registrationsByOthers: 0,
    ...over,
  };
}

describe("AccountBindingsPanel - lista przeglądu (R12)", () => {
  it("pusta lista przeglądu ma zdanie stanu", async () => {
    renderWithQueryClient(<AccountBindingsPanel />);
    expect(await screen.findByText("adminEventRegistration.bindings.suspectEmpty")).toBeTruthy();
  });

  it("wiersz z sygnałem przejęcia pokazuje sygnały i odwiązuje TĘ osobę za potwierdzeniem", async () => {
    h.pobierz.mockResolvedValue({
      unverified: [],
      suspect: [podejrzane()],
      unbinds: [],
    });
    renderWithQueryClient(<AccountBindingsPanel />);

    const wiersz = (await screen.findByText("Vera Victim")).closest("li");
    if (wiersz === null) throw new Error("test: brak wiersza Very");
    expect(
      within(wiersz).getByText("adminEventRegistration.bindings.risk.suspect_takeover"),
    ).toBeTruthy();
    expect(
      within(wiersz).getByText(/adminEventRegistration\.bindings\.mailsElsewhere/),
    ).toBeTruthy();
    // Sygnał o wartości 0 nie dostaje wiersza - organizator widzi tylko to, co jest.
    expect(within(wiersz).queryByText(/registrationsByOthers/)).toBeNull();

    fireEvent.click(
      within(wiersz).getByRole("button", { name: /adminEventRegistration\.bindings\.unbind/ }),
    );
    expect(h.odwiaz).not.toHaveBeenCalled();
    const okno = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(okno).getByRole("button", { name: /adminEventRegistration\.bindings\.unbind/ }),
    );
    await waitFor(() => expect(h.odwiaz).toHaveBeenCalledWith("p-vera"));
  });

  it("odpowiedź starej bazy bez listy przeglądu nie wywraca ekranu", async () => {
    h.pobierz.mockResolvedValue({
      unverified: [niezweryfikowane()],
      unbinds: [],
    } as unknown as AccountBindingsOverview);
    renderWithQueryClient(<AccountBindingsPanel />);
    expect(await screen.findByText("Lena Ofiara")).toBeTruthy();
    expect(screen.getByText("adminEventRegistration.bindings.suspectEmpty")).toBeTruthy();
  });
});

describe("AccountBindingsPanel - odwiązanie i przywrócenie za potwierdzeniem", () => {
  it("odwiązanie: kliknięcie w wierszu NIC nie wysyła, potwierdzenie wysyła TĘ osobę", async () => {
    h.pobierz.mockResolvedValue({
      unverified: [niezweryfikowane(), niezweryfikowane({ personId: "p-ewa", firstName: "Ewa" })],
      suspect: [],
      unbinds: [],
    });
    renderWithQueryClient(<AccountBindingsPanel />);

    const wiersz = (await screen.findByText("Ewa Ofiara")).closest("li");
    if (wiersz === null) throw new Error("test: brak wiersza Ewy");
    fireEvent.click(
      within(wiersz).getByRole("button", { name: /adminEventRegistration\.bindings\.unbind/ }),
    );
    expect(h.odwiaz).not.toHaveBeenCalled();

    const okno = await screen.findByRole("alertdialog");
    expect(within(okno).getByText("adminEventRegistration.bindings.unbindConfirm")).toBeTruthy();
    fireEvent.click(
      within(okno).getByRole("button", { name: /adminEventRegistration\.bindings\.unbind/ }),
    );

    await waitFor(() => expect(h.odwiaz).toHaveBeenCalledWith("p-ewa"));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventRegistration.bindings.unbound"),
    );
  });

  it("anulowanie okna nie wysyła niczego", async () => {
    h.pobierz.mockResolvedValue({ unverified: [niezweryfikowane()], suspect: [], unbinds: [] });
    renderWithQueryClient(<AccountBindingsPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: /adminEventRegistration\.bindings\.unbind/ }),
    );
    const okno = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(okno).getByRole("button", { name: "adminEventRegistration.bindings.cancel" }),
    );

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(h.odwiaz).not.toHaveBeenCalled();
  });

  it("przywrócenie: tylko wpis, który da się przywrócić, ma przycisk", async () => {
    h.pobierz.mockResolvedValue({
      unverified: [],
      suspect: [],
      unbinds: [
        wpis({ id: "u-ok", firstName: "Otwarty" }),
        wpis({ id: "u-done", firstName: "Przywrocony", restoredAt: "2026-10-12T20:00:00Z" }),
        wpis({ id: "u-del", firstName: "Usuniety", accountDeleted: true }),
        wpis({ id: "u-bound", firstName: "Zajety", personBound: true }),
      ],
    });
    renderWithQueryClient(<AccountBindingsPanel />);

    await screen.findByText("Otwarty Stary");
    const przyciski = screen.getAllByRole("button", {
      name: /adminEventRegistration\.bindings\.restore/,
    });
    expect(przyciski).toHaveLength(1);
    expect(screen.getByText(/adminEventRegistration\.bindings\.accountDeleted/)).toBeTruthy();
    expect(screen.getByText("adminEventRegistration.bindings.personBound")).toBeTruthy();

    fireEvent.click(przyciski[0] as HTMLElement);
    expect(h.przywroc).not.toHaveBeenCalled();
    const okno = await screen.findByRole("alertdialog");
    expect(within(okno).getByText("adminEventRegistration.bindings.restoreConfirm")).toBeTruthy();
    fireEvent.click(
      within(okno).getByRole("button", { name: /adminEventRegistration\.bindings\.restore/ }),
    );

    await waitFor(() => expect(h.przywroc).toHaveBeenCalledWith("u-ok"));
  });

  it("odmowa bazy przy przywróceniu to zdanie z mapy odmów", async () => {
    h.przywroc.mockRejectedValue(new Error("account_in_use: this account is linked elsewhere"));
    h.pobierz.mockResolvedValue({ unverified: [], suspect: [], unbinds: [wpis()] });
    renderWithQueryClient(<AccountBindingsPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: /adminEventRegistration\.bindings\.restore/ }),
    );
    const okno = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(okno).getByRole("button", { name: /adminEventRegistration\.bindings\.restore/ }),
    );

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:account_in_use"));
  });
});

describe("AccountBindingsPanel - dostępność", () => {
  it("wszystkie listy z wierszami nie mają naruszeń axe", async () => {
    h.pobierz.mockResolvedValue({
      unverified: [niezweryfikowane()],
      suspect: [podejrzane()],
      unbinds: [wpis()],
    });
    const { container } = renderWithQueryClient(<AccountBindingsPanel />);
    await screen.findByText("Lena Ofiara");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
