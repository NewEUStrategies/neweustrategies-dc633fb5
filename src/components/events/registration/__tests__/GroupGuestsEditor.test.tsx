// Molekuła „Lista gości zapisu grupowego" - imię, nazwisko i adres każdej
// osoby, za którą prowadzący płaci jednym zamówieniem.
//
// CO TEN PLIK DOWODZI.
//   1. BEZ KONTA NIE MA PÓL. Dopisanie gości wymaga zalogowania (baza wpuszcza
//      tylko `authenticated`), więc zamiast pól stoi zdanie o logowaniu - nawet
//      gdy lista nie jest pusta.
//   2. PROWADZĄCY ZAJMUJE PIERWSZE MIEJSCE. Numeracja gości zaczyna się od 2,
//      licznik miejsc liczy prowadzącego, a limit dodawania to `maxSize - 1`.
//   3. KOMPONENT JEST STEROWANY I NIE MUTUJE LISTY. Wpis w polu, dodanie i
//      usunięcie oddają NOWĄ listę przez `onChange`, zmienioną tylko w jednym
//      miejscu; lista z propsów zostaje nietknięta.
//   4. PROBLEM GOŚCIA STOI PRZY TYM GOŚCIU i oznacza właściwe pola: problem
//      z nazwą - imię i nazwisko, problem z adresem albo duplikat - adres.
//      Brak wpisu o problemie nie wymyśla problemu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Reguł, które wyznaczają problemy (`guestIssues`) -
// ma je `lib/events/__tests__/ticketTaxGroup.test.ts`. Drogi listy do bazy -
// ma ją `PublicRegistrationFormGroupGuests.test.tsx`; tutaj problemy podaje
// test, bo przedmiotem dowodu jest to, jak molekuła je pokazuje.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { GroupGuest, GuestIssue } from "@/lib/events/ticketTaxGroup";

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  onChange: vi.fn<(next: GroupGuest[]) => void>(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

// Odnośnik do logowania (wariant bez konta) potrzebuje routera - tu stoi
// zwykła kotwica z prawdziwym adresem.
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { GroupGuestsEditor } from "@/components/events/registration/GroupGuestsEditor";

const G = "eventRegistration.group";

const EWA: GroupGuest = { firstName: "Ewa", lastName: "Nowak", email: "ewa.nowak@example.org" };
const JAN: GroupGuest = {
  firstName: "Jan",
  lastName: "Wiśniewski",
  email: "jan.wisniewski@example.org",
};
const OLA: GroupGuest = { firstName: "Ola", lastName: "Zając", email: "ola.zajac@example.org" };

function lista({
  guests = [],
  issues = [],
  maxSize = 10,
  requiresAccount = false,
}: {
  guests?: GroupGuest[];
  issues?: (GuestIssue | null)[];
  maxSize?: number;
  requiresAccount?: boolean;
} = {}) {
  return render(
    <GroupGuestsEditor
      guests={guests}
      issues={issues}
      maxSize={maxSize}
      requiresAccount={requiresAccount}
      onChange={h.onChange}
    />,
  );
}

const gosc = (seat: number): HTMLElement =>
  screen.getByRole("group", { name: `${G}.person(n=${seat})` });

const pole = (seat: number, field: "firstName" | "lastName" | "email"): HTMLElement =>
  within(gosc(seat)).getByLabelText(`eventRegistration.fields.${field}`);

/** Ostatnia lista oddana przez `onChange`. */
function oddana(): GroupGuest[] {
  const last = h.onChange.mock.calls.at(-1);
  if (last === undefined) throw new Error("onChange nie zostal wywolany");
  return last[0];
}

beforeEach(() => {
  h.lang = "pl";
  h.onChange.mockReset();
});

describe("lista gości bez konta", () => {
  it("zamiast pól stoi zdanie o logowaniu, nawet gdy lista nie jest pusta", () => {
    lista({ guests: [EWA], requiresAccount: true });

    expect(screen.getByText(`${G}.accountRequired`)).toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `${G}.add` })).not.toBeInTheDocument();
  });

  it("zdanie o logowaniu ma drogę do logowania - samo zdanie zostawiało gościa bez wyjścia", () => {
    // Bez konta baza gości nie dopisze (`account_required`), a formularz
    // zapisałby samego prowadzącego. Odnośnik jest ten sam, co przy płatnej
    // wejściówce.
    lista({ requiresAccount: true });

    const link = screen.getByRole("link", { name: `${G}.signIn` });
    expect(link).toHaveAttribute("href", "/login");
  });

  it("z kontem odnośnika do logowania nie ma", () => {
    lista();

    expect(screen.queryByRole("link", { name: `${G}.signIn` })).not.toBeInTheDocument();
  });

  it("nagłówek mówi, ile osób łącznie obejmuje zapis", () => {
    lista({ requiresAccount: true, maxSize: 6 });

    expect(screen.getByRole("heading", { name: `${G}.title` })).toBeInTheDocument();
    expect(screen.getByText(`${G}.lead(max=6)`)).toBeInTheDocument();
  });
});

