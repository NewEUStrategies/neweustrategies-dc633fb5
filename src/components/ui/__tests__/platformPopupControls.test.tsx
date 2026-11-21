// Listy i godziny w panelu otwierają się w layoucie platformy, nie w
// systemowym popupie przeglądarki - przy zachowaniu natywnego kontraktu pola.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PlatformSelect } from "../platform-select";
import { TimeInput, minuteStepFor, withinTimeBounds } from "../time-input";

function Voice() {
  const [value, setValue] = useState("george");
  return (
    <>
      <label htmlFor="voice">Głos</label>
      <PlatformSelect id="voice" value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="george">George</option>
        <option value="sarah">Sarah</option>
        <option value="off" disabled>
          Wyłączony
        </option>
      </PlatformSelect>
      <output data-testid="out">{value}</output>
    </>
  );
}

describe("PlatformSelect - lista platformy", () => {
  it("klik blokuje systemowy popup i otwiera listę platformy", () => {
    render(<Voice />);
    const select = screen.getByLabelText("Głos");
    const prevented = !fireEvent.mouseDown(select, { button: 0 });
    expect(prevented).toBe(true);
    const list = screen.getByRole("listbox");
    expect(list.closest("[data-slot='platform-select-content']")).not.toBeNull();
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["George", "Sarah", "Wyłączony"]);
    expect(within(list).getByRole("option", { name: "George" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("wybór z listy zmienia wartość natywnego pola i wywołuje onChange", () => {
    render(<Voice />);
    fireEvent.mouseDown(screen.getByLabelText("Głos"), { button: 0 });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Sarah" }));
    expect(screen.getByTestId("out")).toHaveTextContent("sarah");
    expect(screen.getByLabelText("Głos")).toHaveValue("sarah");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opcja wyłączona nie daje się wybrać", () => {
    render(<Voice />);
    fireEvent.mouseDown(screen.getByLabelText("Głos"), { button: 0 });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Wyłączony" }));
    expect(screen.getByTestId("out")).toHaveTextContent("george");
  });

  it("klawiatura: Spacja otwiera, strzałka i Enter wybierają", () => {
    render(<Voice />);
    const select = screen.getByLabelText("Głos");
    fireEvent.keyDown(select, { key: " " });
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(screen.getByTestId("out")).toHaveTextContent("sarah");
  });

  it("wyłączone pole nie otwiera listy", () => {
    render(
      <PlatformSelect aria-label="x" disabled defaultValue="a">
        <option value="a">A</option>
      </PlatformSelect>,
    );
    fireEvent.mouseDown(screen.getByLabelText("x"), { button: 0 });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("TimeInput - wybór godziny platformy", () => {
  it("krok minut: 5 domyślnie, z `step` dla pełnych minut", () => {
    expect(minuteStepFor(undefined)).toBe(5);
    expect(minuteStepFor(900)).toBe(15);
    expect(minuteStepFor(30)).toBe(5);
  });

  it("granice min/max porównują HH:mm", () => {
    expect(withinTimeBounds("08:00", "09:00", undefined)).toBe(false);
    expect(withinTimeBounds("09:30", "09:00", "17:00")).toBe(true);
    expect(withinTimeBounds("17:05", undefined, "17:00")).toBe(false);
  });

  it("godzina i minuta z listy dają lokalne HH:mm w onChange", () => {
    const values: string[] = [];
    render(
      <>
        <label htmlFor="t">Od</label>
        <TimeInput id="t" defaultValue="" onChange={(e) => values.push(e.target.value)} />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("Od"), { key: "F4" });
    fireEvent.click(screen.getByRole("option", { name: "14" }));
    fireEvent.click(screen.getByRole("option", { name: "30" }));
    expect(values).toEqual(["14:00", "14:30"]);
    expect(screen.getByLabelText("Od")).toHaveValue("14:30");
  });
});
