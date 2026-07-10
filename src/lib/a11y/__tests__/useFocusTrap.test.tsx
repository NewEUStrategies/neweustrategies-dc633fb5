import { describe, it, expect } from "vitest";
import { useRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { useFocusTrap } from "@/lib/a11y/useFocusTrap";

function Dialog({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return (
    <div>
      <button>outside-before</button>
      {active && (
        <div ref={ref} role="dialog">
          <button>first</button>
          <button>middle</button>
          <button>last</button>
        </div>
      )}
      <button>outside-after</button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("moves focus into the container on activation", () => {
    render(<Dialog active={true} />);
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("wraps Tab from the last item back to the first", () => {
    render(<Dialog active={true} />);
    screen.getByText("last").focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("wraps Shift+Tab from the first item back to the last", () => {
    render(<Dialog active={true} />);
    expect(document.activeElement).toBe(screen.getByText("first"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("restores focus to the previously focused element once the dialog is removed", () => {
    const { rerender } = render(<Dialog active={false} />);
    const trigger = screen.getByText("outside-before");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(<Dialog active={true} />);
    expect(document.activeElement).toBe(screen.getByText("first"));

    rerender(<Dialog active={false} />);
    expect(document.activeElement).toBe(trigger);
  });
});
