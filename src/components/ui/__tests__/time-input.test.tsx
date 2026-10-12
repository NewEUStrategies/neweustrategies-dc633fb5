import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeInput } from "../time-input";

describe("TimeInput native values", () => {
  it("labels one native time input and keeps an empty value empty", () => {
    render(
      <>
        <label htmlFor="from">From</label>
        <TimeInput id="from" value="" onChange={() => {}} />
      </>,
    );
    const input = screen.getByLabelText("From");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(input).toHaveAttribute("type", "time");
    expect(input).toHaveValue("");
  });

  it("reports the local HH:mm value and an explicit clear", () => {
    const values: string[] = [];
    render(
      <TimeInput
        aria-label="Time"
        value="08:15"
        onChange={(event) => values.push(event.target.value)}
      />,
    );
    const input = screen.getByLabelText("Time");
    fireEvent.change(input, { target: { value: "10:30" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(values).toEqual(["10:30", ""]);
  });

  it("submits through FormData, skips a disabled field and validates required", () => {
    const { container } = render(
      <form>
        <TimeInput name="start" defaultValue="09:45" />
        <TimeInput name="locked" defaultValue="11:00" disabled />
        <TimeInput name="end" required defaultValue="" />
      </form>,
    );
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    const data = new FormData(form);
    expect(data.get("start")).toBe("09:45");
    expect(data.has("locked")).toBe(false);
    expect(form.checkValidity()).toBe(false);
  });
});
