import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DateInput } from "../date-input";

describe("DateInput local values", () => {
  it("clears a date using the existing empty-string contract", () => {
    const onChange = vi.fn();
    render(<DateInput type="date" value="2026-10-12" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Wyczyść" }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: "" } });
  });
  it("changes an hour without shifting the local day or minute", () => {
    const onChange = vi.fn();
    render(<DateInput type="datetime-local" value="2026-10-12T08:17" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "12.10.2026, 08:17" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Godzina" }));
    fireEvent.click(screen.getByRole("option", { name: "09" }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: "2026-10-12T09:17" } });
  });
  it("submits the original date string", () => {
    const { container } = render(
      <form>
        <DateInput name="day" type="date" value="2026-10-12" />
      </form>,
    );
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    expect(new FormData(form).get("day")).toBe("2026-10-12");
  });
});
// F13: THE VALUE IS A WALL CLOCK IN SOMEONE ELSE'S ZONE. Event-zone fields
// (ticket phases, meeting invites, event codes, availability) hand DateInput a
// Warsaw clock while the organizer's browser runs in New York. 2026-03-08 is
// the US spring-forward night (02:00-02:59 does not exist in New York) but an
// ordinary night in Warsaw (EU switches on 29.03). Reading the value through a
// browser-local `Date` showed 03:30 and re-committed 03:30 - a one-hour move
// of the saved instant. Each case below fails on that implementation.
describe("DateInput - wall clock outside the viewer's DST gap", () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  const GAP = "2026-03-08T02:30";

  it("canary: the machine really is in New York and 02:30 is in its gap", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/New_York");
    expect(new Date(2026, 2, 8, 2, 30).getHours()).toBe(3);
  });

  it("shows the original HH:mm, not the browser-normalised one", () => {
    render(<DateInput type="datetime-local" value={GAP} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "08.03.2026, 02:30" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "08.03.2026, 03:30" })).toBeNull();
  });

  it("re-picking a day keeps the original time text", () => {
    const onChange = vi.fn();
    render(<DateInput type="datetime-local" value={GAP} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "08.03.2026, 02:30" }));
    const selected = document.querySelector('[data-day="2026-03-08"]');
    expect(selected?.getAttribute("aria-selected")).toBe("true");
    const next = document.querySelector('[data-day="2026-03-10"] button');
    if (!(next instanceof HTMLElement)) throw new Error("Missing day 10");
    fireEvent.click(next);
    expect(onChange).toHaveBeenLastCalledWith({ target: { value: "2026-03-10T02:30" } });
  });

  it("the time picker starts at 02 and a minute change keeps hour 02", () => {
    const onChange = vi.fn();
    render(<DateInput type="datetime-local" value={GAP} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "08.03.2026, 02:30" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Minuta" }));
    fireEvent.click(screen.getByRole("option", { name: "45" }));
    expect(onChange).toHaveBeenLastCalledWith({ target: { value: "2026-03-08T02:45" } });
  });

  it("a bare date is the same calendar day, not the previous one", () => {
    const onChange = vi.fn();
    render(<DateInput type="date" value="2026-03-08" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "08.03.2026" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "08.03.2026" }));
    expect(document.querySelector('[data-day="2026-03-08"]')?.getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("an impossible date reads as empty instead of rolling over", () => {
    render(<DateInput type="datetime-local" value="2026-02-30T10:00" onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /03\.2026/ })).toBeNull();
  });
});

describe("DateInput - midnight that does not exist in the viewer's zone", () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Santiago";
  });
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("2026-09-06T00:00 stays 00:00 on the 6th (Chile skips that midnight)", () => {
    expect(new Date(2026, 8, 6, 0, 0).getHours()).toBe(1);
    const onChange = vi.fn();
    render(<DateInput type="datetime-local" value="2026-09-06T00:00" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "06.09.2026, 00:00" }));
    const next = document.querySelector('[data-day="2026-09-07"] button');
    if (!(next instanceof HTMLElement)) throw new Error("Missing day 7");
    fireEvent.click(next);
    expect(onChange).toHaveBeenLastCalledWith({ target: { value: "2026-09-07T00:00" } });
  });
});
