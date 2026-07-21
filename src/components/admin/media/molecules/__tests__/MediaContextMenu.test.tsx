import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MediaContextMenu } from "../MediaContextMenu";
import type { ContextMenuItem } from "../../types";

describe("MediaContextMenu", () => {
  it("renders each item's label as a menuitem", () => {
    const items: ContextMenuItem[] = [
      { label: "Open", onSelect: vi.fn() },
      { separator: true },
      { label: "Delete", danger: true, onSelect: vi.fn() },
    ];
    render(<MediaContextMenu x={0} y={0} items={items} onClose={vi.fn()} />);
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("fires onSelect then onClose when an item is clicked", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <MediaContextMenu x={0} y={0} items={[{ label: "Open", onSelect }]} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not fire a disabled item", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <MediaContextMenu
        x={0}
        y={0}
        items={[{ label: "Paste", disabled: true, onSelect }]}
        onClose={onClose}
      />,
    );
    const item = screen.getByRole("menuitem", { name: "Paste" });
    expect(item).toBeDisabled();
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders a shortcut hint alongside the label", () => {
    render(
      <MediaContextMenu
        x={0}
        y={0}
        items={[{ label: "Copy", shortcut: "⌘C", onSelect: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("⌘C")).toBeInTheDocument();
  });

  it("clamps its position within the viewport", () => {
    const { container } = render(
      <MediaContextMenu
        x={100000}
        y={100000}
        items={[{ label: "Open", onSelect: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );
    const menu = container.querySelector('[role="menu"]') as HTMLElement;
    expect(parseInt(menu.style.left, 10)).toBeLessThan(window.innerWidth);
    expect(parseInt(menu.style.top, 10)).toBeLessThan(window.innerHeight);
  });
});
