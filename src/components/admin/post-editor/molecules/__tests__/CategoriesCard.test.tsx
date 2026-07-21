import "@/lib/i18n-admin-post-panes";
import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CategoriesCard } from "../CategoriesCard";

const cats = [
  { id: "c1", name_pl: "Analizy", name_en: "Analyses" },
  { id: "c2", name_pl: "Wywiady", name_en: "Interviews" },
];

const base: ComponentProps<typeof CategoriesCard> = {
  allCats: cats,
  selectedCats: [],
  onSelectedCatsChange: () => {},
  newCatPl: "",
  onNewCatPlChange: () => {},
  newCatEn: "",
  onNewCatEnChange: () => {},
  taxonomyBusy: null,
  onAddCategory: () => {},
};

describe("CategoriesCard", () => {
  it("renders a checkbox per category with the bilingual label", () => {
    render(<CategoriesCard {...base} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("Analizy / Analyses")).toBeInTheDocument();
  });

  it("marks selected categories as checked", () => {
    render(<CategoriesCard {...base} selectedCats={["c2"]} />);
    const boxes = screen.getAllByRole("checkbox");
    expect((boxes[0] as HTMLInputElement).checked).toBe(false);
    expect((boxes[1] as HTMLInputElement).checked).toBe(true);
  });

  it("toggles a category through onSelectedCatsChange", () => {
    const onSelectedCatsChange = vi.fn();
    render(<CategoriesCard {...base} onSelectedCatsChange={onSelectedCatsChange} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onSelectedCatsChange).toHaveBeenCalledTimes(1);
  });

  it("disables the add button until a PL name is entered", () => {
    const { rerender } = render(<CategoriesCard {...base} newCatPl="" />);
    const button = screen.getByRole("button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    rerender(<CategoriesCard {...base} newCatPl="Nowa" />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("invokes onAddCategory when the add button is clicked", () => {
    const onAddCategory = vi.fn();
    render(<CategoriesCard {...base} newCatPl="Nowa" onAddCategory={onAddCategory} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onAddCategory).toHaveBeenCalledTimes(1);
  });
});
