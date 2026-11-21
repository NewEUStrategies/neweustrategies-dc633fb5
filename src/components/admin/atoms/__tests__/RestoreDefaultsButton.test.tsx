// Wspólny przycisk „Przywróć domyślne": reset szkicu od razu, a z potwierdzeniem
// dopiero po zgodzie w oknie platformy.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RestoreDefaultsButton } from "@/components/admin/atoms/RestoreDefaultsButton";

afterEach(() => cleanup());

describe("RestoreDefaultsButton", () => {
  it("without confirmation restores immediately, exactly once", () => {
    const onRestore = vi.fn();
    render(<RestoreDefaultsButton onRestore={onRestore} label="Przywróć domyślne" />);
    fireEvent.click(screen.getByRole("button", { name: "Przywróć domyślne" }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("with confirmation does nothing when cancelled", async () => {
    const onRestore = vi.fn();
    render(<RestoreDefaultsButton onRestore={onRestore} label="Reset" confirm="Na pewno?" />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Na pewno?");
    fireEvent.click(within(dialog).getAllByRole("button")[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("with confirmation restores after the confirm action", async () => {
    const onRestore = vi.fn();
    render(<RestoreDefaultsButton onRestore={onRestore} label="Reset" confirm />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    const dialog = await screen.findByRole("alertdialog");
    const buttons = within(dialog).getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("disabled button cannot restore", () => {
    const onRestore = vi.fn();
    render(<RestoreDefaultsButton onRestore={onRestore} label="Reset" disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onRestore).not.toHaveBeenCalled();
  });
});
