import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormSelect } from "@/components/atoms/FormSelect";

describe("FormSelect", () => {
  const options = [
    { value: "geo", label: "Geopolityka" },
    { value: "eco", label: "Ekonomia" },
  ];

  it("renders placeholder when empty and exposes a hidden input", () => {
    const { container } = render(
      <FormSelect
        value=""
        onValueChange={() => {}}
        options={options}
        placeholder="Wybierz..."
        name="list"
      />,
    );
    expect(screen.getByText("Wybierz...")).toBeTruthy();
    const hidden = container.querySelector('input[type="hidden"][name="list"]');
    expect(hidden).toBeTruthy();
  });

  it("emits the selected value", async () => {
    const onValueChange = vi.fn();
    render(
      <FormSelect
        value=""
        onValueChange={onValueChange}
        options={options}
        placeholder="Wybierz..."
        aria-label="Lista"
      />,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Lista" }));
    await userEvent.click(await screen.findByText("Ekonomia"));
    expect(onValueChange).toHaveBeenCalledWith("eco");
  });
});
