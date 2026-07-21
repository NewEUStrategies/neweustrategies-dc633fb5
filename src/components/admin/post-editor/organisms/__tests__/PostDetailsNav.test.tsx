import "@/lib/i18n-admin-post-panes";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PostDetailsNav } from "../PostDetailsNav";

describe("PostDetailsNav", () => {
  it("renders every tab across the metadata groups (i18n labels)", () => {
    render(<PostDetailsNav active="general" onSelect={() => {}} />);
    // 12 tabs total across the five groups. Assert via the button role so a tab
    // label that coincides with a group header (e.g. "Publikacja") is
    // unambiguous - the group headers are plain text, only tabs are buttons.
    expect(screen.getAllByRole("button")).toHaveLength(12);
    for (const label of [
      /Ogólne/,
      /Dowiesz się…/,
      /Audio \(MP3\)/,
      /Ustawienia strony/,
      /Layout/,
      /Kategorie i tagi/,
      /Powiązane wpisy/,
      /SEO i podgląd/,
      /Custom meta/,
      /Publikacja/,
      /Dostęp/,
      /Historia zmian/,
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the active tab with aria-current=page", () => {
    render(<PostDetailsNav active="layout" onSelect={() => {}} />);
    const activeBtn = screen.getByRole("button", { name: /Layout/ });
    expect(activeBtn.getAttribute("aria-current")).toBe("page");
  });

  it("calls onSelect with the tab id when a tab is clicked", () => {
    const onSelect = vi.fn();
    render(<PostDetailsNav active="general" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Kategorie i tagi/ }));
    expect(onSelect).toHaveBeenCalledWith("taxonomy");
  });

  it("does not mark inactive tabs as current", () => {
    render(<PostDetailsNav active="general" onSelect={() => {}} />);
    expect(
      screen.getByRole("button", { name: /Historia zmian/ }).getAttribute("aria-current"),
    ).toBeNull();
  });
});
