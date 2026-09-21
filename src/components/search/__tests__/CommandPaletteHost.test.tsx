import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPaletteHost } from "../CommandPaletteHost";

const loaded = vi.hoisted(() => vi.fn());
vi.mock("../CommandPalette", () => {
  loaded();
  return {
    CommandPalette: ({ onOpenChange }: { onOpenChange: (open: boolean) => void }) => (
      <button onClick={() => onOpenChange(false)}>Loaded palette</button>
    ),
  };
});

describe("CommandPaletteHost", () => {
  it("loads on the first shortcut, preserves that shortcut, and supports reopening", async () => {
    const { unmount } = render(<CommandPaletteHost />);
    expect(loaded).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(await screen.findByRole("button", { name: "Loaded palette" }));
    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.keyDown(window, { key: "K", metaKey: true });
    expect(await screen.findByRole("button", { name: "Loaded palette" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    act(() => fireEvent.keyDown(window, { key: "k", ctrlKey: true }));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("leaves slash input alone while typing", async () => {
    render(
      <>
        <input aria-label="Editor" />
        <CommandPaletteHost />
      </>,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "/" });
    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.keyDown(window, { key: "/" });
    expect(await screen.findByRole("button", { name: "Loaded palette" })).toBeTruthy();
  });
});
