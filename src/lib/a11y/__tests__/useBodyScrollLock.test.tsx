import { StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useBodyScrollLock } from "@/lib/a11y/useBodyScrollLock";

function Lock({ active = true }: { active?: boolean }) {
  useBodyScrollLock(active);
  return null;
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  document.documentElement.style.scrollbarGutter = "";
});

describe("useBodyScrollLock", () => {
  it("keeps the remaining modal locked regardless of unmount order", () => {
    const first = render(<Lock />);
    const second = render(<Lock />);
    first.unmount();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
    second.unmount();
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
  });
  it("preserves existing page styles after a strict-mode mount and cleanup", () => {
    document.body.style.overflow = "clip";
    document.documentElement.style.overflow = "auto";
    document.documentElement.style.scrollbarGutter = "stable both-edges";
    const view = render(
      <StrictMode>
        <Lock />
      </StrictMode>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();
    expect(document.body.style.overflow).toBe("clip");
    expect(document.documentElement.style.overflow).toBe("auto");
    expect(document.documentElement.style.scrollbarGutter).toBe("stable both-edges");
  });
  it("does not change the document while inactive", () => {
    render(<Lock active={false} />);
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
  });
});
