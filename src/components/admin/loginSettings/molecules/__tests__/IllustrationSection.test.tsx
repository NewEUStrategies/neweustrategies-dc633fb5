import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IllustrationSection } from "@/components/admin/loginSettings/molecules/IllustrationSection";

describe("IllustrationSection", () => {
  it("wiąże region z nagłówkiem i zachowuje opis oraz zawartość", () => {
    render(
      <IllustrationSection title="Ilustracja logowania" description={<span>1600 × 1200</span>}>
        <button type="button">Edytuj</button>
      </IllustrationSection>,
    );

    const region = screen.getByRole("region", { name: "Ilustracja logowania" });
    expect(region).toBeInTheDocument();
    expect(screen.getByText("1600 × 1200")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edytuj" })).toBeInTheDocument();
  });
});
