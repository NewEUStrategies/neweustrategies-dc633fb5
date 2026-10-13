import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DateInput } from "../date-input";

// `onChange` dostaje prawdziwe ChangeEvent: wartość czytamy W CHWILI
// zdarzenia, bo kontrolowane pole bez aktualizacji stanu React przywraca.
function recordValues() {
  const values: string[] = [];
  const onChange = (event: { target: { value: string } }) => values.push(event.target.value);
  return { values, onChange };
}

function openCalendar(container: HTMLElement) {
  const opener = container.querySelector("[data-calendar-opener]");
  if (!opener) throw new Error("Missing calendar opener");
  fireEvent.click(opener);
}

function dayButton(day: string) {
  const button = screen
    .getAllByRole("button")
    .find((candidate) => candidate.textContent?.trim() === day && candidate.closest("td"));
  if (!button) throw new Error(`Missing day ${day}`);
  return button;
}

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

describe("DateInput local values", () => {
  it("clears a date using the existing empty-string contract", () => {
    const { values, onChange } = recordValues();
    const { container } = render(<DateInput type="date" value="2026-10-12" onChange={onChange} />);
    openCalendar(container);
    fireEvent.click(screen.getByRole("button", { name: "Wyczyść" }));
    expect(values.at(-1)).toBe("");
  });

  it("changes an hour without shifting the local day or minute", () => {
    const { values, onChange } = recordValues();
    const { container } = render(
      <DateInput type="datetime-local" value="2026-10-12T08:17" onChange={onChange} />,
    );
    openCalendar(container);
    fireEvent.change(screen.getByLabelText("Godzina"), { target: { value: "09:17" } });
    expect(values.at(-1)).toBe("2026-10-12T09:17");
  });

  it("submits the original date string", () => {
    const { container } = render(
      <form>
        <DateInput name="day" type="date" value="2026-10-12" onChange={() => {}} />
      </form>,
    );
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    expect(new FormData(form).get("day")).toBe("2026-10-12");
  });

  it("labels exactly one native input, also inside a wrapping label", () => {
    render(
      <>
        <label htmlFor="start">Start</label>
        <DateInput id="start" type="date" value="2026-08-17" onChange={() => {}} />
        <label>
          End
          <DateInput type="datetime-local" value="2026-08-18T10:30" onChange={() => {}} />
        </label>
      </>,
    );
    const start = screen.getByLabelText("Start");
    expect(start).toBeInstanceOf(HTMLInputElement);
    expect(start).toHaveAttribute("type", "date");
    expect(start).toHaveValue("2026-08-17");
    expect(screen.getByLabelText("End")).toHaveValue("2026-08-18T10:30");
  });

  it.each(["America/Los_Angeles", "Pacific/Auckland"])(
    "picks a calendar day as a local YYYY-MM-DD string in %s",
    (tz) => {
      process.env.TZ = tz;
      const { values, onChange } = recordValues();
      const { container } = render(
        <DateInput type="date" value="2026-10-12" onChange={onChange} />,
      );
      openCalendar(container);
      fireEvent.click(dayButton("15"));
      expect(values.at(-1)).toBe("2026-10-15");
    },
  );

  it("keeps the chosen time when a new day is picked", () => {
    const { values, onChange } = recordValues();
    const { container } = render(
      <DateInput type="datetime-local" value="2026-10-12T08:17" onChange={onChange} />,
    );
    openCalendar(container);
    fireEvent.click(dayButton("20"));
    expect(values.at(-1)).toBe("2026-10-20T08:17");
  });

  it("keeps the time disabled until a date exists", () => {
    const { container } = render(<DateInput type="datetime-local" value="" onChange={() => {}} />);
    openCalendar(container);
    expect(screen.getByLabelText("Godzina")).toBeDisabled();
  });

  it("stores an uncontrolled calendar pick in FormData", () => {
    const { container } = render(
      <form>
        <DateInput name="day" type="date" defaultValue="2026-10-12" />
      </form>,
    );
    openCalendar(container);
    fireEvent.click(dayButton("21"));
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    expect(new FormData(form).get("day")).toBe("2026-10-21");
  });

  it("updates a controlled parent through the calendar", () => {
    function Controlled() {
      const [day, setDay] = useState("2026-10-12");
      return (
        <>
          <DateInput
            aria-label="Day"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
          <output>{day}</output>
        </>
      );
    }
    const { container } = render(<Controlled />);
    openCalendar(container);
    fireEvent.click(dayButton("3"));
    expect(screen.getByLabelText("Day")).toHaveValue("2026-10-03");
    expect(screen.getByRole("status")).toHaveTextContent("2026-10-03");
  });

  it("uses native validity and skips a disabled field", () => {
    const { container } = render(
      <form>
        <DateInput name="required" type="date" required value="" onChange={() => {}} />
        <DateInput name="locked" type="date" disabled value="2026-10-12" onChange={() => {}} />
      </form>,
    );
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    expect(form.checkValidity()).toBe(false);
    expect(new FormData(form).has("locked")).toBe(false);
  });
});