describe("miejsca w zamówieniu", () => {
  it("pusta lista liczy samego prowadzącego, a dodanie dokłada pustą osobę", () => {
    lista();

    expect(screen.getByText(`${G}.seats(count=1)`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `${G}.add` }));
    expect(oddana()).toEqual([{ firstName: "", lastName: "", email: "" }]);
  });

  it("goście są numerowani od 2 - pierwsze miejsce należy do prowadzącego", () => {
    lista({ guests: [EWA, JAN] });

    expect(gosc(2)).toBeInTheDocument();
    expect(gosc(3)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: `${G}.person(n=1)` })).not.toBeInTheDocument();
    expect(screen.getByText(`${G}.seats(count=3)`)).toBeInTheDocument();
    expect(pole(3, "email")).toHaveValue(JAN.email);
  });

  it("przy komplecie (prowadzący + goście = limit) dodawanie jest zgaszone", () => {
    lista({ guests: [EWA, JAN], maxSize: 3 });

    expect(screen.getByRole("button", { name: `${G}.add` })).toBeDisabled();
  });

  it("o jedno miejsce przed kompletem dodawanie jeszcze działa", () => {
    lista({ guests: [EWA], maxSize: 3 });

    const dodaj = screen.getByRole("button", { name: `${G}.add` });
    expect(dodaj).not.toBeDisabled();
    fireEvent.click(dodaj);
    expect(oddana()).toEqual([EWA, { firstName: "", lastName: "", email: "" }]);
  });
});

describe("edycja listy", () => {
  it.each<["firstName" | "lastName" | "email", string]>([
    ["firstName", "Janina"],
    ["lastName", "Kowalczyk"],
    ["email", "janina@example.org"],
  ])("wpis w polu %s zmienia tylko tego gościa i tylko to pole", (field, value) => {
    const guests = [EWA, JAN, OLA];
    lista({ guests });

    fireEvent.change(pole(3, field), { target: { value } });

    expect(oddana()).toEqual([EWA, { ...JAN, [field]: value }, OLA]);
    expect(guests).toEqual([EWA, JAN, OLA]);
  });

  it("kosz usuwa właściwą osobę, a reszta zostaje w kolejności", () => {
    const guests = [EWA, JAN, OLA];
    lista({ guests });

    fireEvent.click(within(gosc(3)).getByRole("button", { name: `${G}.remove` }));

    expect(oddana()).toEqual([EWA, OLA]);
    expect(guests).toHaveLength(3);
  });
});

describe("problemy gości", () => {
  it.each<[GuestIssue, boolean, boolean]>([
    ["name", true, false],
    ["email", false, true],
    ["duplicate", false, true],
  ])("problem „%s” stoi przy gościu i oznacza właściwe pola", (issue, nazwa, adres) => {
    lista({ guests: [EWA, JAN], issues: [null, issue] });

    expect(within(gosc(3)).getByRole("alert")).toHaveTextContent(`${G}.issues.${issue}`);
    expect(within(gosc(2)).queryByRole("alert")).not.toBeInTheDocument();
    expect(pole(3, "firstName")).toHaveAttribute("aria-invalid", String(nazwa));
    expect(pole(3, "lastName")).toHaveAttribute("aria-invalid", String(nazwa));
    expect(pole(3, "email")).toHaveAttribute("aria-invalid", String(adres));
    expect(pole(2, "email")).toHaveAttribute("aria-invalid", "false");
  });

  it("lista problemów krótsza niż lista gości nie wymyśla problemu", () => {
    lista({ guests: [EWA, JAN], issues: ["email"] });

    expect(within(gosc(2)).getByRole("alert")).toHaveTextContent(`${G}.issues.email`);
    expect(within(gosc(3)).queryByRole("alert")).not.toBeInTheDocument();
    expect(pole(3, "email")).toHaveAttribute("aria-invalid", "false");
  });
});
