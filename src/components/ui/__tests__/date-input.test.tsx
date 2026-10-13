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

// OPS-15 / F13: wartość to ZEGAR ŚCIENNY, często strefy wydarzenia, nie
// przeglądarki. Godzina, która nie istnieje w strefie OGLĄDAJĄCEGO (luka DST),
// musi zostać tekstem 1:1 - przeliczenie przez lokalny `Date` przesuwało ją
// o godzinę przy ponownym wyborze dnia.
describe("DateInput - wall clock outside the viewer's DST gap", () => {
  const GAP = "2026-03-08T02:30";

  it("canary: the machine is in New York and 02:30 is in its gap", () => {
    process.env.TZ = "America/New_York";
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/New_York");
    expect(new Date(2026, 2, 8, 2, 30).getHours()).toBe(3);
  });

  it("keeps the original HH:mm in the field and when a new day is picked", () => {
    process.env.TZ = "America/New_York";
    const { values, onChange } = recordValues();
    const { container } = render(
      <DateInput type="datetime-local" value={GAP} onChange={onChange} />,
    );
    const input = container.querySelector("input[type='datetime-local']");
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing native input");
    expect(input.value).toBe(GAP);
    openCalendar(container);
    fireEvent.click(dayButton("10"));
    expect(values.at(-1)).toBe("2026-03-10T02:30");
  });

  it("a midnight the viewer's zone skips stays 00:00 on the same day", () => {
    process.env.TZ = "America/Santiago";
    expect(new Date(2026, 8, 6, 0, 0).getHours()).toBe(1);
    const { values, onChange } = recordValues();
    const { container } = render(
      <DateInput type="datetime-local" value="2026-09-06T00:00" onChange={onChange} />,
    );
    openCalendar(container);
    expect(document.querySelector('[data-day="2026-09-06"]')?.getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.click(dayButton("7"));
    expect(values.at(-1)).toBe("2026-09-07T00:00");
  });
});
