// Stany listy gości zapisu grupowego - molekuła, z której korzysta formularz zapisu
// ORAZ panel ponownego dopisania gości na ekranie potwierdzenia.
//
// CO TEN PLIK DOWODZI.
//   1. LIMIT JEST LIMITEM BILETU. Prowadzący zajmuje pierwsze miejsce, więc przy
//      `maxSize = 3` da się dodać dokładnie dwóch gości - ani jednego więcej
//      (baza odrzuciłaby całą listę jako `group_too_large`).
//   2. KAŻDY BŁĄD STOI PRZY SWOIM GOŚCIU i oznacza właściwe pole: brak nazwiska
//      to pola imienia i nazwiska, zły albo powtórzony adres to pole e-mail.
//   3. EDYCJA, DODANIE I USUNIĘCIE ODDAJĄ NOWĄ LISTĘ, a nie mutują starej -
//      rodzic (formularz albo panel ponowienia) jest jedynym właścicielem stanu.
//   4. `disabled` ZAMRAŻA LISTĘ. Panel ponowienia wysyła listę z chwili
//      kliknięcia; poprawka wpisana w trakcie żądania zniknęłaby razem z
//      edytorem po sukcesie, więc w trakcie wysyłki nic nie da się zmienić.
//   5. BEZ KONTA LISTY NIE MA - jest zdanie o logowaniu (RPC gości wymaga
//      `auth.uid()`).
//
// i18n jest zamockowane kluczami - parytetu PL/EN pilnuje bramka słowników
// i `groupGuestsFailure.test.ts`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { GroupGuest, GuestIssue } from "@/lib/events/ticketTaxGroup";
import { axeViolations, summarize } from "@/test/axe";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

const { GroupGuestsEditor } = await import("@/components/events/registration/GroupGuestsEditor");

const ANNA: GroupGuest = { firstName: "Anna", lastName: "Nowak", email: "anna.nowak@example.com" };
const JAN: GroupGuest = { firstName: "Jan", lastName: "Lis", email: "jan.lis@example.org" };

function renderEditor(
  over: Partial<{
    guests: GroupGuest[];
    issues: (GuestIssue | null)[];
    maxSize: number;
    requiresAccount: boolean;
    disabled: boolean;
  }> = {},
) {
  const onChange = vi.fn<(next: GroupGuest[]) => void>();
  const view = render(
    <GroupGuestsEditor
      guests={over.guests ?? [ANNA]}
      issues={over.issues ?? []}
      maxSize={over.maxSize ?? 3}
      requiresAccount={over.requiresAccount ?? false}
      disabled={over.disabled}
      onChange={onChange}
    />,
  );
  return { ...view, onChange };
}

function input(index: number, part: "first" | "last" | "email"): HTMLInputElement {
  const el = document.getElementById(`group-guest-${index}-${part}`);
  if (!(el instanceof HTMLInputElement)) throw new Error(`test: brak pola gościa ${index}`);
  return el;
}

const addButton = () => screen.getByRole("button", { name: /eventRegistration.group.add/ });
function removeButton(index: number): HTMLElement {
  const button = screen.getAllByRole("button", { name: "eventRegistration.group.remove" })[index];
  if (button === undefined) throw new Error(`test: brak przycisku usunięcia gościa ${index}`);
  return button;
}

afterEach(cleanup);

describe("GroupGuestsEditor - limit biletu", () => {
  it("przy limicie 3 pozwala na dwóch gości i liczy prowadzącego jako miejsce", () => {
    renderEditor({ guests: [ANNA, JAN], maxSize: 3 });

    expect(screen.getByText("eventRegistration.group.lead(max=3)")).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
    expect(screen.getByText("eventRegistration.group.seats(count=3)")).toBeInTheDocument();
    // Numeracja osób zaczyna się od 2 - pierwszym miejscem jest kupujący.
    expect(screen.getByText("eventRegistration.group.person(n=2)")).toBeInTheDocument();
    expect(screen.getByText("eventRegistration.group.person(n=3)")).toBeInTheDocument();
  });

  it("poniżej limitu dodaje PUSTEGO gościa na końcu listy", () => {
    const { onChange } = renderEditor({ guests: [ANNA], maxSize: 3 });

    fireEvent.click(addButton());

    expect(onChange).toHaveBeenCalledWith([ANNA, { firstName: "", lastName: "", email: "" }]);
  });
});

