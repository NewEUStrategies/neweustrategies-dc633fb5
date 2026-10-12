import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlatformSelect } from "../platform-select";

describe("PlatformSelect form values", () => {
  it("submits an empty string, not the internal sentinel", () => {
    const { container } = render(
      <form>
        <PlatformSelect name="category" value="" aria-label="Category" onChange={() => {}}>
          <option value="">All</option>
          <option value="events">Events</option>
        </PlatformSelect>
      </form>,
    );
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    expect(new FormData(form).get("category")).toBe("");
  });

  it("keeps an uncontrolled choice in FormData", () => {
    const values: string[] = [];
    const { container } = render(
      <form>
        <PlatformSelect
          name="category"
          defaultValue=""
          aria-label="Category"
          onChange={(event) => values.push(event.target.value)}
        >
          <option value="" disabled>
            Choose
          </option>
          <option value="events">Events</option>
        </PlatformSelect>
      </form>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
      target: { value: "events" },
    });
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    expect(new FormData(form).getAll("category")).toEqual(["events"]);
    expect(values).toEqual(["events"]);
  });

  it("does not submit a disabled field", () => {
    const { container } = render(
      <form>
        <PlatformSelect name="category" value="events" disabled onChange={() => {}}>
          <option value="events">Events</option>
        </PlatformSelect>
      </form>,
    );
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    // Przeglądarka pomija wyłączone kontrolki w zbiorze danych formularza
    // (HTML: "constructing the entry list"). happy-dom 20.9 robi to tylko dla
    // <input>, więc sprawdzamy, że pole jest JEDYNĄ, wyłączoną kontrolką tej
    // nazwy - bez ukrytego <input>, który wysłałby wartość mimo blokady.
    const controls = Array.from(form.elements).filter(
      (element) => element.getAttribute("name") === "category",
    );
    expect(controls).toHaveLength(1);
    expect(controls[0]).toBeInstanceOf(HTMLSelectElement);
    expect(controls[0]).toBeDisabled();
  });

  it("labels one native select whose options are queryable while closed", () => {
    render(
      <>
        <label htmlFor="country">Country</label>
        <PlatformSelect id="country" defaultValue="pl">
          <option value="">Choose a country</option>
          <>
            <option value="pl">Poland</option>
            <option value="de">Germany</option>
          </>
        </PlatformSelect>
      </>,
    );
    const select = screen.getByLabelText("Country");
    expect(select).toBeInstanceOf(HTMLSelectElement);
    expect(select).toHaveValue("pl");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Choose a country", "Poland", "Germany"]);
  });

  it("blocks an empty required choice natively", () => {
    const { container } = render(
      <form>
        <PlatformSelect name="topic" required defaultValue="" aria-label="Topic">
          <option value="" disabled>
            Choose
          </option>
          <option value="a">A</option>
        </PlatformSelect>
      </form>,
    );
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    expect(form.checkValidity()).toBe(false);
    fireEvent.change(screen.getByRole("combobox", { name: "Topic" }), { target: { value: "a" } });
    expect(form.checkValidity()).toBe(true);
  });

  it("adds a placeholder option only when the children have no empty value", () => {
    const { rerender } = render(
      <PlatformSelect aria-label="Size" placeholder="Pick" defaultValue="">
        <option value="s">S</option>
      </PlatformSelect>,
    );
    const placeholder = within(screen.getByRole("combobox", { name: "Size" })).getByRole("option", {
      name: "Pick",
    });
    expect(placeholder).toHaveValue("");
    expect(placeholder).toBeDisabled();
    rerender(
      <PlatformSelect aria-label="Size" placeholder="Pick" defaultValue="">
        <option value="">Any</option>
        <option value="s">S</option>
      </PlatformSelect>,
    );
    expect(
      within(screen.getByRole("combobox", { name: "Size" })).queryByRole("option", {
        name: "Pick",
      }),
    ).toBeNull();
  });
});
