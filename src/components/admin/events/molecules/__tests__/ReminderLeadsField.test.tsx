// „KIEDY PRZYPOMINAĆ" - grupa pól wyboru z limitem czterech wyprzedzeń.
//
// CO TEN PLIK DOWODZI:
//  1. Kontrolka jest `fieldset` z `legend` i polami wyboru z etykietami
//     (R-A11Y) - czytnik ekranu słyszy nazwę grupy i każdą opcję.
//  2. Zaznaczenie i odznaczenie oddają NOWĄ tablicę wyprzedzeń (bez mutacji).
//  3. Przy czterech zaznaczonych pozostałe pola są WYŁĄCZONE, a podpowiedź
//     mówi, dlaczego - zaznaczone da się nadal odznaczyć.
//  4. Wartość spoza listy gotowych (np. 90 min z importu) ma własne pole,
//     żeby dało się ją odznaczyć.
//  5. Komunikat walidacji jest powiązany z grupą (`aria-describedby`,
//     `aria-invalid`), a wyłączona grupa wyłącza wszystkie pola.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-participant", () => ({ ensureI18n: () => {} }));

const { ReminderLeadsField } =
  await import("@/components/admin/events/molecules/ReminderLeadsField");

const LEADS = "adminEventParticipant.communications.leads.";

function checkbox(label: string): HTMLElement {
  return screen.getByRole("checkbox", { name: label });
}

describe("ReminderLeadsField", () => {
  it("to grupa pól z legendą i podpowiedzią; zaznaczone są wartości szkicu", () => {
    render(<ReminderLeadsField value={[1440, 60]} onChange={() => {}} />);

    const group = screen.getByRole("group", {
      name: "adminEventParticipant.communications.reminders.leadsLegend",
    });
    expect(group.getAttribute("aria-describedby")).toContain("-hint");
    expect(group.getAttribute("aria-invalid")).toBeNull();
    expect(
      screen.getByText("adminEventParticipant.communications.reminders.leadsHint"),
    ).toBeTruthy();
    expect(checkbox(`${LEADS}p1440`).getAttribute("aria-checked")).toBe("true");
    expect(checkbox(`${LEADS}p60`).getAttribute("aria-checked")).toBe("true");
    expect(checkbox(`${LEADS}p10080`).getAttribute("aria-checked")).toBe("false");
    expect(screen.getAllByRole("checkbox")).toHaveLength(8);
  });

  it("zaznaczenie dokłada wyprzedzenie do NOWEJ tablicy", () => {
    const onChange = vi.fn();
    const value = [1440];
    render(<ReminderLeadsField value={value} onChange={onChange} />);

    fireEvent.click(checkbox(`${LEADS}p15`));

    expect(onChange).toHaveBeenCalledWith([1440, 15]);
    expect(value).toEqual([1440]);
  });

  it("odznaczenie usuwa wyprzedzenie", () => {
    const onChange = vi.fn();
    render(<ReminderLeadsField value={[1440, 60]} onChange={onChange} />);

    fireEvent.click(checkbox(`${LEADS}p1440`));

    expect(onChange).toHaveBeenCalledWith([60]);
  });

  it("przy czterech zaznaczonych reszta jest WYŁĄCZONA, a podpowiedź mówi dlaczego", () => {
    const onChange = vi.fn();
    render(<ReminderLeadsField value={[10080, 1440, 60, 15]} onChange={onChange} />);

    expect(
      screen.getByText("adminEventParticipant.communications.reminders.leadsLimit"),
    ).toBeTruthy();
    expect(
      screen.queryByText("adminEventParticipant.communications.reminders.leadsHint"),
    ).toBeNull();
    expect(checkbox(`${LEADS}p720`)).toBeDisabled();
    // Zaznaczone nadal da się odznaczyć.
    expect(checkbox(`${LEADS}p60`)).not.toBeDisabled();
    fireEvent.click(checkbox(`${LEADS}p60`));
    expect(onChange).toHaveBeenCalledWith([10080, 1440, 15]);
  });

  it("wartość spoza listy gotowych ma własne pole z etykietą „N min”", () => {
    const onChange = vi.fn();
    render(<ReminderLeadsField value={[90]} onChange={onChange} />);

    const custom = checkbox(`${LEADS}custom(minutes=90)`);
    expect(custom.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(custom);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("komunikat walidacji jest powiązany z grupą i oznacza ją jako błędną", () => {
    render(<ReminderLeadsField value={[1440]} onChange={() => {}} error="Za dużo terminów" />);

    const group = screen.getByRole("group");
    expect(screen.getByRole("alert").textContent).toBe("Za dużo terminów");
    expect(group.getAttribute("aria-invalid")).toBe("true");
    const [errorId, hintId] = (group.getAttribute("aria-describedby") ?? "").split(" ");
    expect(errorId).toMatch(/-err$/);
    expect(hintId).toMatch(/-hint$/);
  });

  it("wyłączona grupa wyłącza wszystkie pola", () => {
    render(<ReminderLeadsField value={[1440]} onChange={() => {}} disabled />);

    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
  });

  it("nie ma naruszeń axe - także z komunikatem błędu i na limicie", async () => {
    const { container } = render(
      <ReminderLeadsField value={[10080, 1440, 60, 15]} onChange={() => {}} error="Błąd" />,
    );

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