describe("GroupGuestsEditor - edycja", () => {
  it("zmiana pola oddaje nową listę z poprawionym TYLKO tym gościem", () => {
    const { onChange } = renderEditor({ guests: [ANNA, JAN] });

    fireEvent.change(input(1, "email"), { target: { value: "jan.nowy@example.org" } });
    fireEvent.change(input(0, "first"), { target: { value: "Ania" } });
    fireEvent.change(input(0, "last"), { target: { value: "Kowal" } });

    expect(onChange).toHaveBeenNthCalledWith(1, [ANNA, { ...JAN, email: "jan.nowy@example.org" }]);
    expect(onChange).toHaveBeenNthCalledWith(2, [{ ...ANNA, firstName: "Ania" }, JAN]);
    expect(onChange).toHaveBeenNthCalledWith(3, [{ ...ANNA, lastName: "Kowal" }, JAN]);
  });

  it("usunięcie oddaje listę bez wskazanej osoby", () => {
    const { onChange } = renderEditor({ guests: [ANNA, JAN] });

    fireEvent.click(removeButton(0));

    expect(onChange).toHaveBeenCalledWith([JAN]);
  });
});

describe("GroupGuestsEditor - błędy przy gościu", () => {
  it("każdy błąd stoi przy swoim gościu i oznacza właściwe pole", () => {
    renderEditor({
      guests: [ANNA, JAN, { ...JAN, email: "anna.nowak@example.com" }],
      issues: ["name", "email", "duplicate"],
      maxSize: 5,
    });

    const alerts = screen.getAllByRole("alert").map((node) => node.textContent);
    expect(alerts).toEqual([
      "eventRegistration.group.issues.name",
      "eventRegistration.group.issues.email",
      "eventRegistration.group.issues.duplicate",
    ]);
    expect(input(0, "first")).toHaveAttribute("aria-invalid", "true");
    expect(input(0, "last")).toHaveAttribute("aria-invalid", "true");
    expect(input(0, "email")).toHaveAttribute("aria-invalid", "false");
    expect(input(1, "first")).toHaveAttribute("aria-invalid", "false");
    expect(input(1, "email")).toHaveAttribute("aria-invalid", "true");
    expect(input(2, "email")).toHaveAttribute("aria-invalid", "true");
  });

  it("brak wpisu w tablicy błędów to brak błędu - bez pustego alertu", () => {
    renderEditor({ guests: [ANNA, JAN], issues: [null] });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("GroupGuestsEditor - zablokowana lista", () => {
  it("disabled blokuje pola, usuwanie i dodawanie - nawet poniżej limitu", () => {
    const { onChange } = renderEditor({ guests: [ANNA], maxSize: 5, disabled: true });

    expect(input(0, "first")).toBeDisabled();
    expect(input(0, "last")).toBeDisabled();
    expect(input(0, "email")).toBeDisabled();
    expect(removeButton(0)).toBeDisabled();
    expect(addButton()).toBeDisabled();
    fireEvent.click(addButton());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("bez `disabled` lista jest edytowalna (domyślnie odblokowana)", () => {
    renderEditor({ guests: [ANNA], maxSize: 5 });

    expect(input(0, "email")).not.toBeDisabled();
    expect(removeButton(0)).not.toBeDisabled();
    expect(addButton()).not.toBeDisabled();
  });
});

describe("GroupGuestsEditor - bez konta", () => {
  it("zamiast listy pokazuje zdanie o logowaniu", () => {
    renderEditor({ requiresAccount: true });

    expect(screen.getByText("eventRegistration.group.accountRequired")).toBeInTheDocument();
    expect(document.getElementById("group-guest-0-first")).toBeNull();
    expect(screen.queryByRole("button", { name: /eventRegistration.group.add/ })).toBeNull();
  });
});

describe("GroupGuestsEditor - dostępność", () => {
  it("lista z błędami nie ma naruszeń dostępności", async () => {
    const { container } = renderEditor({ guests: [ANNA, JAN], issues: [null, "email"] });

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
