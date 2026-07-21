import "@/lib/i18n-admin-post-panes";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditorModeToggle } from "../EditorModeToggle";

describe("EditorModeToggle", () => {
  it("marks the active engine via aria-pressed", () => {
    render(<EditorModeToggle editor="blocks" onEditorChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Gutenberg" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Elementor" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("switches to the builder engine on click", () => {
    const onEditorChange = vi.fn();
    render(<EditorModeToggle editor="blocks" onEditorChange={onEditorChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Elementor" }));
    expect(onEditorChange).toHaveBeenCalledWith("builder");
  });

  it("switches to the blocks engine on click", () => {
    const onEditorChange = vi.fn();
    render(<EditorModeToggle editor="builder" onEditorChange={onEditorChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Gutenberg" }));
    expect(onEditorChange).toHaveBeenCalledWith("blocks");
  });
});
